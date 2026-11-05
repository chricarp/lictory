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
    // Any administrator may resend an invitation (Better Auth keeps the
    // original inviter); the placement records who chose it.
    const [invitation] = await tx
      .select()
      .from(s.invitation)
      .where(
        and(
          eq(s.invitation.id, invitationId),
          eq(s.invitation.organizationId, intent.organizationId),
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
      const values = {
        ...intent.placement,
        placedById: intent.inviterId,
        appliedAt: null,
        outcome: null,
      };
      await tx
        .insert(s.invitationPlacement)
        .values({
          invitationId,
          organizationId: intent.organizationId,
          ...values,
        })
        .onConflictDoUpdate({
          target: s.invitationPlacement.invitationId,
          set: values,
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

export type PlacementOutcome = NonNullable<
  typeof s.invitationPlacement.$inferSelect.outcome
>;

// Placement is best effort: organization membership has already been
// accepted and nothing here may undo it. Whatever happens is recorded as the
// placement's outcome (applied, partial or skipped, naming what is missing),
// so the invitee is told instead of discovering it later. The marker and the
// domain mutations commit together, so a repeated hook never overwrites later
// membership edits.
export async function applyInvitationPlacement(
  db: Database,
  invitationId: string,
  organizationId: string,
  userId: string,
) {
  const where = and(
    eq(s.invitationPlacement.invitationId, invitationId),
    eq(s.invitationPlacement.organizationId, organizationId),
  );
  const record = (tx: Database | Tx, outcome: PlacementOutcome) => {
    if (outcome.status !== "applied")
      console.warn("invitation placement not fully applied", {
        invitationId,
        organizationId,
        ...outcome,
      });
    return tx
      .update(s.invitationPlacement)
      .set({ appliedAt: new Date(), outcome })
      .where(where);
  };
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
        .where(where);
      if (
        !row ||
        row.placement.appliedAt ||
        row.invitation.status !== "accepted"
      )
        return;
      const actorId = row.placement.placedById ?? row.invitation.inviterId;
      const membership = await authorize(tx, actorId, organizationId).catch(
        () => undefined,
      );
      const roster = membership
        ? await directory(tx, actorId, organizationId)
        : undefined;
      const project = roster?.projects.find(
        (p) => p.id === row.placement.projectId && !p.archivedAt,
      );
      const skipped = (reason: string) =>
        record(tx, { status: "skipped", missing: [], reason });
      if (!membership || !roster || !isAdmin(membership))
        return skipped(
          "The person who chose the project is no longer an administrator.",
        );
      if (!project)
        return skipped("The project is archived or no longer exists.");
      if (!canManageProject(roster, actorId, isAdmin(membership), project.id))
        return skipped(
          "The person who chose the project can no longer manage it.",
        );
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
      const missing: string[] = [];
      for (const disciplineId of new Set(row.placement.disciplineIds)) {
        const discipline = roster.disciplines.find(
          (d) => d.id === disciplineId && d.projectId === project.id,
        );
        if (!discipline || discipline.archivedAt) {
          missing.push(discipline?.name ?? "A removed discipline");
          continue;
        }
        await mutate({
          type: "setDisciplineMember",
          projectId: project.id,
          disciplineId,
          userId,
          member: true,
        });
      }
      await record(tx, {
        status: missing.length ? "partial" : "applied",
        missing,
        ...(missing.length
          ? { reason: "Archived since the invitation was sent." }
          : {}),
      });
    });
  } catch (error) {
    // The transaction rolled back; record why on its own.
    await record(db, {
      status: "skipped",
      missing: [],
      reason: error instanceof Error ? error.message : String(error),
    }).catch((failure: unknown) => {
      console.warn("invitation placement outcome not recorded", {
        invitationId,
        reason: failure instanceof Error ? failure.message : String(failure),
      });
    });
  }
}

// What the accepted invitation granted, for the person who accepted it.
export async function placementOutcomeFor(
  db: Database,
  invitationId: string,
  email: string,
) {
  const [row] = await db
    .select({
      projectId: s.invitationPlacement.projectId,
      organizationId: s.invitationPlacement.organizationId,
      outcome: s.invitationPlacement.outcome,
      email: s.invitation.email,
    })
    .from(s.invitationPlacement)
    .innerJoin(
      s.invitation,
      and(
        eq(s.invitation.id, s.invitationPlacement.invitationId),
        eq(s.invitation.organizationId, s.invitationPlacement.organizationId),
        eq(s.invitation.status, "accepted"),
      ),
    )
    .where(eq(s.invitationPlacement.invitationId, invitationId));
  if (row?.email.toLowerCase() !== email.toLowerCase()) return null;
  return row.outcome;
}
