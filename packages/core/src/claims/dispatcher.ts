import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { capabilitiesOf } from "@lictory/core/contracts/protocol";
import { claim as claimMachine } from "@lictory/core/contracts/state-machines";
import { claimability } from "@lictory/core/claims/claimability";
import {
  effectiveAutonomy,
  policyStarter,
} from "@lictory/core/claims/contracts";
import {
  claimPorts,
  type SessionLaunchResult,
} from "@lictory/core/claims/ports";
import { claimOrganizationEntities } from "@lictory/core/claims/projections";
import { followItemClaim } from "@lictory/core/claims/follow";
import {
  CLAIM_LEASE_MS,
  STARTING_LEASE_MS,
  claimDetail,
  endClaim,
  recordActivity,
} from "@lictory/core/claims/records";
import {
  derivedMutationId,
  expireStaleClaims,
  followDefinitionOfDone,
  isHeld,
  projectClaims,
  projectFacts,
  recordDispatchFailure,
} from "@lictory/core/claims/service";
import { requireStep } from "@lictory/core/domain/errors";
import {
  applyMutation,
  lock,
  organizationDirectory,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { PROTOCOL } from "@lictory/core/contracts/protocol";

// The factory dispatcher (docs/internals/claims.md#the-dispatcher):
// deterministic worker code, not a model. Each run, per organization under
// its lock: expire claims whose lease ran out, follow the Definition of Done
// of claimed work (completions and Autopilot merges), then reserve claimable
// items in rank order for Build and Autopilot projects up to their
// concurrency limit. Sessions are launched outside any transaction and each
// launch is settled in its own. A reservation is a claim, so the database's
// one-live-claim-per-item index makes a second session for one item
// impossible, whichever worker runs.

type Reservation = {
  claimId: string;
  organizationId: string;
  projectId: string;
  workItemId: string;
  itemKey: string;
  agentId: string;
  ownerId: string;
  // The policy that dispatched it and the administrator who set it: the
  // start is attributed to them, the owner stays accountable.
  policy: { level: "build" | "autopilot"; setById: string; label: string };
};

// Organizations with something for the dispatcher to do: live claims, or a
// project on Build or Autopilot.
async function activeOrganizations(db: Database) {
  const rows = await db.execute<{ organization_id: string }>(sql`
    select organization_id from ${s.workItemClaim}
      where state in ('starting', 'active', 'waiting')
    union
    select organization_id from ${s.autonomyPolicy} where level <> 'assist'`);
  return [...rows].map((r) => r.organization_id);
}

async function reserve(
  tx: Tx,
  organizationId: string,
  now: Date,
): Promise<Reservation[]> {
  const policies = await tx
    .select()
    .from(s.autonomyPolicy)
    .where(
      and(
        eq(s.autonomyPolicy.organizationId, organizationId),
        ne(s.autonomyPolicy.level, "assist"),
      ),
    );
  if (!policies.length) return [];
  const roster = await organizationDirectory(tx, organizationId);
  const agents = await claimPorts().agents.agents(tx, organizationId);
  const reservations: Reservation[] = [];
  for (const row of policies) {
    const policy = effectiveAutonomy(row);
    const project = roster.projects.find((p) => p.id === row.projectId);
    if (!project || project.archivedAt || project.deliveryMode !== "native")
      continue;
    // Agents the policy names that can still start work here.
    const implementers = policy.implementerAgentIds
      .map((id) => agents.find((a) => a.id === id))
      .filter(
        (a): a is NonNullable<typeof a> =>
          Boolean(a) &&
          a!.dispatchable &&
          (!a!.projectIds || a!.projectIds.includes(project.id)) &&
          capabilitiesOf(roster.disciplines, a!.ownerId, project.id)
            .changeProperties,
      );
    if (!implementers.length) continue;
    const level = row.level === "autopilot" ? "autopilot" : "build";
    const dispatchedBy = {
      level,
      setById: row.updatedById,
      label: policyStarter(
        { level, setById: row.updatedById },
        roster.members.find((m) => m.id === row.updatedById)?.name ??
          roster.formerMembers.find((m) => m.id === row.updatedById)?.name ??
          "a former member",
      ),
    } as const;
    const facts = await projectFacts(
      tx,
      organizationId,
      project.id,
      roster,
      now,
    );
    let capacity = policy.maxConcurrentSessions - facts.claims.length;
    if (capacity <= 0) continue;
    const waitingUntil = new Map(
      (
        await tx
          .select()
          .from(s.dispatchBackoff)
          .where(
            and(
              eq(s.dispatchBackoff.organizationId, organizationId),
              inArray(
                s.dispatchBackoff.workItemId,
                facts.items.map((i) => i.id),
              ),
            ),
          )
      ).map((b) => [b.workItemId, b]),
    );
    const load = new Map(
      implementers.map((a) => [
        a.id,
        facts.claims.filter((c) => c.agentId === a.id).length,
      ]),
    );
    const candidates = [...facts.items]
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
      .filter((item) => {
        const backoff = waitingUntil.get(item.id);
        if (backoff && (isHeld(backoff) || backoff.nextAttemptAt > now))
          return false;
        return claimability(item, facts.facts).claimable;
      });
    for (const item of candidates) {
      if (capacity <= 0) break;
      // Work a person owns stays theirs: an item assigned to someone goes
      // only to an implementer acting for that person (their own agent);
      // unassigned work goes to anyone. People still start sessions on
      // assigned work themselves.
      const eligible = item.assigneeId
        ? implementers.filter((a) => a.ownerId === item.assigneeId)
        : implementers;
      if (!eligible.length) continue;
      // The least busy implementer; ties go to the policy's order.
      const agent = [...eligible].sort(
        (a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0),
      )[0]!;
      const [claim] = await tx
        .insert(s.workItemClaim)
        .values({
          organizationId,
          projectId: project.id,
          workItemId: item.id,
          agentId: agent.id,
          agentName: agent.name.slice(0, 80),
          ownerId: agent.ownerId,
          source: "dispatcher",
          state: "starting",
          leaseExpiresAt: new Date(now.getTime() + STARTING_LEASE_MS),
          fromStatusId: item.statusId,
          createdAt: now,
        })
        .returning();
      load.set(agent.id, (load.get(agent.id) ?? 0) + 1);
      capacity--;
      reservations.push({
        claimId: claim!.id,
        organizationId,
        projectId: project.id,
        workItemId: item.id,
        itemKey: facts.key(item),
        agentId: agent.id,
        ownerId: agent.ownerId,
        policy: dispatchedBy,
      });
    }
    await projectClaims(tx, organizationId, project.id, facts.entities);
  }
  return reservations;
}

// Settles one launch under the organization lock: a started session
// activates its claim and starts work on the item; a refusal releases the
// reservation and backs the item off.
async function settle(
  tx: Tx,
  reservation: Reservation,
  result: SessionLaunchResult,
  now: Date,
) {
  const { organizationId, projectId } = reservation;
  await lock(tx, organizationId);
  const before = await claimOrganizationEntities(tx, organizationId, projectId);
  const [claim] = await tx
    .select()
    .from(s.workItemClaim)
    .where(
      and(
        eq(s.workItemClaim.organizationId, organizationId),
        eq(s.workItemClaim.id, reservation.claimId),
      ),
    );
  if (!claim) return "missing";
  if (claim.state !== "starting") {
    // Released (or expired) while the session was starting: tell the
    // session its claim is gone.
    if (result.started)
      await claimPorts().resumer.resume(tx, {
        kind: "claim_ended",
        organizationId,
        claimId: claim.id,
        agentSessionId: result.sessionId,
        workItemId: claim.workItemId,
        state: "released",
        reason: claim.endReason ?? "released",
      });
    return "gone";
  }
  const roster = await organizationDirectory(tx, organizationId);
  const fail = async (reason: string, hold: boolean) => {
    await endClaim(tx, claim, {
      state: "released",
      reason: "launch_failed",
      note: reason,
      byId: null,
      now,
    });
    const backoff = await recordDispatchFailure(
      tx,
      organizationId,
      claim.workItemId,
      reason,
      now,
      { hold },
    );
    await recordActivity(tx, {
      organizationId,
      projectId,
      workItemId: claim.workItemId,
      actorId: claim.ownerId,
      action: "claim_dispatch_failed",
      detail: {
        ...claimDetail(claim),
        reason,
        failures: backoff.failures,
        held: backoff.held,
        nextAttemptAt: backoff.held
          ? null
          : backoff.nextAttemptAt.toISOString(),
        automation: "dispatcher",
      },
      at: now,
    });
  };
  let outcome: "started" | "refused" = "refused";
  if (!result.started) await fail(result.reason, !result.retryable);
  else {
    // The item may have changed while the session started.
    const facts = await projectFacts(
      tx,
      organizationId,
      projectId,
      roster,
      now,
      {
        ignoreClaimId: claim.id,
      },
    );
    const item = facts.items.find((i) => i.id === claim.workItemId);
    const verdict = item && claimability(item, facts.facts);
    if (!verdict?.claimable) {
      await fail(
        `It stopped being claimable while the session started: ${verdict?.reasons.map((r) => r.message).join(" ") ?? "the item is unavailable."}`,
        false,
      );
      await claimPorts().resumer.resume(tx, {
        kind: "claim_ended",
        organizationId,
        claimId: claim.id,
        agentSessionId: result.sessionId,
        workItemId: claim.workItemId,
        state: "released",
        reason: "launch_failed",
      });
    } else {
      requireStep(claimMachine, claim.state, "activate");
      const started = roster.statuses
        .filter(
          (x) =>
            x.projectId === projectId &&
            x.category === "started" &&
            !x.archivedAt,
        )
        .sort((a, b) => a.position - b.position)[0]!;
      const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);
      try {
        await tx.transaction(async (inner) => {
          await inner
            .update(s.workItemClaim)
            .set({
              state: "active",
              agentSessionId: result.sessionId,
              startedStatusId: started.id,
              leaseExpiresAt,
            })
            .where(
              and(
                eq(s.workItemClaim.organizationId, organizationId),
                eq(s.workItemClaim.id, claim.id),
              ),
            );
          await applyMutation(
            inner,
            {
              userId: claim.ownerId,
              surface: "runner",
              agentId: claim.agentId,
              agentName: claim.agentName,
              agentSessionId: result.sessionId,
              automation: "dispatcher",
            },
            {
              protocol: PROTOCOL,
              id: derivedMutationId(claim.id, "start"),
              organizationId,
              command: {
                type: "updateWorkItem",
                workItemId: claim.workItemId,
                statusId: started.id,
              },
            },
          );
          await recordActivity(inner, {
            organizationId,
            projectId,
            workItemId: claim.workItemId,
            actorId: claim.ownerId,
            action: "claimed",
            detail: {
              ...claimDetail({ ...claim, agentSessionId: result.sessionId }),
              leaseExpiresAt: leaseExpiresAt.toISOString(),
              automation: "dispatcher",
              performedVia: "runner",
              // "dispatched by the Build policy (set by Ada)".
              policy: {
                level: reservation.policy.level,
                setById: reservation.policy.setById,
              },
              policyLabel: reservation.policy.label,
            },
            at: now,
          });
        });
        outcome = "started";
      } catch (error) {
        const reason = `Work could not start: ${error instanceof Error ? error.message : "the item could not move to a started status"}`;
        await fail(reason, true);
        await claimPorts().resumer.resume(tx, {
          kind: "claim_ended",
          organizationId,
          claimId: claim.id,
          agentSessionId: result.sessionId,
          workItemId: claim.workItemId,
          state: "released",
          reason: "launch_failed",
        });
      }
    }
  }
  await projectClaims(tx, organizationId, projectId, before);
  return outcome;
}

// Claims whose item left their reach without an item command (workflow
// configuration moved it: a status archived or recategorized) end here, the
// way `followItemClaim` ends them for every command.
async function reconcileClaims(tx: Tx, organizationId: string, now: Date) {
  const live = await tx
    .select()
    .from(s.workItemClaim)
    .where(
      and(
        eq(s.workItemClaim.organizationId, organizationId),
        inArray(s.workItemClaim.state, ["starting", "active", "waiting"]),
      ),
    );
  let ended = 0;
  for (const claim of live) {
    const before = await claimOrganizationEntities(
      tx,
      organizationId,
      claim.projectId,
    );
    const entries = await followItemClaim(tx, {
      organizationId,
      workItemId: claim.workItemId,
      userId: claim.ownerId,
      now,
      automation: "dispatcher",
    });
    if (!entries.length) continue;
    ended++;
    for (const entry of entries)
      await recordActivity(tx, {
        organizationId,
        projectId: claim.projectId,
        workItemId: claim.workItemId,
        actorId: claim.ownerId,
        action: entry.action,
        detail: { ...entry.detail, automation: "dispatcher" },
        at: now,
      });
    await projectClaims(tx, organizationId, claim.projectId, before);
  }
  return ended;
}

export type DispatchResult = {
  organizations: number;
  expired: number;
  completed: number;
  merges: number;
  reserved: number;
  started: number;
  refused: number;
  failedOrganizations: number;
};

// One dispatcher run. Idempotent and safe to run concurrently in several
// workers: every decision is made under the organization lock from stored
// state and `now`.
export async function runDispatcher(
  db: Database,
  options: { now?: () => Date; signal?: AbortSignal } = {},
): Promise<DispatchResult> {
  const clock = options.now ?? (() => new Date());
  const result: DispatchResult = {
    organizations: 0,
    expired: 0,
    completed: 0,
    merges: 0,
    reserved: 0,
    started: 0,
    refused: 0,
    failedOrganizations: 0,
  };
  for (const organizationId of await activeOrganizations(db)) {
    if (options.signal?.aborted) break;
    result.organizations++;
    try {
      const reservations = await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const now = clock();
        const roster = await organizationDirectory(tx, organizationId);
        result.expired += await expireStaleClaims(
          tx,
          organizationId,
          roster,
          now,
        );
        result.expired += await reconcileClaims(tx, organizationId, now);
        const claimed = await tx
          .select({ workItemId: s.workItemClaim.workItemId })
          .from(s.workItemClaim)
          .where(
            and(
              eq(s.workItemClaim.organizationId, organizationId),
              inArray(s.workItemClaim.state, ["starting", "active", "waiting"]),
            ),
          )
          .orderBy(asc(s.workItemClaim.createdAt));
        const followed = await followDefinitionOfDone(
          tx,
          organizationId,
          claimed.map((c) => c.workItemId),
          roster,
        );
        result.completed += followed.completed;
        result.merges += followed.merges;
        return reserve(tx, organizationId, now);
      });
      result.reserved += reservations.length;
      for (const reservation of reservations) {
        let launched: SessionLaunchResult;
        try {
          launched = await claimPorts().launcher.launch({
            organizationId,
            projectId: reservation.projectId,
            workItemId: reservation.workItemId,
            itemKey: reservation.itemKey,
            claimId: reservation.claimId,
            agentId: reservation.agentId,
            ownerId: reservation.ownerId,
            idempotencyKey: reservation.claimId,
          });
        } catch (error) {
          launched = {
            started: false,
            reason: `The session could not be started: ${error instanceof Error ? error.message : String(error)}`,
            retryable: true,
          };
        }
        const settled = await db.transaction((tx) =>
          settle(tx, reservation, launched, clock()),
        );
        if (settled === "started") result.started++;
        else if (settled === "refused") result.refused++;
      }
    } catch (error) {
      result.failedOrganizations++;
      console.error(
        JSON.stringify({
          event: "dispatcher.organization_failed",
          organizationId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return result;
}
