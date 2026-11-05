import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, canManageProject } from "@lictory/core/contracts/protocol";
import {
  applyMutation,
  authorize,
  directory,
  isAdmin,
  lock,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { DomainError } from "@lictory/core/domain/errors";

export const placementSchema = z.object({
  projectId: z.string().min(1).max(160),
  disciplineIds: z.array(z.string().min(1).max(160)).max(100).default([]),
});
type Placement = z.infer<typeof placementSchema>;

// Request-local intent reaches the email callback before a link can be used,
// including resend and failed email delivery. Better Auth owns the invitation.
export const invitationIntent = new AsyncLocalStorage<{
  organizationId: string;
  inviterId: string;
  placement?: Placement;
}>();

export async function validateInvitationPlacement(
  db: Database | Tx,
  actorId: string,
  organizationId: string,
  placement: Placement,
) {
  const membership = await authorize(db, actorId, organizationId);
  const roster = await directory(db, actorId, organizationId);
  if (
    !isAdmin(membership) ||
    !canManageProject(roster, actorId, isAdmin(membership), placement.projectId)
  )
    throw new DomainError(
      "forbidden",
      "You must be allowed to invite and administer this project.",
    );
  const project = roster.projects.find(
    (p) => p.id === placement.projectId && !p.archivedAt,
  );
  if (
    !project ||
    placement.disciplineIds.some(
      (id) =>
        !roster.disciplines.some(
          (d) => d.id === id && d.projectId === project.id && !d.archivedAt,
        ),
    )
  )
    throw new DomainError(
      "validation",
      "Choose a project and disciplines in this organization.",
    );
}

export async function storeInvitationPlacement(
  db: Database,
  invitationId: string,
) {
  const intent = invitationIntent.getStore();
  if (!intent) return;
  await db.transaction(async (tx) => {
    await lock(tx, intent.organizationId);
    const [invitation] = await tx
      .select()
      .from(s.invitation)
      .where(
        and(
          eq(s.invitation.id, invitationId),
          eq(s.invitation.organizationId, intent.organizationId),
          eq(s.invitation.inviterId, intent.inviterId),
          eq(s.invitation.status, "pending"),
        ),
      );
    if (!invitation)
      throw new DomainError("forbidden", "This invitation cannot be changed.");
    if (intent.placement) {
      await validateInvitationPlacement(
        tx,
        intent.inviterId,
        intent.organizationId,
        intent.placement,
      );
      await tx
        .insert(s.invitationPlacement)
        .values({
          invitationId,
          organizationId: intent.organizationId,
          ...intent.placement,
        })
        .onConflictDoUpdate({
          target: s.invitationPlacement.invitationId,
          set: { ...intent.placement, appliedAt: null },
        });
    } else {
      await tx
        .delete(s.invitationPlacement)
        .where(
          and(
            eq(s.invitationPlacement.invitationId, invitationId),
            eq(s.invitationPlacement.organizationId, intent.organizationId),
          ),
        );
    }
  });
}

// Placement is best effort. Organization membership has already been accepted;
// no placement failure may undo it. The marker and normal domain mutations
// commit together, so a repeated hook never overwrites later membership edits.
export async function applyInvitationPlacement(
  db: Database,
  invitationId: string,
  organizationId: string,
  userId: string,
) {
  try {
    await db.transaction(async (tx) => {
      await lock(tx, organizationId);
      const [row] = await tx
        .select({ placement: s.invitationPlacement, invitation: s.invitation })
        .from(s.invitationPlacement)
        .innerJoin(
          s.invitation,
          and(
            eq(s.invitation.id, s.invitationPlacement.invitationId),
            eq(
              s.invitation.organizationId,
              s.invitationPlacement.organizationId,
            ),
          ),
        )
        .where(
          and(
            eq(s.invitationPlacement.invitationId, invitationId),
            eq(s.invitationPlacement.organizationId, organizationId),
          ),
        );
      if (
        !row ||
        row.placement.appliedAt ||
        row.invitation.status !== "accepted"
      )
        return;
      const actorId = row.invitation.inviterId;
      const membership = await authorize(tx, actorId, organizationId);
      if (!isAdmin(membership)) return; // Better Auth invitation:create authority.
      const roster = await directory(tx, actorId, organizationId);
      const project = roster.projects.find(
        (p) => p.id === row.placement.projectId && !p.archivedAt,
      );
      if (
        !project ||
        !canManageProject(roster, actorId, isAdmin(membership), project.id)
      )
        return;
      const actor = { userId: actorId };
      const mutate = (
        command: Parameters<typeof applyMutation>[2]["command"],
      ) =>
        applyMutation(tx, actor, {
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId,
          command,
        });
      // Preserve an existing project administrator role.
      if (
        !roster.projectMembers.some(
          (m) => m.projectId === project.id && m.userId === userId,
        )
      )
        await mutate({
          type: "setProjectMember",
          projectId: project.id,
          userId,
          role: "member",
        });
      for (const disciplineId of new Set(row.placement.disciplineIds)) {
        if (
          !roster.disciplines.some(
            (d) =>
              d.id === disciplineId &&
              d.projectId === project.id &&
              !d.archivedAt,
          )
        )
          continue;
        await mutate({
          type: "setDisciplineMember",
          projectId: project.id,
          disciplineId,
          userId,
          member: true,
        });
      }
      await tx
        .update(s.invitationPlacement)
        .set({ appliedAt: new Date() })
        .where(
          and(
            eq(s.invitationPlacement.invitationId, invitationId),
            eq(s.invitationPlacement.organizationId, organizationId),
          ),
        );
    });
  } catch {
    // Acceptance must remain successful even if the inviter lost access, the
    // organization is held, or a concurrent configuration change prevents placement.
  }
}
