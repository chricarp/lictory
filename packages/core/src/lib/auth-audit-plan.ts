import type { AuditActor, AuditRecord } from "@lictory/core/domain/audit";

// Maps successful Better Auth membership calls to audit records. Pure (apart
// from the remembered previous roles), so the mapping is tested without
// Better Auth or a database; lib/auth-audit.ts writes the records.

type Json = Record<string, unknown>;

const record = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
const text = (value: unknown) => (typeof value === "string" ? value : null);

// Better Auth hands the previous role only to its organization hook, which
// runs inside the endpoint, before the after hook records the change.
const previousRoles = new Map<string, string>();
export function rememberPreviousRole(memberId: string, role: string) {
  previousRoles.set(memberId, role);
}

// Better Auth paths that change membership; only these are audited.
export const auditedAuthPaths: ReadonlySet<string> = new Set([
  "/organization/create",
  "/organization/update",
  "/organization/add-member",
  "/organization/remove-member",
  "/organization/leave",
  "/organization/update-member-role",
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
]);

export type Planned = AuditRecord & {
  // The account a member target refers to; its name and email become the label.
  targetUserId?: string;
};

// Maps one successful Better Auth call to its audit record. Pure, so the
// mapping is tested without Better Auth.
export function plannedAuthAudit(
  path: string,
  body: unknown,
  returned: unknown,
  actor: AuditActor | null,
): Planned | null {
  const result = record(returned);
  const input = record(body);
  if (!result) return null;
  const member = (value: unknown) => {
    const m = record(value);
    const organizationId = text(m?.organizationId);
    const userId = text(m?.userId);
    const id = text(m?.id);
    return m && organizationId && userId && id
      ? { id, organizationId, userId, role: text(m.role) }
      : null;
  };
  const invitation = (value: unknown) => {
    const i = record(value);
    const organizationId = text(i?.organizationId);
    const id = text(i?.id);
    return i && organizationId && id
      ? { id, organizationId, email: text(i.email), role: text(i.role) }
      : null;
  };
  switch (path) {
    case "/organization/update-member-role": {
      const m = member(result);
      if (!m || !actor) return null;
      const from = previousRoles.get(m.id) ?? null;
      previousRoles.delete(m.id);
      return {
        organizationId: m.organizationId,
        actor,
        action: "member.role_changed",
        target: { type: "member", id: m.userId },
        targetUserId: m.userId,
        detail: { memberId: m.id, from, to: m.role },
      };
    }
    case "/organization/add-member": {
      const m = member(result);
      if (!m) return null;
      return {
        organizationId: m.organizationId,
        actor,
        action: "member.added",
        target: { type: "member", id: m.userId },
        targetUserId: m.userId,
        detail: { memberId: m.id, role: m.role },
      };
    }
    case "/organization/remove-member": {
      const m = member(result.member);
      if (!m || !actor) return null;
      return {
        organizationId: m.organizationId,
        actor,
        action: m.userId === actor.id ? "member.left" : "member.removed",
        target: { type: "member", id: m.userId },
        targetUserId: m.userId,
        detail: { memberId: m.id, role: m.role },
      };
    }
    case "/organization/leave": {
      const organizationId = text(input?.organizationId);
      if (!organizationId || !actor) return null;
      return { organizationId, actor, action: "member.left" };
    }
    case "/organization/invite-member":
    case "/organization/cancel-invitation": {
      const i = invitation(result);
      if (!i || !actor) return null;
      return {
        organizationId: i.organizationId,
        actor,
        action:
          path === "/organization/invite-member"
            ? "invitation.created"
            : "invitation.cancelled",
        target: { type: "invitation", id: i.id, label: i.email },
        detail: { role: i.role },
      };
    }
    case "/organization/accept-invitation":
    case "/organization/reject-invitation": {
      const i = invitation(result.invitation);
      if (!i || !actor) return null;
      const accepted = path === "/organization/accept-invitation";
      return {
        organizationId: i.organizationId,
        actor,
        action: accepted ? "member.joined" : "invitation.rejected",
        target: { type: "invitation", id: i.id, label: i.email },
        detail: accepted ? { role: member(result.member)?.role ?? i.role } : {},
      };
    }
    case "/organization/create": {
      const id = text(result.id);
      if (!id || !actor) return null;
      return {
        organizationId: id,
        actor,
        action: "organization.created",
        detail: { name: text(result.name), slug: text(result.slug) },
      };
    }
    case "/organization/update": {
      const id = text(result.id);
      const changes = record(input?.data);
      if (!id || !actor || !changes) return null;
      const detail: Json = {};
      for (const field of ["name", "slug"] as const)
        if (field in changes) detail[field] = text(result[field]);
      if (!Object.keys(detail).length) return null;
      return {
        organizationId: id,
        actor,
        action: "organization.updated",
        detail,
      };
    }
    default:
      return null;
  }
}
