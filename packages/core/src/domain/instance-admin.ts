import { APIError } from "better-auth/api";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "@lictory/core/db/schema";
import { auth, policy, signInOptions } from "@lictory/core/lib/auth";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import { emailConfigured } from "@lictory/core/lib/mailer";
import {
  normalizeOrganizationHandle,
  organizationHandleProblem,
  suggestOrganizationHandle,
} from "@lictory/core/lib/organization-handles";
import { isInstanceAdmin } from "@lictory/core/lib/instance-policy";
import { AI_ACTOR_ID } from "@lictory/core/contracts/ai";
import { recordAuditEvent } from "@lictory/core/domain/audit";

// Instance administration: the accounts, instance administrators and
// organizations of one installation, for the admin console and the server
// CLI. Callers authorize first (`requireInstanceAdmin`, or shell access to the
// server for the CLI). Every change is recorded in `instance_audit_event`.
//
// Account and membership rows belong to Better Auth, which commits its own
// writes and refreshes the organization directories through its hooks
// (lib/auth.ts); this module never writes them around it, except the two
// instance-only columns (`instance_admin`, `deactivated_at`) that no
// projection reads. See docs/internals/instance-administration.md.

type Database = PostgresJsDatabase<typeof s>;

export type InstanceActor = {
  // Null when the server CLI acted.
  user: { id: string; name: string; email: string } | null;
  via: "web" | "cli";
};

export class InstanceAdminError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export const instanceAuditActions = {
  "instance.set_up": "Set up the installation's first administrator",
  "user.created": "Created an account",
  "user.deactivated": "Deactivated an account",
  "user.reactivated": "Reactivated an account",
  "user.deleted": "Deleted their account",
  "user.password_set": "Set an account's password",
  "user.password_reset_sent": "Sent a password reset link",
  "instance_admin.granted": "Made an instance administrator",
  "instance_admin.revoked": "Removed an instance administrator",
  "organization.created": "Created an organization",
  "organization.member_added": "Added someone to an organization",
} as const;
export type InstanceAuditAction = keyof typeof instanceAuditActions;

export async function recordInstanceAudit(
  db: Database,
  actor: InstanceActor,
  action: InstanceAuditAction,
  target: { type: string; id: string; label: string } | null,
  detail: Record<string, unknown> = {},
) {
  await db.insert(s.instanceAuditEvent).values({
    actorId: actor.user?.id ?? null,
    actorName: actor.user?.name ?? null,
    actorEmail: actor.user?.email ?? null,
    via: actor.via,
    action,
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    targetLabel: target?.label ?? null,
    detail,
  });
}

// The signed-in instance administrator behind a request, or an error.
export async function requireInstanceAdmin(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session)
    throw new InstanceAdminError(
      "unauthorized",
      "Sign in again to continue.",
      401,
    );
  const user = session.user;
  if (!isInstanceAdmin(user))
    throw new InstanceAdminError(
      "forbidden",
      "Only instance administrators can open the admin console.",
      403,
    );
  return { id: user.id, name: user.name, email: user.email };
}

const fromBetterAuth = (error: unknown): never => {
  if (error instanceof APIError)
    throw new InstanceAdminError(
      String(error.body?.code ?? "invalid").toLowerCase(),
      error.message,
      error.statusCode === 404 ? 404 : 400,
    );
  throw error;
};

const userSummary = (u: { id: string; name: string; email: string }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
});

// Every console action changes the account, so a deleted one (an anonymized
// tombstone kept for history) is refused: reactivating it or giving it a
// password would bring back an account its owner deleted.
async function userById(db: Database, id: string) {
  const [user] = await db.select().from(s.user).where(eq(s.user.id, id));
  if (!user)
    throw new InstanceAdminError(
      "not_found",
      "That account no longer exists.",
      404,
    );
  if (user.deletedAt)
    throw new InstanceAdminError(
      "deleted",
      "This account was deleted by its owner and can't be changed.",
      409,
    );
  return user;
}

export async function userByEmail(db: Database, email: string) {
  const [user] = await db
    .select()
    .from(s.user)
    .where(sql`lower(${s.user.email}) = ${email.trim().toLowerCase()}`);
  if (!user)
    throw new InstanceAdminError(
      "not_found",
      `No account uses ${email.trim()}.`,
      404,
    );
  return user;
}

// Lictory's own AI actor has an account row; it is not a person.
const person = ne(s.user.id, AI_ACTOR_ID);

const activeAdministrators = (db: Database) =>
  db
    .select({ id: s.user.id, name: s.user.name, email: s.user.email })
    .from(s.user)
    .where(and(eq(s.user.instanceAdmin, true), isNull(s.user.deactivatedAt)))
    .orderBy(asc(s.user.name));

export async function listAdministrators(db: Database) {
  const rows = await db
    .select({
      id: s.user.id,
      name: s.user.name,
      email: s.user.email,
      deactivatedAt: s.user.deactivatedAt,
    })
    .from(s.user)
    .where(eq(s.user.instanceAdmin, true))
    .orderBy(asc(s.user.name));
  return rows.map(({ deactivatedAt, ...u }) => ({
    ...u,
    deactivated: Boolean(deactivatedAt),
  }));
}

// What the installation allows and how much it holds.
export async function instanceOverview(db: Database) {
  const [users] = await db
    .select({
      total: count(),
      deactivated: count(s.user.deactivatedAt),
      administrators: sql<number>`count(*) filter (where ${s.user.instanceAdmin} and ${s.user.deactivatedAt} is null)`,
    })
    .from(s.user)
    .where(person);
  const [organizations] = await db
    .select({ total: count() })
    .from(s.organization);
  const [invitations] = await db
    .select({ pending: count() })
    .from(s.invitation)
    .where(
      and(
        eq(s.invitation.status, "pending"),
        gt(s.invitation.expiresAt, new Date()),
      ),
    );
  return {
    policy: {
      signUpMode: policy.signUpMode,
      allowedEmailDomains: [...policy.allowedEmailDomains],
      organizationCreation: policy.organizationCreation,
    },
    signIn: {
      password: signInOptions.password,
      sso: signInOptions.ssoName,
    },
    email: emailConfigured(),
    counts: {
      users: Number(users?.total ?? 0),
      deactivated: Number(users?.deactivated ?? 0),
      administrators: Number(users?.administrators ?? 0),
      organizations: Number(organizations?.total ?? 0),
      pendingInvitations: Number(invitations?.pending ?? 0),
    },
  };
}

const PAGE = 50;

export async function listUsers(
  db: Database,
  options: {
    query?: string;
    status?: "all" | "active" | "deactivated" | "administrators";
    offset?: number;
  } = {},
) {
  const query = options.query?.trim();
  const pattern = query ? `%${query.replaceAll(/[\\%_]/g, "\\$&")}%` : null;
  const where = and(
    person,
    pattern
      ? or(
          ilike(s.user.name, pattern),
          ilike(s.user.email, pattern),
          ilike(s.user.handle, pattern),
        )
      : undefined,
    options.status === "active" ? isNull(s.user.deactivatedAt) : undefined,
    options.status === "deactivated"
      ? isNotNull(s.user.deactivatedAt)
      : undefined,
    options.status === "administrators"
      ? eq(s.user.instanceAdmin, true)
      : undefined,
  );
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const rows = await db
    .select({
      id: s.user.id,
      name: s.user.name,
      email: s.user.email,
      handle: s.user.handle,
      image: s.user.image,
      emailVerified: s.user.emailVerified,
      instanceAdmin: s.user.instanceAdmin,
      twoFactorEnabled: s.user.twoFactorEnabled,
      deactivatedAt: s.user.deactivatedAt,
      deletedAt: s.user.deletedAt,
      createdAt: s.user.createdAt,
      lastActiveAt: sql<Date | null>`(select max(${s.session.updatedAt}) from ${s.session} where ${s.session.userId} = ${s.user.id})`,
    })
    .from(s.user)
    .where(where)
    .orderBy(asc(sql`lower(${s.user.name})`), asc(s.user.id))
    .limit(PAGE + 1)
    .offset(offset);
  const [total] = await db.select({ total: count() }).from(s.user).where(where);
  const page = rows.slice(0, PAGE);
  const memberships = page.length
    ? await db
        .select({
          userId: s.member.userId,
          id: s.organization.id,
          name: s.organization.name,
          slug: s.organization.slug,
          role: s.member.role,
        })
        .from(s.member)
        .innerJoin(
          s.organization,
          eq(s.organization.id, s.member.organizationId),
        )
        .where(
          inArray(
            s.member.userId,
            page.map((u) => u.id),
          ),
        )
        .orderBy(asc(s.organization.name))
    : [];
  return {
    users: page.map((u) => ({
      ...u,
      lastActiveAt: u.lastActiveAt ? new Date(u.lastActiveAt) : null,
      organizations: memberships
        .filter((m) => m.userId === u.id)
        .map(({ userId: _, ...m }) => m),
    })),
    total: Number(total?.total ?? 0),
    nextOffset: rows.length > PAGE ? offset + PAGE : null,
  };
}

export async function listOrganizations(db: Database) {
  const organizations = await db
    .select({
      id: s.organization.id,
      name: s.organization.name,
      slug: s.organization.slug,
      createdAt: s.organization.createdAt,
      members: sql<number>`(select count(*) from ${s.member} where ${s.member.organizationId} = ${s.organization.id})`,
      pendingInvitations: sql<number>`(select count(*) from ${s.invitation} where ${s.invitation.organizationId} = ${s.organization.id} and ${s.invitation.status} = 'pending' and ${s.invitation.expiresAt} > now())`,
    })
    .from(s.organization)
    .orderBy(asc(sql`lower(${s.organization.name})`));
  const owners = organizations.length
    ? await db
        .select({
          organizationId: s.member.organizationId,
          id: s.user.id,
          name: s.user.name,
          email: s.user.email,
        })
        .from(s.member)
        .innerJoin(s.user, eq(s.user.id, s.member.userId))
        .where(eq(s.member.role, "owner"))
    : [];
  return organizations.map((o) => ({
    ...o,
    members: Number(o.members),
    pendingInvitations: Number(o.pendingInvitations),
    owners: owners
      .filter((owner) => owner.organizationId === o.id)
      .map(({ organizationId: _, ...owner }) => owner),
  }));
}

export type OrganizationRole = "owner" | "admin" | "member";

export async function addOrganizationMember(
  db: Database,
  actor: InstanceActor,
  input: { organizationId: string; userId: string; role: OrganizationRole },
) {
  const user = await userById(db, input.userId);
  const [organization] = await db
    .select()
    .from(s.organization)
    .where(eq(s.organization.id, input.organizationId));
  if (!organization)
    throw new InstanceAdminError(
      "not_found",
      "That organization no longer exists.",
      404,
    );
  const [existing] = await db
    .select({ id: s.member.id })
    .from(s.member)
    .where(
      and(
        eq(s.member.organizationId, organization.id),
        eq(s.member.userId, user.id),
      ),
    );
  if (existing)
    throw new InstanceAdminError(
      "already_member",
      `${user.name || user.email} is already a member of ${organization.name}.`,
      409,
    );
  // Server-side Better Auth call: its hook refreshes the directory. Server
  // calls skip the request hooks that audit membership, so the
  // organization's own audit log is written here, naming the administrator.
  const member = await auth.api
    .addMember({
      body: {
        userId: user.id,
        organizationId: organization.id,
        role: input.role,
      },
    })
    .catch(fromBetterAuth);
  await recordAuditEvent(db, {
    organizationId: organization.id,
    actor: actor.user,
    action: "member.added",
    target: { type: "member", id: user.id, label: user.name || user.email },
    detail: {
      memberId: member?.id ?? null,
      role: input.role,
      email: user.email,
      by: "instance_administrator",
    },
  });
  await recordInstanceAudit(
    db,
    actor,
    "organization.member_added",
    { type: "organization", id: organization.id, label: organization.name },
    { userId: user.id, email: user.email, role: input.role },
  );
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
  };
}

export async function createAccount(
  db: Database,
  actor: InstanceActor,
  input: {
    name: string;
    email: string;
    password?: string;
    instanceAdmin?: boolean;
    organization?: { id: string; role: OrganizationRole };
  },
) {
  const { user } = await auth.api
    .provisionUser({
      body: {
        name: input.name.trim(),
        email: input.email.trim(),
        password: input.password,
        instanceAdmin: input.instanceAdmin ?? false,
      },
    })
    .catch(fromBetterAuth);
  await recordInstanceAudit(
    db,
    actor,
    "user.created",
    { type: "user", id: user.id, label: user.email },
    {
      instanceAdmin: input.instanceAdmin ?? false,
      password: input.password !== undefined,
    },
  );
  const organization = input.organization
    ? await addOrganizationMember(db, actor, {
        organizationId: input.organization.id,
        userId: user.id,
        role: input.organization.role,
      })
    : null;
  return { user: userSummary(user), organization };
}

export async function setInstanceAdmin(
  db: Database,
  actor: InstanceActor,
  userId: string,
  instanceAdmin: boolean,
) {
  const user = await userById(db, userId);
  if (user.instanceAdmin === instanceAdmin) return userSummary(user);
  if (!instanceAdmin && !user.deactivatedAt) {
    const remaining = (await activeAdministrators(db)).filter(
      (admin) => admin.id !== user.id,
    );
    if (!remaining.length)
      throw new InstanceAdminError(
        "last_administrator",
        "This is the installation's only active administrator. Make someone else an administrator first.",
        409,
      );
  }
  if (instanceAdmin && user.deactivatedAt)
    throw new InstanceAdminError(
      "deactivated",
      "Reactivate the account before making it an administrator.",
      409,
    );
  await db
    .update(s.user)
    .set({ instanceAdmin, updatedAt: new Date() })
    .where(eq(s.user.id, user.id));
  await recordInstanceAudit(
    db,
    actor,
    instanceAdmin ? "instance_admin.granted" : "instance_admin.revoked",
    { type: "user", id: user.id, label: user.email },
  );
  return userSummary(user);
}

export async function setDeactivated(
  db: Database,
  actor: InstanceActor,
  userId: string,
  deactivated: boolean,
) {
  const user = await userById(db, userId);
  if (Boolean(user.deactivatedAt) === deactivated) return userSummary(user);
  if (deactivated && actor.user?.id === user.id)
    throw new InstanceAdminError(
      "self",
      "You can't deactivate your own account.",
      409,
    );
  if (deactivated && user.instanceAdmin) {
    const remaining = (await activeAdministrators(db)).filter(
      (admin) => admin.id !== user.id,
    );
    if (!remaining.length)
      throw new InstanceAdminError(
        "last_administrator",
        "This is the installation's only active administrator. Make someone else an administrator first.",
        409,
      );
  }
  await db.transaction(async (tx) => {
    await tx
      .update(s.user)
      .set({
        deactivatedAt: deactivated ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(s.user.id, user.id));
    // Signed out everywhere; the session gate refuses new sessions and the
    // token check refuses their access tokens until reactivation.
    if (deactivated)
      await tx.delete(s.session).where(eq(s.session.userId, user.id));
  });
  await recordInstanceAudit(
    db,
    actor,
    deactivated ? "user.deactivated" : "user.reactivated",
    { type: "user", id: user.id, label: user.email },
  );
  return userSummary(user);
}

export async function setPassword(
  db: Database,
  actor: InstanceActor,
  userId: string,
  password: string,
) {
  const user = await userById(db, userId);
  await auth.api
    .setUserPassword({ body: { userId: user.id, password } })
    .catch(fromBetterAuth);
  await recordInstanceAudit(db, actor, "user.password_set", {
    type: "user",
    id: user.id,
    label: user.email,
  });
  return userSummary(user);
}

// The person chooses a new password from the emailed link.
export async function sendPasswordReset(
  db: Database,
  actor: InstanceActor,
  userId: string,
) {
  const user = await userById(db, userId);
  if (!signInOptions.password)
    throw new InstanceAdminError(
      "password_login_disabled",
      "Password sign-in is turned off on this installation; people sign in with your company account.",
      409,
    );
  if (!emailConfigured())
    throw new InstanceAdminError(
      "email_not_configured",
      "This installation sends no email. Set a password for them instead, or configure outbound email (sudo lictory install --email smtp).",
      409,
    );
  await auth.api
    .requestPasswordReset({
      body: { email: user.email, redirectTo: "/reset-password" },
    })
    .catch(fromBetterAuth);
  await recordInstanceAudit(db, actor, "user.password_reset_sent", {
    type: "user",
    id: user.id,
    label: user.email,
  });
  return userSummary(user);
}

export async function createOrganization(
  db: Database,
  actor: InstanceActor,
  input: { name: string; slug?: string; ownerId: string },
) {
  const name = input.name.trim();
  if (!name || name.length > 80)
    throw new InstanceAdminError(
      "invalid_name",
      "Enter an organization name of at most 80 characters.",
    );
  const slug = normalizeOrganizationHandle(
    input.slug?.trim() ? input.slug : suggestOrganizationHandle(name),
  );
  const problem = organizationHandleProblem(slug);
  if (problem) throw new InstanceAdminError("invalid_handle", problem);
  const owner = await userById(db, input.ownerId);
  if (owner.deactivatedAt)
    throw new InstanceAdminError(
      "deactivated",
      "Reactivate the owner's account first.",
      409,
    );
  const [taken] = await db
    .select({ id: s.organization.id })
    .from(s.organization)
    .where(eq(s.organization.slug, slug));
  if (taken)
    throw new InstanceAdminError(
      "handle_taken",
      `The handle ${slug} is already used by another organization.`,
      409,
    );
  // A server call on the owner's behalf: Better Auth makes them the owner and
  // its hook seeds the organization's default work item types.
  const organization = await auth.api
    .createOrganization({ body: { name, slug, userId: owner.id } })
    .catch(fromBetterAuth);
  if (!organization)
    throw new InstanceAdminError(
      "not_created",
      "The organization could not be created.",
    );
  await recordInstanceAudit(
    db,
    actor,
    "organization.created",
    { type: "organization", id: organization.id, label: organization.name },
    { slug: organization.slug, ownerId: owner.id, ownerEmail: owner.email },
  );
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    url: new URL(`/${organization.slug}`, platformUrl()).toString(),
  };
}

// The server CLI's first step on a new installation: one verified instance
// administrator and the organization they own. Refused once any instance
// administrator exists (`lictory admin grant` covers recovery).
export async function setUpInstance(
  db: Database,
  input: {
    organization: { name: string; slug?: string };
    administrator: { name: string; email: string; password?: string };
  },
) {
  const cli: InstanceActor = { user: null, via: "cli" };
  const [existing] = await db
    .select({ id: s.user.id })
    .from(s.user)
    .where(eq(s.user.instanceAdmin, true))
    .limit(1);
  if (existing)
    throw new InstanceAdminError(
      "already_set_up",
      "This installation already has an instance administrator. Use lictory admin grant <email> to add another.",
      409,
    );
  if (signInOptions.password && input.administrator.password === undefined)
    throw new InstanceAdminError(
      "password_required",
      "Choose a password for the administrator.",
    );
  const { user } = await createAccount(db, cli, {
    ...input.administrator,
    password: signInOptions.password ? input.administrator.password : undefined,
    instanceAdmin: true,
  });
  const organization = await createOrganization(db, cli, {
    ...input.organization,
    ownerId: user.id,
  });
  await recordInstanceAudit(
    db,
    cli,
    "instance.set_up",
    { type: "user", id: user.id, label: user.email },
    { organizationId: organization.id },
  );
  return { user, organization, url: organization.url };
}

// Newest first; `before` is the cursor of the previous page's last entry.
export async function listInstanceAudit(
  db: Database,
  options: { before?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const [at, id] = options.before?.split("|", 2) ?? [];
  const cursorDate = at ? new Date(at) : null;
  const cursor =
    cursorDate && !Number.isNaN(cursorDate.getTime()) && id
      ? or(
          lt(s.instanceAuditEvent.createdAt, cursorDate),
          and(
            eq(s.instanceAuditEvent.createdAt, cursorDate),
            lt(s.instanceAuditEvent.id, id),
          ),
        )
      : undefined;
  const rows = await db
    .select()
    .from(s.instanceAuditEvent)
    .where(cursor)
    .orderBy(
      desc(s.instanceAuditEvent.createdAt),
      desc(s.instanceAuditEvent.id),
    )
    .limit(limit + 1);
  return {
    events: rows.slice(0, limit).map((row) => ({
      id: row.id,
      action: row.action,
      label:
        instanceAuditActions[row.action as InstanceAuditAction] ?? row.action,
      via: row.via,
      actor: row.actorId
        ? { id: row.actorId, name: row.actorName, email: row.actorEmail }
        : null,
      target: row.targetId
        ? { type: row.targetType, id: row.targetId, label: row.targetLabel }
        : null,
      detail: row.detail,
      createdAt: row.createdAt,
    })),
    before:
      rows.length > limit
        ? `${rows[limit - 1]!.createdAt.toISOString()}|${rows[limit - 1]!.id}`
        : null,
  };
}
