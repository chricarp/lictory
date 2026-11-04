import { sql, type SQL } from "drizzle-orm";
import {
  auditActions,
  auditCategories,
  type AuditCategory,
  type AuditEntry,
} from "@lictory/core/contracts/audit";
import { requireAuditReader } from "@lictory/core/domain/audit";
import { assertTwoFactorSatisfied } from "@lictory/core/domain/two-factor-policy";
import { DomainError } from "@lictory/core/domain/errors";
import { csvLine } from "@lictory/core/lib/csv";
import type { Database } from "@lictory/core/domain/service";

// Reading the organization audit log. Every source is filtered by the
// organization inside its own query branch (never after fetching), ordered
// newest first and paged with a keyset cursor, so the log reads the same way
// at any size. Only organization administrators may read it.

export type AuditLogFilters = {
  category?: AuditCategory | null;
  actorId?: string | null;
  // Inclusive UTC calendar days, `YYYY-MM-DD`.
  from?: string | null;
  to?: string | null;
};

export const MAX_AUDIT_PAGE = 200;
const day = /^\d{4}-\d{2}-\d{2}$/;

type Cursor = { at: string; id: string };

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  try {
    const value = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Partial<Cursor>;
    if (
      typeof value.at === "string" &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(value.at) &&
      typeof value.id === "string" &&
      value.id.length <= 160
    )
      return { at: value.at, id: value.id };
  } catch {
    // Fall through to the validation error.
  }
  throw new DomainError(
    "validation",
    "This page of the audit log is no longer valid. Reload it.",
  );
}

type Row = {
  source: AuditEntry["source"];
  id: string;
  at: string;
  cursor_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  detail: Record<string, unknown> | null;
};

const eventCategories = new Set<AuditCategory>([
  "membership",
  "access",
  "organization",
]);

function conditions(
  alias: "e" | "c" | "i",
  actorColumn: string,
  organizationId: string,
  filters: AuditLogFilters,
  cursor: Cursor | null,
) {
  const column = (name: string) => sql.raw(`${alias}.${name}`);
  const parts: SQL[] = [sql`${column("organization_id")} = ${organizationId}`];
  if (filters.actorId)
    parts.push(sql`${column(actorColumn)} = ${filters.actorId}`);
  if (filters.from)
    parts.push(sql`${column("created_at")} >= ${filters.from}::date`);
  if (filters.to)
    parts.push(sql`${column("created_at")} < ${filters.to}::date + 1`);
  if (cursor)
    parts.push(
      sql`(${column("created_at")}, ${column("id")}) < (${cursor.at}::timestamp, ${cursor.id})`,
    );
  return parts;
}

const iso = (alias: string) =>
  sql.raw(
    `to_char(${alias}.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at, ${alias}.created_at::text as cursor_at`,
  );

export async function readAuditLog(
  db: Database,
  userId: string,
  organizationId: string,
  options: AuditLogFilters & { cursor?: string | null; limit?: number } = {},
): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> {
  await requireAuditReader(db, userId, organizationId);
  // The CSV download route reaches this without the registry's check.
  await assertTwoFactorSatisfied(db, userId, organizationId);
  return auditLogPage(db, organizationId, options);
}

// The page query without authorization, for callers that already checked
// `requireAuditReader` (the CSV export pages through it).
async function auditLogPage(
  db: Database,
  organizationId: string,
  options: AuditLogFilters & { cursor?: string | null; limit?: number },
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_AUDIT_PAGE);
  for (const value of [options.from, options.to])
    if (value && !day.test(value))
      throw new DomainError("validation", "Dates must be YYYY-MM-DD.");
  if (options.category && !auditCategories.includes(options.category))
    throw new DomainError("validation", "Unknown audit category.");
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  const category = options.category ?? null;
  const branches: SQL[] = [];
  // One more row than the page tells whether another page exists.
  const take = limit + 1;

  if (!category || eventCategories.has(category)) {
    const where = conditions("e", "actor_id", organizationId, options, cursor);
    if (category) {
      const actions = Object.entries(auditActions)
        .filter(([, meta]) => meta.category === category)
        .map(([action]) => sql`${action}`);
      where.push(sql`e.action in (${sql.join(actions, sql`, `)})`);
    }
    branches.push(sql`(select 'event' as source, e.id, ${iso("e")},
        e.created_at, e.actor_id,
        coalesce(e.actor_name, u.name) as actor_name,
        coalesce(e.actor_email, u.email) as actor_email,
        e.action, e.target_type, e.target_id, e.target_label, e.detail
      from audit_event e
      left join "user" u on u.id = e.actor_id
      where ${sql.join(where, sql` and `)}
      order by e.created_at desc, e.id desc
      limit ${take})`);
  }
  if (!category || category === "configuration") {
    const where = conditions("c", "actor_id", organizationId, options, cursor);
    branches.push(sql`(select 'configuration' as source, c.id, ${iso("c")},
        c.created_at, c.actor_id, u.name as actor_name,
        u.email as actor_email, c.action, null::text as target_type,
        null::text as target_id, null::text as target_label, c.detail
      from configuration_audit c
      left join "user" u on u.id = c.actor_id
      where ${sql.join(where, sql` and `)}
      order by c.created_at desc, c.id desc
      limit ${take})`);
  }
  if (!category || category === "agent") {
    const where = conditions("i", "user_id", organizationId, options, cursor);
    branches.push(sql`(select 'agent' as source, i.id, ${iso("i")},
        i.created_at, i.user_id as actor_id, u.name as actor_name,
        u.email as actor_email, i.capability as action,
        case when i.token_id is null then null else 'access_token' end
          as target_type,
        i.token_id as target_id, t.name as target_label,
        jsonb_build_object('surface', i.surface, 'client', i.client,
          'outcome', i.outcome, 'mutationId', i.mutation_id,
          'durationMs', i.duration_ms) as detail
      from capability_invocation i
      join "user" u on u.id = i.user_id
      left join access_token t on t.id = i.token_id
      where ${sql.join(where, sql` and `)}
      order by i.created_at desc, i.id desc
      limit ${take})`);
  }

  const rows = (await db.execute(sql`
    select source, id, at, cursor_at, actor_id, actor_name, actor_email,
      action, target_type, target_id, target_label, detail
    from (${sql.join(branches, sql` union all `)}) entries
    order by created_at desc, id desc
    limit ${take}`)) as unknown as Row[];

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    entries: page.map(toEntry),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ at: last.cursor_at, id: last.id })
        : null,
  };
}

const roleName = (role: unknown) =>
  typeof role === "string" && /\b(owner|admin)\b/.test(role)
    ? "admin"
    : "member";

const quoted = (value: string | null | undefined) =>
  value ? `“${value}”` : "an access token";

// "updateProject" → "Update project".
function humanize(command: string) {
  const words = command.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describeEvent(row: Row, detail: Record<string, unknown>) {
  const target = row.target_label ?? "someone";
  switch (row.action) {
    case "member.role_changed":
      return `Changed ${target}'s application role from ${roleName(detail.from)} to ${roleName(detail.to)}`;
    case "member.added":
      return `Added ${target} as ${roleName(detail.role)}`;
    case "member.joined":
      return `Joined as ${roleName(detail.role)}`;
    case "member.removed":
      return `Removed ${target} from the organization`;
    case "member.account_deleted":
      return "Deleted their account, leaving the organization";
    case "invitation.created":
      return `Invited ${target}`;
    case "invitation.cancelled":
      return `Withdrew the invitation for ${target}`;
    case "access_token.created":
      return `Created ${detail.access === "write" ? "write" : "read"} access token ${quoted(row.target_label)}${
        typeof detail.expiresAt === "string"
          ? `, expiring ${detail.expiresAt.slice(0, 10)}`
          : ", without expiry"
      }`;
    case "access_token.revoked":
      return `Revoked access token ${quoted(row.target_label)}`;
    case "two_factor.requirement_changed":
      return detail.requireTwoFactor === true
        ? "Required two-factor authentication for members"
        : "Stopped requiring two-factor authentication for members";
    case "two_factor.member_reset":
      return `Reset ${target}'s two-factor authentication`;
    case "organization.updated": {
      const changed = [
        typeof detail.name === "string" && `name to “${detail.name}”`,
        typeof detail.slug === "string" && `handle to “${detail.slug}”`,
      ].filter(Boolean);
      return changed.length
        ? `Changed the organization's ${changed.join(" and ")}`
        : auditActions["organization.updated"].label;
    }
    default:
      return (
        auditActions[row.action as keyof typeof auditActions]?.label ??
        row.action
      );
  }
}

function toEntry(row: Row): AuditEntry {
  const detail = row.detail ?? {};
  const actor = row.actor_id
    ? { id: row.actor_id, name: row.actor_name, email: row.actor_email }
    : null;
  const target = row.target_type
    ? { type: row.target_type, id: row.target_id, label: row.target_label }
    : null;
  const base = { id: row.id, source: row.source, at: row.at, actor, target };
  if (row.source === "configuration")
    return {
      ...base,
      category: "configuration",
      action: row.action,
      label: "Changed configuration",
      summary: humanize(row.action),
      detail,
    };
  if (row.source === "agent") {
    const agent =
      detail.surface === "mcp"
        ? `MCP agent${row.target_label ? ` “${row.target_label}”` : ""}`
        : "Litto";
    return {
      ...base,
      category: "agent",
      action: row.action,
      label: "Agent call",
      summary: `${agent} called ${row.action}${
        typeof detail.outcome === "string" && detail.outcome !== "ok"
          ? ` (refused: ${detail.outcome})`
          : ""
      }`,
      detail,
    };
  }
  const meta = auditActions[row.action as keyof typeof auditActions];
  return {
    ...base,
    category: meta?.category ?? "organization",
    action: row.action,
    label: meta?.label ?? row.action,
    summary: describeEvent(row, detail),
    detail,
  };
}

const csvHeader = [
  "Time (UTC)",
  "Category",
  "Actor",
  "Actor email",
  "Action",
  "Summary",
  "Target type",
  "Target",
  "Details",
];

function auditCsvLine(entry: AuditEntry) {
  return csvLine([
    entry.at,
    entry.category,
    entry.actor?.name ?? (entry.actor ? "" : "Lictory"),
    entry.actor?.email ?? "",
    entry.action,
    entry.summary,
    entry.target?.type ?? "",
    entry.target?.label ?? entry.target?.id ?? "",
    JSON.stringify(entry.detail),
  ]);
}

// The filtered audit log as CSV, page by page, so an export never holds the
// whole log in memory. Authorizes before the first byte.
export async function auditLogCsv(
  db: Database,
  userId: string,
  organizationId: string,
  filters: AuditLogFilters,
): Promise<AsyncGenerator<string>> {
  await requireAuditReader(db, userId, organizationId);
  // The CSV download route reaches this without the registry's check.
  await assertTwoFactorSatisfied(db, userId, organizationId);
  async function* lines() {
    yield csvLine(csvHeader);
    let cursor: string | null = null;
    do {
      const page = await auditLogPage(db, organizationId, {
        ...filters,
        cursor,
        limit: MAX_AUDIT_PAGE,
      });
      yield page.entries.map(auditCsvLine).join("");
      cursor = page.nextCursor;
    } while (cursor);
  }
  return lines();
}
