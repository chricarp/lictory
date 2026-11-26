import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  PROTOCOL,
  canManageProject,
  canOverrideDoneCheck,
  capabilitiesOf,
  type Command,
  type Entity,
  type EntityOf,
} from "@lictory/core/contracts/protocol";
import type { DirectoryProjection } from "@lictory/core/contracts/projection";
import { claim as claimMachine } from "@lictory/core/contracts/state-machines";
import { sectionContent } from "@lictory/core/contracts/readiness";
import {
  claimability,
  type ClaimabilityFacts,
  type ClaimabilityItem,
  type Claimability,
  type LinkedPullRequestFact,
} from "@lictory/core/claims/claimability";
import {
  autonomyPolicyInputSchema,
  doneChecksSchema,
  effectiveAutonomy,
  effectiveDoneChecks,
  type AutonomyPolicyInput,
  type ClaimEntity,
  type DoneCheckDefinition,
} from "@lictory/core/claims/contracts";
import { autopilotMergeCandidate } from "@lictory/core/claims/definition-of-done";
import { claimPorts } from "@lictory/core/claims/ports";
import {
  claimOrganizationEntities,
  doneSubjects,
  evaluateDone,
  syncDoneProjections,
  type DoneEvaluation,
} from "@lictory/core/claims/projections";
import {
  CLAIM_LEASE_MS,
  claimDetail,
  endClaim,
  liveClaimOf,
  recordActivity,
  type ClaimRow,
} from "@lictory/core/claims/records";
import { isTopLevel } from "@lictory/core/lib/work-items";
import { mentionToken } from "@lictory/core/notifications/mentions";
import { DomainError, requireStep } from "@lictory/core/domain/errors";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import { writeProjections } from "@lictory/core/domain/projections";
import {
  applyMutation,
  authorize,
  delegation,
  isAdmin,
  lock,
  organizationDirectory,
  snapshot,
  type Actor,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { signalWork } from "@lictory/core/jobs/signal";

// Claims, agent questions, the autonomy policy and the Definition of Done
// (docs/internals/claims.md). Every writer here takes the organization lock,
// checks membership in the transaction, keeps its idempotency receipt in
// `sync_mutation` and writes its projections in the same transaction. Item
// status changes go through `applyMutation` (`updateWorkItem`), the same
// path a person's board move takes: readiness policy, accepted scope,
// iteration events, activity and notifications all apply.

type Roster = DirectoryProjection;

// ------------------------------------------------------------- writers

type WriteContext = {
  roster: Roster;
  admin: boolean;
  mutationId: string;
  now: Date;
};

// A command of this module: one transaction under the organization lock,
// with a receipt so a retried `mutationId` replays the first answer.
async function write<T extends Record<string, unknown>>(
  db: Database,
  actor: Actor,
  organizationId: string,
  operation: string,
  input: unknown,
  mutationId: string | undefined,
  run: (tx: Tx, ctx: WriteContext) => Promise<T>,
): Promise<T & { mutationId: string; replayed: boolean }> {
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const membership = await authorize(tx, actor.userId, organizationId);
    const id = mutationId ?? crypto.randomUUID();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ operation, input }))
      .digest("hex");
    const [previous] = await tx
      .select()
      .from(s.syncMutation)
      .where(
        and(
          eq(s.syncMutation.organizationId, organizationId),
          eq(s.syncMutation.id, id),
        ),
      );
    if (previous) {
      if (
        previous.userId !== actor.userId ||
        previous.fingerprint !== fingerprint
      )
        throw new DomainError(
          "conflict",
          "Mutation ID was already used for a different command.",
        );
      return {
        ...((previous.summary ?? {}) as T),
        mutationId: id,
        replayed: true,
      };
    }
    const roster = await organizationDirectory(tx, organizationId);
    const result = await run(tx, {
      roster,
      admin: isAdmin(membership),
      mutationId: id,
      now: new Date(),
    });
    await tx.insert(s.syncMutation).values({
      organizationId,
      id,
      userId: actor.userId,
      fingerprint,
      summary: result,
    });
    return { ...result, mutationId: id, replayed: false };
  });
}

// Stable ids for the commands a writer issues through `applyMutation`, so a
// replay of the writer never applies them twice.
export function derivedMutationId(...parts: string[]) {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function command(
  tx: Tx,
  actor: Actor,
  organizationId: string,
  id: string,
  c: Command,
) {
  return applyMutation(tx, actor, {
    protocol: PROTOCOL,
    id,
    organizationId,
    command: c,
  });
}

// The agent behind a call. Claims are agents' leases: people work on items
// by assigning and moving them.
function agentOf(actor: Actor) {
  if (!actor.surface || actor.surface === "web")
    throw new DomainError(
      "forbidden",
      "Claims are held by agents. To work on this yourself, assign it to yourself and move it to a started status.",
      undefined,
      "agent_required",
    );
  if (actor.surface === "agent")
    throw new DomainError(
      "forbidden",
      "Litto does not claim delivery work. Start a runner agent's session, or claim it from an external agent with its own access token.",
      undefined,
      "agent_required",
    );
  if (!actor.agentId)
    throw new DomainError(
      "forbidden",
      "This call carries no agent identity. Use an access token named for the agent.",
      undefined,
      "agent_required",
    );
  const name = actor.agentName?.trim().slice(0, 80) ?? "";
  return { agentId: actor.agentId, agentName: name.length ? name : "Agent" };
}

const holds = (actor: Actor, claim: ClaimRow) =>
  Boolean(actor.agentId) &&
  claim.agentId === actor.agentId &&
  claim.ownerId === actor.userId;

async function claimById(tx: Tx, organizationId: string, claimId: string) {
  const [row] = await tx
    .select()
    .from(s.workItemClaim)
    .where(
      and(
        eq(s.workItemClaim.organizationId, organizationId),
        eq(s.workItemClaim.id, claimId),
      ),
    );
  if (!row) throw new DomainError("not_found", "This claim is unavailable.");
  return row;
}

function requireHolder(actor: Actor, claim: ClaimRow, doing: string) {
  if (!holds(actor, claim))
    throw new DomainError(
      "forbidden",
      `Only ${claim.agentName}, the agent holding this claim, can ${doing}.`,
    );
}

// Writes the organization-level claim projections of a project that
// changed since `before` (a snapshot or claimOrganizationEntities result).
// A claim that appears or ends also decides whether its item's Definition
// of Done is evaluated (claimed work is), so those projections follow.
export async function projectClaims(
  tx: Tx,
  organizationId: string,
  projectId: string,
  before: Entity[],
) {
  const after = await claimOrganizationEntities(tx, organizationId, projectId);
  const owned = new Set(["claim", "autonomyPolicy", "definitionOfDone"]);
  const old = before.filter(
    (e) => owned.has(e.type) && "projectId" in e && e.projectId === projectId,
  );
  await writeProjections(tx, organizationId, old, after);
  const claimed = (entities: Entity[]) =>
    new Set(
      entities.flatMap((e) => (e.type === "claim" ? [e.workItemId] : [])),
    );
  const was = claimed(old);
  const is = claimed(after);
  const changed = [
    ...[...was].filter((id) => !is.has(id)),
    ...[...is].filter((id) => !was.has(id)),
  ];
  if (changed.length) await syncDoneProjections(tx, organizationId, changed);
}

// ---------------------------------------------------------- claimability

export type ProjectFacts = {
  project: EntityOf<"project">;
  items: EntityOf<"workItem">[];
  claims: ClaimEntity[];
  entities: Entity[];
  facts: ClaimabilityFacts;
  key: (item: { projectId: string; number: number }) => string;
};

// The facts claimability is computed from, for one project: its snapshot
// (items, relations, live claims) and the items in other projects that
// block its work.
export async function projectFacts(
  tx: Tx,
  organizationId: string,
  projectId: string,
  roster: Roster,
  now: Date,
  options: { ignoreClaimId?: string } = {},
): Promise<ProjectFacts> {
  const entities = await snapshot(tx, { organizationId, projectId });
  const project = entities.find(
    (e): e is EntityOf<"project"> => e.type === "project" && e.id === projectId,
  );
  if (!project)
    throw new DomainError("not_found", "This project is unavailable.");
  const items = entities.filter(
    (e): e is EntityOf<"workItem"> => e.type === "workItem",
  );
  const claims = entities.filter((e): e is ClaimEntity => e.type === "claim");
  const blocks = await tx
    .select({
      fromId: s.workItemRelation.fromId,
      toId: s.workItemRelation.toId,
    })
    .from(s.workItemRelation)
    .where(
      and(
        eq(s.workItemRelation.organizationId, organizationId),
        eq(s.workItemRelation.kind, "blocks"),
        inArray(
          s.workItemRelation.toId,
          tx
            .select({ id: s.workItem.id })
            .from(s.workItem)
            .where(
              and(
                eq(s.workItem.organizationId, organizationId),
                eq(s.workItem.projectId, projectId),
              ),
            ),
        ),
      ),
    );
  const byId = new Map<string, ClaimabilityItem>(items.map((i) => [i.id, i]));
  const outside = [...new Set(blocks.map((b) => b.fromId))].filter(
    (id) => !byId.has(id),
  );
  if (outside.length)
    for (const row of await tx
      .select()
      .from(s.workItem)
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          inArray(s.workItem.id, outside),
        ),
      ))
      byId.set(row.id, {
        id: row.id,
        projectId: row.projectId,
        typeId: row.typeId,
        parentId: row.parentId,
        number: row.number,
        statusId: row.statusId,
        refinementState: row.refinementState,
        committedRevisionId: row.committedRevisionId,
        committedRevisionNumber: null,
        revisionId: "",
        revisionNumber: 0,
        readinessPassed: 0,
        readinessTotal: 0,
        archivedAt: row.archivedAt?.toISOString() ?? null,
      });
  const blockersOf = new Map<string, string[]>();
  for (const b of blocks)
    blockersOf.set(b.toId, [...(blockersOf.get(b.toId) ?? []), b.fromId]);
  const statuses = new Map(roster.statuses.map((x) => [x.id, x]));
  const types = new Map(roster.types.map((t) => [t.id, t]));
  const keys = new Map(roster.projects.map((p) => [p.id, p.key]));
  const live = new Map(
    claims
      .filter((c) => c.id !== options.ignoreClaimId)
      .map((c) => [c.workItemId, c]),
  );
  const key = (item: { projectId: string; number: number }) =>
    `${keys.get(item.projectId) ?? "?"}-${item.number}`;
  const facts: ClaimabilityFacts = {
    project,
    item: (id) => byId.get(id),
    key,
    category: (id) => statuses.get(id)?.category,
    statusName: (id) => statuses.get(id)?.name,
    hasSpecification: (id) => types.get(id)?.hasSpecification ?? false,
    container: (id) => {
      const type = types.get(id);
      return type ? isTopLevel(type) : false;
    },
    blockers: (id) => blockersOf.get(id) ?? [],
    liveClaim: (id) => live.get(id),
    hasStartedStatus: roster.statuses.some(
      (x) =>
        x.projectId === projectId && x.category === "started" && !x.archivedAt,
    ),
    now,
  };
  // Linked pull requests only matter for work otherwise claimable, so the
  // code evidence is read for those items alone.
  const candidates = items
    .filter((item) => claimability(item, facts).claimable)
    .map((item) => item.id);
  if (candidates.length) {
    const evidence = await claimPorts().evidence.evidence(
      tx,
      organizationId,
      candidates,
    );
    const name = (id: string) =>
      roster.members.find((m) => m.id === id)?.name ??
      roster.formerMembers.find((m) => m.id === id)?.name;
    const linked = new Map<string, LinkedPullRequestFact[]>();
    for (const [itemId, code] of evidence)
      if (code.connected)
        linked.set(
          itemId,
          // Only pull requests whose provenance the code host port knows.
          code.pullRequests.flatMap((pr) =>
            pr.openedByAgent === undefined
              ? []
              : [
                  {
                    number: pr.number ?? null,
                    state: pr.state,
                    openedByAgent: pr.openedByAgent,
                    // A member, or a host login nobody linked, said so
                    // ("ada" alone reads as if it named a teammate).
                    author:
                      (pr.authorId ? name(pr.authorId) : undefined) ??
                      (pr.authorLogin
                        ? `${pr.authorLogin} (a code host login no member has linked)`
                        : null),
                  },
                ],
          ),
        );
    facts.linkedPullRequests = (id) => linked.get(id) ?? [];
  }
  return { project, items, claims, entities, key, facts };
}

// A pull request a person opened keeps the factory off the item, not a
// person: an agent whose session a person started on this very item may
// claim it although one is linked. Every other refusal still holds.
async function startedOnItemByPerson(
  tx: Tx,
  actor: Actor,
  organizationId: string,
  workItemId: string,
  verdict: Claimability,
) {
  if (
    !actor.agentSessionId ||
    verdict.reasons.some((r) => r.code !== "pull_request_linked")
  )
    return false;
  const [session] = await tx
    .select({
      workItemId: s.agentSession.workItemId,
      startedByPolicy: s.agentSession.startedByPolicy,
    })
    .from(s.agentSession)
    .where(
      and(
        eq(s.agentSession.organizationId, organizationId),
        eq(s.agentSession.id, actor.agentSessionId),
      ),
    );
  return session?.workItemId === workItemId && !session.startedByPolicy;
}

function firstStatus(
  roster: Roster,
  projectId: string,
  category: "started" | "done",
) {
  return roster.statuses
    .filter(
      (x) =>
        x.projectId === projectId && x.category === category && !x.archivedAt,
    )
    .sort((a, b) => a.position - b.position)[0];
}

function refusal(key: string, verdict: Claimability) {
  const external = verdict.reasons.some((r) => r.code === "external_delivery");
  return new DomainError(
    external ? "validation" : "conflict",
    `${key} cannot be claimed. ${verdict.reasons
      .map((r) => (r.command ? `${r.message} (${r.command})` : r.message))
      .join(" ")}`,
    undefined,
    external ? "external_delivery" : "not_claimable",
  );
}

// ------------------------------------------------------------ dispatch

const MAX_DISPATCH_FAILURES = 3;
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;
// A held item waits for a person's retry.
const HELD_UNTIL = new Date("9999-12-31T00:00:00Z");

// Records a failed start of a dispatcher claim: exponential backoff, and a
// hold after repeated failures or a failure retrying cannot fix.
export async function recordDispatchFailure(
  tx: Tx,
  organizationId: string,
  workItemId: string,
  reason: string,
  now: Date,
  options: { hold?: boolean } = {},
) {
  const [current] = await tx
    .select()
    .from(s.dispatchBackoff)
    .where(
      and(
        eq(s.dispatchBackoff.organizationId, organizationId),
        eq(s.dispatchBackoff.workItemId, workItemId),
      ),
    );
  const failures = (current?.failures ?? 0) + 1;
  const held = options.hold === true || failures >= MAX_DISPATCH_FAILURES;
  const nextAttemptAt = held
    ? HELD_UNTIL
    : new Date(
        now.getTime() +
          Math.min(BACKOFF_BASE_MS * 4 ** (failures - 1), BACKOFF_MAX_MS),
      );
  const values = {
    failures,
    nextAttemptAt,
    lastError: reason.slice(0, 2000),
    updatedAt: now,
  };
  await tx
    .insert(s.dispatchBackoff)
    .values({ organizationId, workItemId, ...values })
    .onConflictDoUpdate({
      target: [s.dispatchBackoff.organizationId, s.dispatchBackoff.workItemId],
      set: values,
    });
  return { failures, held, nextAttemptAt };
}

export const isHeld = (row: { nextAttemptAt: Date }) =>
  row.nextAttemptAt.getTime() >= HELD_UNTIL.getTime();

// ------------------------------------------------- release and expiry

// Returns a released item to the status it had before the claim started
// work, unless someone moved it since. Through `applyMutation` in a
// savepoint, so a refusal (the person lost the right to change properties)
// keeps the release and explains why the item stayed.
export async function returnItem(
  tx: Tx,
  claim: ClaimRow,
  actor: Actor,
  roster: Roster,
  mutationId: string,
) {
  if (!claim.startedStatusId || !claim.fromStatusId)
    return { returnedTo: null, note: null };
  const [item] = await tx
    .select({ statusId: s.workItem.statusId })
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, claim.organizationId),
        eq(s.workItem.id, claim.workItemId),
      ),
    );
  const from = roster.statuses.find(
    (x) => x.id === claim.fromStatusId && !x.archivedAt,
  );
  if (item?.statusId !== claim.startedStatusId || !from)
    return {
      returnedTo: null,
      note: !from
        ? "Its status before the claim no longer exists; it stays where it is."
        : "It was moved since the claim started, so it stays where it is.",
    };
  try {
    await tx.transaction((inner) =>
      command(inner, actor, claim.organizationId, mutationId, {
        type: "updateWorkItem",
        workItemId: claim.workItemId,
        statusId: from.id,
      }),
    );
    return { returnedTo: from.name, note: null };
  } catch (error) {
    return {
      returnedTo: null,
      note: `It stays where it is: ${error instanceof Error ? error.message : "the status could not change"}`,
    };
  }
}

// Releases a claim whose lease ran out (starting or active claims; a
// waiting claim holds the item until its question is resolved).
export async function expireClaim(
  tx: Tx,
  claim: ClaimRow,
  roster: Roster,
  now: Date,
) {
  await endClaim(tx, claim, {
    state: "released",
    reason: "expired",
    byId: null,
    now,
  });
  const returned = await returnItem(
    tx,
    claim,
    { userId: claim.ownerId, automation: "lease_expired" },
    roster,
    derivedMutationId(claim.id, "expired"),
  );
  if (claim.source === "dispatcher")
    await recordDispatchFailure(
      tx,
      claim.organizationId,
      claim.workItemId,
      `${claim.agentName}'s lease expired without renewal.`,
      now,
    );
  await recordActivity(tx, {
    organizationId: claim.organizationId,
    projectId: claim.projectId,
    workItemId: claim.workItemId,
    actorId: claim.ownerId,
    action: "claim_released",
    detail: {
      ...claimDetail(claim),
      reason: "expired",
      automation: "lease_expired",
      returnedTo: returned.returnedTo,
      ...(returned.note ? { note: returned.note } : {}),
    },
    at: now,
  });
}

// Expires every starting or active claim of the organization whose lease
// ended. Returns how many.
export async function expireStaleClaims(
  tx: Tx,
  organizationId: string,
  roster: Roster,
  now: Date,
) {
  const stale = await tx
    .select()
    .from(s.workItemClaim)
    .where(
      and(
        eq(s.workItemClaim.organizationId, organizationId),
        inArray(s.workItemClaim.state, ["starting", "active"]),
        sql`${s.workItemClaim.leaseExpiresAt} < ${now.toISOString()}`,
      ),
    )
    .orderBy(asc(s.workItemClaim.leaseExpiresAt));
  const byProject = new Map<string, ClaimRow[]>();
  for (const claim of stale)
    byProject.set(claim.projectId, [
      ...(byProject.get(claim.projectId) ?? []),
      claim,
    ]);
  for (const [projectId, claims] of byProject) {
    const before = await claimOrganizationEntities(
      tx,
      organizationId,
      projectId,
    );
    for (const claim of claims) await expireClaim(tx, claim, roster, now);
    await projectClaims(tx, organizationId, projectId, before);
  }
  return stale.length;
}

const isExpired = (claim: ClaimRow, now: Date) =>
  (claim.state === "starting" || claim.state === "active") &&
  claim.leaseExpiresAt.getTime() < now.getTime();

// ------------------------------------------------------------- claiming

// Starts work under a claim that holds the item: records the statuses and
// moves the item to the project's first started status through
// `applyMutation`, attributed to the agent acting for its owner.
async function startWork(
  tx: Tx,
  claim: ClaimRow,
  actor: Actor,
  roster: Roster,
  mutationId: string,
) {
  const started = firstStatus(roster, claim.projectId, "started");
  if (!started)
    throw new DomainError(
      "validation",
      "The workflow has no active started status to move claimed work into.",
    );
  await tx
    .update(s.workItemClaim)
    .set({ startedStatusId: started.id })
    .where(
      and(
        eq(s.workItemClaim.organizationId, claim.organizationId),
        eq(s.workItemClaim.id, claim.id),
      ),
    );
  await command(tx, actor, claim.organizationId, mutationId, {
    type: "updateWorkItem",
    workItemId: claim.workItemId,
    statusId: started.id,
  });
  return started;
}

export async function claimItem(
  db: Database,
  actor: Actor,
  input: { organizationId: string; workItemId: string; mutationId?: string },
) {
  const agent = agentOf(actor);
  return write(
    db,
    actor,
    input.organizationId,
    "claimItem",
    { workItemId: input.workItemId, agentId: agent.agentId },
    input.mutationId,
    async (tx, { roster, mutationId, now }) => {
      const organizationId = input.organizationId;
      const [row] = await tx
        .select({ projectId: s.workItem.projectId })
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, organizationId),
            eq(s.workItem.id, input.workItemId),
          ),
        );
      if (!row) throw new DomainError("not_found", "This item is unavailable.");
      // A claim whose lease ran out no longer holds the item.
      const held = await liveClaimOf(tx, organizationId, input.workItemId);
      if (held && isExpired(held, now)) {
        const before = await claimOrganizationEntities(
          tx,
          organizationId,
          row.projectId,
        );
        await expireClaim(tx, held, roster, now);
        await projectClaims(tx, organizationId, row.projectId, before);
      }
      const facts = await projectFacts(
        tx,
        organizationId,
        row.projectId,
        roster,
        now,
      );
      const item = facts.items.find((i) => i.id === input.workItemId)!;
      const key = facts.key(item);
      // The holder asking again (a retry that lost the answer and sent no
      // mutationId) gets its own live claim back instead of a conflict.
      // Only the same agent, for the same person, in the same session.
      if (
        held &&
        !isExpired(held, now) &&
        held.agentId === agent.agentId &&
        held.ownerId === actor.userId &&
        (held.agentSessionId ?? null) === (actor.agentSessionId ?? null)
      )
        return {
          claimId: held.id,
          workItemId: item.id,
          key,
          state: held.state,
          status:
            roster.statuses.find((x) => x.id === item.statusId)?.name ?? null,
          leaseExpiresAt: held.leaseExpiresAt.toISOString(),
          alreadyHeld: true,
        };
      const verdict = claimability(item, facts.facts);
      if (
        !verdict.claimable &&
        !(await startedOnItemByPerson(
          tx,
          actor,
          organizationId,
          item.id,
          verdict,
        ))
      )
        throw refusal(key, verdict);
      const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);
      const [claim] = await tx
        .insert(s.workItemClaim)
        .values({
          organizationId,
          projectId: row.projectId,
          workItemId: item.id,
          agentId: agent.agentId,
          agentName: agent.agentName,
          agentSessionId: actor.agentSessionId ?? null,
          ownerId: actor.userId,
          source: "agent",
          state: "active",
          leaseExpiresAt,
          fromStatusId: item.statusId,
          createdAt: now,
        })
        .returning();
      const started = await startWork(
        tx,
        claim!,
        actor,
        roster,
        derivedMutationId(mutationId, "start"),
      );
      await recordActivity(tx, {
        organizationId,
        projectId: row.projectId,
        workItemId: item.id,
        actorId: actor.userId,
        action: "claimed",
        detail: {
          ...claimDetail(claim!),
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          ...delegation(actor),
        },
        at: now,
      });
      await projectClaims(tx, organizationId, row.projectId, facts.entities);
      return {
        claimId: claim!.id,
        workItemId: item.id,
        key,
        state: "active",
        status: started.name,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      };
    },
  );
}

const leaseBounds = { min: 60, max: 60 * 60 };

export async function renewClaim(
  db: Database,
  actor: Actor,
  input: { organizationId: string; claimId: string; leaseSeconds?: number },
) {
  agentOf(actor);
  return db.transaction(async (tx) => {
    await lock(tx, input.organizationId);
    await authorize(tx, actor.userId, input.organizationId);
    const claim = await claimById(tx, input.organizationId, input.claimId);
    requireStep(claimMachine, claim.state, "renew");
    requireHolder(actor, claim, "renew it");
    const seconds = Math.min(
      leaseBounds.max,
      Math.max(leaseBounds.min, input.leaseSeconds ?? CLAIM_LEASE_MS / 1000),
    );
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + seconds * 1000);
    const before = await claimOrganizationEntities(
      tx,
      input.organizationId,
      claim.projectId,
    );
    await tx
      .update(s.workItemClaim)
      .set({ leaseExpiresAt })
      .where(
        and(
          eq(s.workItemClaim.organizationId, input.organizationId),
          eq(s.workItemClaim.id, claim.id),
        ),
      );
    await projectClaims(tx, input.organizationId, claim.projectId, before);
    return {
      claimId: claim.id,
      state: claim.state,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    };
  });
}

export async function releaseClaim(
  db: Database,
  actor: Actor,
  input: {
    organizationId: string;
    claimId: string;
    note?: string;
    mutationId?: string;
  },
) {
  return write(
    db,
    actor,
    input.organizationId,
    "releaseClaim",
    { claimId: input.claimId, note: input.note ?? null },
    input.mutationId,
    async (tx, { roster, admin, mutationId, now }) => {
      const claim = await claimById(tx, input.organizationId, input.claimId);
      requireStep(claimMachine, claim.state, "release");
      const holder = holds(actor, claim);
      if (!holder) {
        const capabilities = capabilitiesOf(
          roster.disciplines,
          actor.userId,
          claim.projectId,
        );
        if (
          claim.ownerId !== actor.userId &&
          !capabilities.changeProperties &&
          !canManageProject(roster, actor.userId, admin, claim.projectId)
        )
          throw new DomainError(
            "forbidden",
            `Only ${claim.agentName} (the agent holding it), the person it acts for, project administrators and people who change properties in this project can release this claim.`,
          );
      }
      const before = await claimOrganizationEntities(
        tx,
        input.organizationId,
        claim.projectId,
      );
      const reason = holder ? "agent" : "person";
      await endClaim(tx, claim, {
        state: "released",
        reason,
        note: input.note,
        byId: actor.userId,
        now,
      });
      const returned = await returnItem(
        tx,
        claim,
        actor,
        roster,
        derivedMutationId(mutationId, "return"),
      );
      // The dispatcher does not pick up again what a person took back;
      // an agent's own release counts as a failed attempt.
      if (claim.source === "dispatcher") {
        const name =
          roster.members.find((m) => m.id === actor.userId)?.name ?? "a person";
        await recordDispatchFailure(
          tx,
          input.organizationId,
          claim.workItemId,
          holder
            ? `${claim.agentName} released it${input.note?.trim() ? `: ${input.note.trim()}` : "."}`
            : `Released by ${name}. Retry to dispatch it again.`,
          now,
          { hold: !holder },
        );
      }
      await recordActivity(tx, {
        organizationId: input.organizationId,
        projectId: claim.projectId,
        workItemId: claim.workItemId,
        actorId: actor.userId,
        action: "claim_released",
        detail: {
          ...claimDetail(claim),
          reason,
          note: input.note?.trim() ? input.note.trim() : null,
          returnedTo: returned.returnedTo,
          ...(returned.note ? { returnNote: returned.note } : {}),
          ...delegation(actor),
        },
        at: now,
      });
      await projectClaims(tx, input.organizationId, claim.projectId, before);
      await signalWork(tx, "factory");
      // `note` is the note given; `returnNote` says why the item stayed
      // where it was, as activity records it.
      return {
        claimId: claim.id,
        state: "released",
        returnedTo: returned.returnedTo,
        note: input.note?.trim() ? input.note.trim() : null,
        ...(returned.note ? { returnNote: returned.note } : {}),
      };
    },
  );
}

export async function reportProgress(
  db: Database,
  actor: Actor,
  input: {
    organizationId: string;
    claimId: string;
    note: string;
    mutationId?: string;
  },
) {
  agentOf(actor);
  return write(
    db,
    actor,
    input.organizationId,
    "reportProgress",
    { claimId: input.claimId, note: input.note },
    input.mutationId,
    async (tx, { now }) => {
      const claim = await claimById(tx, input.organizationId, input.claimId);
      requireStep(claimMachine, claim.state, "report");
      requireHolder(actor, claim, "report progress on it");
      const note = input.note.trim().slice(0, 2000);
      const before = await claimOrganizationEntities(
        tx,
        input.organizationId,
        claim.projectId,
      );
      // Progress is a sign of life: it renews the lease. It never changes
      // the item's status.
      await tx
        .update(s.workItemClaim)
        .set({
          lastProgress: note,
          lastProgressAt: now,
          ...(claim.state === "active"
            ? { leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS) }
            : {}),
        })
        .where(
          and(
            eq(s.workItemClaim.organizationId, input.organizationId),
            eq(s.workItemClaim.id, claim.id),
          ),
        );
      await recordActivity(tx, {
        organizationId: input.organizationId,
        projectId: claim.projectId,
        workItemId: claim.workItemId,
        actorId: actor.userId,
        action: "claim_progress",
        detail: { ...claimDetail(claim), note, ...delegation(actor) },
        at: now,
      });
      await projectClaims(tx, input.organizationId, claim.projectId, before);
      return { claimId: claim.id };
    },
  );
}

// ------------------------------------------------------------ questions

// The people who should answer a question about a specification: those
// asked to review its current revision, else the members of disciplines
// that review in the project. Never the asking agent's own person.
function reviewersOf(
  entities: Entity[],
  roster: Roster,
  projectId: string,
  specId: string,
  exclude: string,
) {
  const spec = entities.find(
    (e): e is EntityOf<"workItem"> => e.type === "workItem" && e.id === specId,
  );
  const ids = new Set<string>();
  for (const review of spec?.reviews ?? [])
    if (review.status !== "cancelled")
      for (const target of review.assigneeIds) {
        const discipline = roster.disciplines.find((d) => d.id === target);
        if (discipline) for (const u of discipline.userIds) ids.add(u);
        else ids.add(target);
      }
  if (!ids.size)
    for (const d of roster.disciplines)
      if (d.projectId === projectId && !d.archivedAt && d.capabilities.review)
        for (const u of d.userIds) ids.add(u);
  ids.delete(exclude);
  return roster.members.filter((m) => ids.has(m.id));
}

export async function askQuestion(
  db: Database,
  actor: Actor,
  input: {
    organizationId: string;
    claimId: string;
    question: string;
    section: string;
    quote?: string;
    occurrence?: number;
    mutationId?: string;
  },
) {
  agentOf(actor);
  return write(
    db,
    actor,
    input.organizationId,
    "askQuestion",
    {
      claimId: input.claimId,
      question: input.question,
      section: input.section,
      quote: input.quote ?? null,
      occurrence: input.occurrence ?? null,
    },
    input.mutationId,
    async (tx, { roster, mutationId, now }) => {
      const organizationId = input.organizationId;
      const claim = await claimById(tx, organizationId, input.claimId);
      requireStep(claimMachine, claim.state, "ask");
      requireHolder(actor, claim, "ask questions under it");
      const facts = await projectFacts(
        tx,
        organizationId,
        claim.projectId,
        roster,
        now,
      );
      const claimed = facts.items.find((i) => i.id === claim.workItemId)!;
      // The question goes on the specification the work is agreed against:
      // the item's own, or its nearest specification ancestor's.
      let target: EntityOf<"workItem"> | undefined = claimed;
      const seen = new Set<string>();
      while (
        target &&
        !facts.facts.hasSpecification(target.typeId) &&
        target.parentId &&
        !seen.has(target.parentId)
      ) {
        seen.add(target.parentId);
        target = facts.items.find((i) => i.id === target!.parentId);
      }
      const spec =
        target && facts.facts.hasSpecification(target.typeId)
          ? target
          : undefined;
      const subject = spec ?? claimed;
      const [revision] = await tx
        .select()
        .from(s.specificationRevision)
        .where(
          and(
            eq(s.specificationRevision.organizationId, organizationId),
            eq(s.specificationRevision.workItemId, subject.id),
          ),
        )
        .orderBy(desc(s.specificationRevision.number))
        .limit(1);
      if (!revision)
        throw new DomainError(
          "validation",
          `${facts.key(subject)} has no text to ask about yet.`,
        );
      const section = input.section.trim();
      const text = section
        ? sectionContent(revision.content, section)
        : revision.content;
      if (text === undefined)
        throw new DomainError(
          "validation",
          `The section “${section}” is not in revision ${revision.number} of ${facts.key(subject)}.`,
        );
      const quote = input.quote?.trim();
      if (quote && !text.includes(quote))
        throw new DomainError(
          "validation",
          `The quoted text is not in ${section ? `section “${section}” of ` : ""}revision ${revision.number} of ${facts.key(subject)}. Quote the specification exactly.`,
        );
      const reviewers = reviewersOf(
        facts.entities,
        roster,
        claim.projectId,
        subject.id,
        actor.userId,
      );
      const claimedKey = facts.key(claimed);
      const body = `${input.question.trim()}\n\n${claimedKey} waits for an answer.${
        reviewers.length
          ? ` ${reviewers.map((m) => mentionToken(m)).join(" ")}`
          : ""
      }`;
      const threadId = derivedMutationId(mutationId, "thread");
      const messageId = derivedMutationId(mutationId, "message");
      await command(
        tx,
        actor,
        organizationId,
        derivedMutationId(mutationId, "ask"),
        {
          type: "createThread",
          workItemId: subject.id,
          baseRevisionId: revision.id,
          threadId,
          messageId,
          body,
          // Plain work cannot block readiness; a specification's question
          // blocks it until a person resolves it.
          blocking: Boolean(spec),
          section,
          ...(quote ? { quote } : {}),
          ...(quote && input.occurrence !== undefined
            ? { occurrence: input.occurrence }
            : {}),
        },
      );
      await tx.insert(s.claimQuestion).values({
        organizationId,
        claimId: claim.id,
        workItemId: subject.id,
        threadId,
        askedAt: now,
      });
      await tx
        .update(s.workItemClaim)
        .set({ state: "waiting" })
        .where(
          and(
            eq(s.workItemClaim.organizationId, organizationId),
            eq(s.workItemClaim.id, claim.id),
          ),
        );
      await recordActivity(tx, {
        organizationId,
        projectId: claim.projectId,
        workItemId: claim.workItemId,
        actorId: actor.userId,
        action: "claim_question_asked",
        detail: {
          ...claimDetail(claim),
          threadId,
          questionItemId: subject.id,
          blocking: Boolean(spec),
          ...delegation(actor),
        },
        at: now,
      });
      await projectClaims(tx, organizationId, claim.projectId, facts.entities);
      await claimPorts().resumer.resume(tx, {
        kind: "question_asked",
        organizationId,
        claimId: claim.id,
        agentSessionId: claim.agentSessionId,
        projectId: claim.projectId,
        workItemId: claim.workItemId,
        itemKey: claimedKey,
        threadId,
        questionItemId: subject.id,
        questionItemKey: facts.key(subject),
        question: input.question.trim().slice(0, 2000),
        agentName: claim.agentName,
        ownerId: claim.ownerId,
      });
      return {
        claimId: claim.id,
        state: "waiting",
        threadId,
        messageId,
        questionItemId: subject.id,
        questionItemKey: facts.key(subject),
        blocking: Boolean(spec),
        asked: reviewers.map((m) => m.id),
      };
    },
  );
}

// A person clears the dispatcher's hold or backoff on an item, so Build and
// Autopilot may start it again.
export async function retryDispatch(
  db: Database,
  actor: Actor,
  input: { organizationId: string; workItemId: string; mutationId?: string },
) {
  return write(
    db,
    actor,
    input.organizationId,
    "retryDispatch",
    { workItemId: input.workItemId },
    input.mutationId,
    async (tx, { roster, admin, now }) => {
      const [item] = await tx
        .select({ projectId: s.workItem.projectId })
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, input.organizationId),
            eq(s.workItem.id, input.workItemId),
          ),
        );
      if (!item)
        throw new DomainError("not_found", "This item is unavailable.");
      if (
        !capabilitiesOf(roster.disciplines, actor.userId, item.projectId)
          .changeProperties &&
        !canManageProject(roster, actor.userId, admin, item.projectId)
      )
        throw new DomainError(
          "forbidden",
          "Project administrators and people who change properties in this project can retry dispatching it.",
        );
      const removed = await tx
        .delete(s.dispatchBackoff)
        .where(
          and(
            eq(s.dispatchBackoff.organizationId, input.organizationId),
            eq(s.dispatchBackoff.workItemId, input.workItemId),
          ),
        )
        .returning();
      if (removed.length)
        await recordActivity(tx, {
          organizationId: input.organizationId,
          projectId: item.projectId,
          workItemId: input.workItemId,
          actorId: actor.userId,
          action: "dispatch_retried",
          detail: { failures: removed[0]!.failures, ...delegation(actor) },
          at: now,
        });
      await signalWork(tx, "factory");
      return { workItemId: input.workItemId, cleared: removed.length > 0 };
    },
  );
}

// ------------------------------------------------------------ autonomy

function requireManager(
  roster: Roster,
  userId: string,
  admin: boolean,
  projectId: string,
  what: string,
) {
  if (!roster.projects.some((p) => p.id === projectId))
    throw new DomainError("not_found", "This project is unavailable.");
  if (!canManageProject(roster, userId, admin, projectId))
    throw new DomainError(
      "forbidden",
      `Only project administrators and organization administrators set ${what}.`,
    );
}

export async function setAutonomyPolicy(
  db: Database,
  actor: Actor,
  input: {
    organizationId: string;
    projectId: string;
    policy: AutonomyPolicyInput;
    expectedVersion?: number;
    mutationId?: string;
  },
) {
  const policy = autonomyPolicyInputSchema.parse(input.policy);
  return write(
    db,
    actor,
    input.organizationId,
    "setAutonomyPolicy",
    { projectId: input.projectId, policy, expected: input.expectedVersion },
    input.mutationId,
    async (tx, { roster, admin, now }) => {
      const { organizationId, projectId } = input;
      requireManager(
        roster,
        actor.userId,
        admin,
        projectId,
        "the autonomy policy",
      );
      const project = roster.projects.find((p) => p.id === projectId)!;
      if (policy.level !== "assist" && project.deliveryMode !== "native")
        throw new DomainError(
          "validation",
          `${project.key} hands delivery to an external tool, which owns execution. Build and Autopilot need native delivery.`,
        );
      const agents = await claimPorts().agents.agents(tx, organizationId);
      for (const agentId of policy.implementerAgentIds) {
        const agent = agents.find((a) => a.id === agentId);
        if (!agent)
          throw new DomainError(
            "validation",
            `Agent ${agentId} is not available in this organization. Choose a runner agent under Factory.`,
          );
        if (!agent.dispatchable)
          throw new DomainError(
            "validation",
            `${agent.name} is not a runner agent; the dispatcher can only start sessions of runner agents.`,
          );
        if (agent.projectIds && !agent.projectIds.includes(projectId))
          throw new DomainError(
            "validation",
            `${agent.name}'s scope does not include ${project.key}.`,
          );
        if (
          !capabilitiesOf(roster.disciplines, agent.ownerId, projectId)
            .changeProperties
        )
          throw new DomainError(
            "validation",
            `${agent.name} acts for ${roster.members.find((m) => m.id === agent.ownerId)?.name ?? "its owner"}, who cannot change properties in ${project.key}, so it cannot start work there.`,
          );
      }
      if (
        policy.reviewerAgentId &&
        !agents.some((a) => a.id === policy.reviewerAgentId)
      )
        throw new DomainError(
          "validation",
          "The reviewer agent is not available in this organization.",
        );
      if (
        policy.level === "autopilot" &&
        policy.autopilotRequires.includes("code_review_approved") &&
        !policy.reviewerAgentId
      )
        throw new DomainError(
          "validation",
          "Autopilot requires the reviewer agent's approval: choose a reviewer agent.",
        );
      const reportingChannelId = policy.reportingChannelId ?? null;
      if (reportingChannelId)
        await requireReportingChannel(
          tx,
          organizationId,
          actor.userId,
          reportingChannelId,
        );
      const [current] = await tx
        .select()
        .from(s.autonomyPolicy)
        .where(
          and(
            eq(s.autonomyPolicy.organizationId, organizationId),
            eq(s.autonomyPolicy.projectId, projectId),
          ),
        );
      const version = current?.version ?? 0;
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== version
      )
        throw new DomainError(
          "conflict",
          `The autonomy policy changed (version ${version}) since you opened it. Review the current policy before saving.`,
        );
      const before = await claimOrganizationEntities(
        tx,
        organizationId,
        projectId,
      );
      const values = {
        level: policy.level,
        implementerAgentIds: policy.implementerAgentIds,
        reviewerAgentId: policy.reviewerAgentId,
        reportingChannelId,
        maxConcurrentSessions: policy.maxConcurrentSessions,
        autopilotRequires: policy.autopilotRequires,
        version: version + 1,
        updatedById: actor.userId,
        updatedAt: now,
      };
      await tx
        .insert(s.autonomyPolicy)
        .values({ organizationId, projectId, ...values })
        .onConflictDoUpdate({
          target: [s.autonomyPolicy.organizationId, s.autonomyPolicy.projectId],
          set: values,
        });
      const previous = effectiveAutonomy(current);
      await tx.insert(s.configurationAudit).values({
        organizationId,
        actorId: actor.userId,
        action: "setAutonomyPolicy",
        detail: {
          command: { type: "setAutonomyPolicy", projectId, ...policy },
          previous: { ...previous, version },
        },
      });
      await projectClaims(tx, organizationId, projectId, before);
      if (policy.level !== "assist") await signalWork(tx, "factory");
      const live = before.filter((e) => e.type === "claim").length;
      return {
        projectId,
        version: version + 1,
        level: policy.level,
        previousLevel: previous.level,
        // Lowering autonomy releases nothing: claims in flight continue
        // (people can release them); the dispatcher starts no new ones.
        claimsInFlight: live,
      };
    },
  );
}

// A reporting channel is a public or private channel of the organization,
// not archived; a private one only when the person setting it is a member
// (everyone in it will see the project's agent sessions).
async function requireReportingChannel(
  tx: Tx,
  organizationId: string,
  userId: string,
  channelId: string,
) {
  const [channel] = await tx
    .select({
      kind: s.channel.kind,
      name: s.channel.name,
      archivedAt: s.channel.archivedAt,
    })
    .from(s.channel)
    .where(
      and(
        eq(s.channel.organizationId, organizationId),
        eq(s.channel.id, channelId),
      ),
    );
  const member =
    channel?.kind === "public"
      ? true
      : channel
        ? (
            await tx
              .select({ id: s.channelMember.id })
              .from(s.channelMember)
              .where(
                and(
                  eq(s.channelMember.channelId, channelId),
                  eq(s.channelMember.userId, userId),
                ),
              )
          ).length > 0
        : false;
  if (!channel || !member || channel.kind === "direct")
    throw new DomainError(
      "validation",
      "Choose a public channel, or a private channel you are a member of, to report to.",
    );
  if (channel.archivedAt)
    throw new DomainError(
      "validation",
      `#${channel.name} is archived. Restore it or choose another channel to report to.`,
    );
}

// The project's policy with what an administrator needs to set it: the
// agents the Factory module offers and the policy's history.
// Who reviews agents' code in a project, for the Code module's review
// dispatch (docs/internals/claims.md#autonomy-policy): the policy's
// reviewer agent (with its owner, from the Factory's directory) when the
// project is on Build or Autopilot. Lictory's own read, no person's.
export async function codeReviewPolicy(
  tx: Tx,
  organizationId: string,
  projectId: string,
) {
  const [stored] = await tx
    .select()
    .from(s.autonomyPolicy)
    .where(
      and(
        eq(s.autonomyPolicy.organizationId, organizationId),
        eq(s.autonomyPolicy.projectId, projectId),
      ),
    );
  const policy = effectiveAutonomy(stored);
  if (policy.level === "assist" || !policy.reviewerAgentId) return null;
  const agent = (await claimPorts().agents.agents(tx, organizationId)).find(
    (a) => a.id === policy.reviewerAgentId,
  );
  if (!agent?.dispatchable) return null;
  if (agent.projectIds && !agent.projectIds.includes(projectId)) return null;
  return {
    level: policy.level,
    // The administrator who set it: automated acts are attributed to them.
    setById: stored!.updatedById,
    reviewer: agent,
    reportingChannelId: policy.reportingChannelId ?? null,
  };
}

// Whether any of these projects requires CI to pass in its Definition of
// Done (the default does). The Code module's merge rule reads it: a merge
// into work that is only Done with green CI waits for CI to report.
export async function definitionRequiresCi(
  tx: Tx | Database,
  organizationId: string,
  projectIds: readonly string[],
) {
  if (!projectIds.length) return false;
  const stored = await tx
    .select({
      projectId: s.definitionOfDone.projectId,
      checks: s.definitionOfDone.checks,
    })
    .from(s.definitionOfDone)
    .where(
      and(
        eq(s.definitionOfDone.organizationId, organizationId),
        inArray(s.definitionOfDone.projectId, [...projectIds]),
      ),
    );
  const byProject = new Map(stored.map((d) => [d.projectId, d]));
  return projectIds.some((id) =>
    effectiveDoneChecks(byProject.get(id)).some(
      (c) => c.kind === "checks_passed",
    ),
  );
}

export async function autonomyPolicyOf(
  db: Database,
  userId: string,
  input: { organizationId: string; projectId: string },
) {
  return db.transaction(
    async (tx) => {
      await authorize(tx, userId, input.organizationId);
      const [stored, agents, history, claims] = await Promise.all([
        tx
          .select()
          .from(s.autonomyPolicy)
          .where(
            and(
              eq(s.autonomyPolicy.organizationId, input.organizationId),
              eq(s.autonomyPolicy.projectId, input.projectId),
            ),
          ),
        claimPorts().agents.agents(tx, input.organizationId),
        tx
          .select()
          .from(s.configurationAudit)
          .where(
            and(
              eq(s.configurationAudit.organizationId, input.organizationId),
              eq(s.configurationAudit.action, "setAutonomyPolicy"),
              sql`${s.configurationAudit.detail}->'command'->>'projectId' = ${input.projectId}`,
            ),
          )
          .orderBy(desc(s.configurationAudit.createdAt))
          .limit(20),
        tx
          .select({ state: s.workItemClaim.state })
          .from(s.workItemClaim)
          .where(
            and(
              eq(s.workItemClaim.organizationId, input.organizationId),
              eq(s.workItemClaim.projectId, input.projectId),
              inArray(s.workItemClaim.state, ["starting", "active", "waiting"]),
            ),
          ),
      ]);
      const row = stored[0];
      return {
        projectId: input.projectId,
        policy: effectiveAutonomy(row),
        version: row?.version ?? 0,
        updatedById: row?.updatedById ?? null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          ownerId: a.ownerId,
          dispatchable: a.dispatchable,
          projectIds: a.projectIds,
        })),
        claimsInFlight: claims.length,
        waiting: claims.filter((c) => c.state === "waiting").length,
        history: history.map((h) => {
          const detail = h.detail as {
            command?: Partial<AutonomyPolicyInput>;
            previous?: Partial<AutonomyPolicyInput> & { version?: number };
          };
          return {
            at: h.createdAt.toISOString(),
            actorId: h.actorId,
            level: detail.command?.level ?? null,
            previousLevel: detail.previous?.level ?? null,
            previous: detail.previous ?? null,
          };
        }),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// --------------------------------------------------- Definition of Done

export async function setDefinitionOfDone(
  db: Database,
  actor: Actor,
  input: {
    organizationId: string;
    projectId: string;
    checks: DoneCheckDefinition[];
    expectedVersion?: number;
    mutationId?: string;
  },
) {
  const checks = doneChecksSchema.parse(input.checks);
  return write(
    db,
    actor,
    input.organizationId,
    "setDefinitionOfDone",
    { projectId: input.projectId, checks, expected: input.expectedVersion },
    input.mutationId,
    async (tx, { roster, admin, now }) => {
      const { organizationId, projectId } = input;
      requireManager(
        roster,
        actor.userId,
        admin,
        projectId,
        "the Definition of Done",
      );
      for (const check of checks)
        if (check.kind === "acceptance_verified")
          for (const disciplineId of check.disciplineIds)
            if (
              !roster.disciplines.some(
                (d) => d.id === disciplineId && d.projectId === projectId,
              )
            )
              throw new DomainError(
                "validation",
                `“${check.label}” names a discipline that is not part of this project.`,
              );
      const [current] = await tx
        .select()
        .from(s.definitionOfDone)
        .where(
          and(
            eq(s.definitionOfDone.organizationId, organizationId),
            eq(s.definitionOfDone.projectId, projectId),
          ),
        );
      const version = current?.version ?? 0;
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== version
      )
        throw new DomainError(
          "conflict",
          `The Definition of Done changed (version ${version}) since you opened it. Review the current definition before saving.`,
        );
      const before = await claimOrganizationEntities(
        tx,
        organizationId,
        projectId,
      );
      const values = {
        checks,
        version: version + 1,
        updatedById: actor.userId,
        updatedAt: now,
      };
      await tx
        .insert(s.definitionOfDone)
        .values({ organizationId, projectId, ...values })
        .onConflictDoUpdate({
          target: [
            s.definitionOfDone.organizationId,
            s.definitionOfDone.projectId,
          ],
          set: values,
        });
      await tx.insert(s.configurationAudit).values({
        organizationId,
        actorId: actor.userId,
        action: "setDefinitionOfDone",
        detail: {
          command: { type: "setDefinitionOfDone", projectId, checks },
          ...(current ? { previous: { checks: current.checks, version } } : {}),
        },
      });
      await projectClaims(tx, organizationId, projectId, before);
      const items = await tx
        .select({ id: s.workItem.id })
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, organizationId),
            eq(s.workItem.projectId, projectId),
          ),
        );
      const followed = await followDefinitionOfDone(
        tx,
        organizationId,
        items.map((i) => i.id),
        roster,
      );
      return {
        projectId,
        version: version + 1,
        completed: followed.completed,
      };
    },
  );
}

// A person's sign-off on an acceptance check, or its withdrawal.
export async function signOffDoneCheck(
  db: Database,
  actor: Actor,
  input: {
    organizationId: string;
    workItemId: string;
    checkId: string;
    signedOff: boolean;
    mutationId?: string;
  },
) {
  return recordDoneDecision(db, actor, input.organizationId, input.mutationId, {
    operation: "signOffDoneCheck",
    workItemId: input.workItemId,
    checkId: input.checkId,
    on: input.signedOff,
    kind: "sign_off",
  });
}

// A person passes a failing check for this item and revision by hand (CI
// cannot run, the change needed no code), with a reason; or withdraws it.
export async function overrideDoneCheck(
  db: Database,
  actor: Actor,
  input: {
    organizationId: string;
    workItemId: string;
    checkId: string;
    overridden: boolean;
    reason?: string;
    mutationId?: string;
  },
) {
  return recordDoneDecision(db, actor, input.organizationId, input.mutationId, {
    operation: "overrideDoneCheck",
    workItemId: input.workItemId,
    checkId: input.checkId,
    on: input.overridden,
    kind: "override",
    reason: input.reason,
  });
}

async function recordDoneDecision(
  db: Database,
  actor: Actor,
  organizationId: string,
  mutationId: string | undefined,
  decision: {
    operation: string;
    workItemId: string;
    checkId: string;
    on: boolean;
    kind: "sign_off" | "override";
    reason?: string;
  },
) {
  return write(
    db,
    actor,
    organizationId,
    decision.operation,
    decision,
    mutationId,
    async (tx, { roster, now }) => {
      const [subject] = await doneSubjects(tx, organizationId, [
        decision.workItemId,
      ]);
      if (!subject)
        throw new DomainError("not_found", "This item is unavailable.");
      const evaluation = (
        await evaluateDone(tx, organizationId, [subject])
      ).get(subject.id);
      if (!evaluation)
        throw new DomainError(
          "validation",
          "The Definition of Done applies to work in progress in projects that deliver in Lictory. Start the item first.",
        );
      const check = evaluation.entity.checks.find(
        (k) => k.key === decision.checkId,
      );
      if (!check)
        throw new DomainError(
          "validation",
          "This item has no such check. Its Definition of Done may have changed; reload it and try again.",
        );
      const revisionId = evaluation.entity.revisionId;
      if (!revisionId)
        throw new DomainError("validation", "This item has no revision yet.");
      const projectId = subject.projectId;
      const mine = roster.disciplines.filter(
        (d) =>
          d.projectId === projectId &&
          !d.archivedAt &&
          d.userIds.includes(actor.userId),
      );
      if (decision.kind === "sign_off") {
        if (check.kind !== "acceptance_verified")
          throw new DomainError(
            "validation",
            `“${check.label}” is checked from evidence. Override it instead if it cannot pass.`,
          );
        const eligible = check.signOff?.disciplineIds ?? [];
        if (!mine.some((d) => eligible.length === 0 || eligible.includes(d.id)))
          throw new DomainError(
            "forbidden",
            eligible.length
              ? `Only members of ${eligible
                  .map(
                    (id) =>
                      roster.disciplines.find((d) => d.id === id)?.name ??
                      "a former discipline",
                  )
                  .join(" or ")} can sign off “${check.label}”.`
              : `Only people holding a discipline in this project can sign off “${check.label}”.`,
          );
      } else if (
        !canOverrideDoneCheck(
          capabilitiesOf(roster.disciplines, actor.userId, projectId),
        )
      )
        throw new DomainError(
          "forbidden",
          "Only people who change properties in this project can override a Definition of Done check.",
        );
      const [existing] = await tx
        .select()
        .from(s.doneSignOff)
        .where(
          and(
            eq(s.doneSignOff.organizationId, organizationId),
            eq(s.doneSignOff.workItemId, decision.workItemId),
            eq(s.doneSignOff.revisionId, revisionId),
            eq(s.doneSignOff.checkId, decision.checkId),
            isNull(s.doneSignOff.withdrawnAt),
          ),
        );
      const [revision] = await tx
        .select({ number: s.specificationRevision.number })
        .from(s.specificationRevision)
        .where(
          and(
            eq(s.specificationRevision.organizationId, organizationId),
            eq(s.specificationRevision.id, revisionId),
          ),
        );
      const detail = {
        checkId: decision.checkId,
        label: check.label,
        revision: revision?.number ?? null,
      };
      if (decision.on) {
        if (existing)
          throw new DomainError(
            "conflict",
            existing.kind === "override"
              ? `“${check.label}” is already overridden for revision ${detail.revision}.`
              : `“${check.label}” is already signed off for revision ${detail.revision}.`,
          );
        const reason = decision.reason?.trim();
        if (decision.kind === "override" && !reason)
          throw new DomainError(
            "validation",
            "Say why this check is passed by hand; the reason is kept with the item's history.",
          );
        await tx.insert(s.doneSignOff).values({
          organizationId,
          workItemId: decision.workItemId,
          revisionId,
          checkId: decision.checkId,
          kind: decision.kind,
          reason: reason?.slice(0, 1000) ?? null,
          userId: actor.userId,
          createdAt: now,
        });
      } else {
        if (existing?.kind !== decision.kind)
          throw new DomainError(
            "conflict",
            decision.kind === "override"
              ? `“${check.label}” has no override to withdraw.`
              : `“${check.label}” has no sign-off to withdraw.`,
          );
        await tx
          .update(s.doneSignOff)
          .set({ withdrawnAt: now, withdrawnById: actor.userId })
          .where(
            and(
              eq(s.doneSignOff.organizationId, organizationId),
              eq(s.doneSignOff.id, existing.id),
            ),
          );
      }
      await recordActivity(tx, {
        organizationId,
        projectId,
        workItemId: decision.workItemId,
        actorId: actor.userId,
        action:
          decision.kind === "sign_off"
            ? decision.on
              ? "done_signed_off"
              : "done_sign_off_withdrawn"
            : decision.on
              ? "done_check_overridden"
              : "done_override_withdrawn",
        detail: {
          ...detail,
          ...(decision.on && decision.kind === "override"
            ? { reason: decision.reason?.trim() }
            : {}),
          ...(existing && !decision.on ? { by: existing.userId } : {}),
          ...delegation(actor),
        },
        at: now,
      });
      // Passing a check without evidence is what an auditor looks for
      // across the organization, so overrides (not sign-offs, which are the
      // evidence) are also in the audit log, in this transaction.
      if (decision.kind === "override") {
        const [item] = await tx
          .select({ key: s.project.key, number: s.workItem.number })
          .from(s.workItem)
          .innerJoin(
            s.project,
            and(
              eq(s.project.organizationId, s.workItem.organizationId),
              eq(s.project.id, s.workItem.projectId),
            ),
          )
          .where(
            and(
              eq(s.workItem.organizationId, organizationId),
              eq(s.workItem.id, decision.workItemId),
            ),
          );
        await recordAuditEvent(tx, {
          organizationId,
          actor: { id: actor.userId },
          action: decision.on
            ? "done_check.overridden"
            : "done_check.override_withdrawn",
          target: {
            type: "work_item",
            id: decision.workItemId,
            label: item ? `${item.key}-${item.number}` : null,
          },
          detail: {
            ...detail,
            ...(decision.on ? { reason: decision.reason?.trim() } : {}),
            ...(existing && !decision.on ? { by: existing.userId } : {}),
            ...delegation(actor),
          },
        });
      }
      const followed = await followDefinitionOfDone(
        tx,
        organizationId,
        [decision.workItemId],
        roster,
      );
      return {
        workItemId: decision.workItemId,
        checkId: decision.checkId,
        completed: followed.completed > 0,
      };
    },
  );
}

// Re-evaluates the Definition of Done of the given items (or every item in
// progress or claimed) after its evidence changed, writes the evaluations
// that differ from their projection, moves passing items to Done through
// `applyMutation` (recording the delivered revision), and for Autopilot
// projects requests the merge of a claimed item's pull request when
// everything but the merge passes. Runs inside the caller's transaction,
// which must hold the organization lock: the Code module calls it after it
// ingests pull request or check changes.
export async function followDefinitionOfDone(
  tx: Tx,
  organizationId: string,
  workItemIds?: string[],
  knownRoster?: Roster,
) {
  await lock(tx, organizationId);
  const evaluations = await syncDoneProjections(
    tx,
    organizationId,
    workItemIds,
  );
  let roster = knownRoster;
  const rosterOf = async () =>
    (roster ??= await organizationDirectory(tx, organizationId));
  let completed = 0;
  let merges = 0;
  const now = new Date();
  for (const evaluation of evaluations.values()) {
    const { entity } = evaluation;
    if (entity.passed && evaluation.accountableId) {
      const done = firstStatus(await rosterOf(), entity.projectId, "done");
      if (!done) continue;
      try {
        await tx.transaction(async (inner) => {
          await recordActivity(inner, {
            organizationId,
            projectId: entity.projectId,
            workItemId: entity.workItemId,
            actorId: evaluation.accountableId!,
            action: "definition_of_done_passed",
            // The evidence Done rests on, kept on the item once its
            // evaluation leaves the projection (the item is Done).
            detail: {
              checks: entity.checks.map((c) => ({
                key: c.key,
                label: c.label,
                overridden: Boolean(c.override),
                ...(c.detail ? { detail: c.detail } : {}),
              })),
              pullRequests: entity.code.pullRequests.map((pr) => ({
                title: pr.title,
                url: pr.url,
                state: pr.state,
                headSha: pr.headSha,
              })),
              revisionId: entity.revisionId,
              claimId: evaluation.claimId,
              automation: "definition_of_done",
            },
            at: now,
          });
          await command(
            inner,
            {
              userId: evaluation.accountableId!,
              automation: "definition_of_done",
            },
            organizationId,
            crypto.randomUUID(),
            {
              type: "updateWorkItem",
              workItemId: entity.workItemId,
              statusId: done.id,
            },
          );
        });
        completed++;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "claims.done_move_failed",
            organizationId,
            workItemId: entity.workItemId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      continue;
    }
    if (evaluation.claimId && !entity.passed)
      merges += await requestAutopilotMerge(
        tx,
        organizationId,
        evaluation,
        await rosterOf(),
        now,
      );
  }
  return { evaluated: evaluations.size, completed, merges };
}

// Autopilot: when everything but the merge passes on a claimed item's one
// open pull request, ask the Code module to merge it, attributed to the
// policy and the administrator who set it. Once per pull request head.
async function requestAutopilotMerge(
  tx: Tx,
  organizationId: string,
  evaluation: DoneEvaluation,
  roster: Roster,
  now: Date,
) {
  const { entity } = evaluation;
  const [policy] = await tx
    .select()
    .from(s.autonomyPolicy)
    .where(
      and(
        eq(s.autonomyPolicy.organizationId, organizationId),
        eq(s.autonomyPolicy.projectId, entity.projectId),
      ),
    );
  if (policy?.level !== "autopilot") return 0;
  const effective = effectiveAutonomy(policy);
  const agents = await claimPorts().agents.agents(tx, organizationId);
  const reviewer = effective.reviewerAgentId
    ? {
        id: effective.reviewerAgentId,
        name:
          agents.find((a) => a.id === effective.reviewerAgentId)?.name ??
          "The reviewer agent",
      }
    : null;
  const candidate = autopilotMergeCandidate(
    entity.checks,
    evaluation.code,
    effective,
    reviewer,
  );
  if (!candidate.ready) return 0;
  const pr = candidate.pullRequest;
  const [already] = await tx
    .select({ id: s.autopilotMerge.id })
    .from(s.autopilotMerge)
    .where(
      and(
        eq(s.autopilotMerge.organizationId, organizationId),
        eq(s.autopilotMerge.pullRequestId, pr.id),
        eq(s.autopilotMerge.headSha, pr.headSha!),
      ),
    );
  if (already) return 0;
  // The policy is a person's decision: it counts only while they still
  // administer the project.
  const setter = roster.members.find((m) => m.id === policy.updatedById);
  const stillAdmin =
    setter &&
    canManageProject(
      roster,
      setter.id,
      setter.role === "admin",
      entity.projectId,
    );
  const result = stillAdmin
    ? await claimPorts().merges.requestMerge(tx, {
        organizationId,
        projectId: entity.projectId,
        workItemId: entity.workItemId,
        pullRequestId: pr.id,
        headSha: pr.headSha!,
        policyVersion: policy.version,
        authorizedById: policy.updatedById,
        idempotencyKey: `${pr.id}:${pr.headSha}`,
      })
    : {
        requested: false as const,
        reason:
          "The administrator who set Autopilot no longer administers this project. A project administrator saves the autonomy policy again to confirm it.",
      };
  await tx.insert(s.autopilotMerge).values({
    organizationId,
    projectId: entity.projectId,
    workItemId: entity.workItemId,
    claimId: evaluation.claimId,
    pullRequestId: pr.id,
    headSha: pr.headSha!,
    policyVersion: policy.version,
    authorizedById: policy.updatedById,
    outcome: result.requested ? "requested" : "refused",
    detail: result.requested ? null : result.reason,
    createdAt: now,
  });
  await recordActivity(tx, {
    organizationId,
    projectId: entity.projectId,
    workItemId: entity.workItemId,
    actorId: policy.updatedById,
    action: result.requested
      ? "autopilot_merge_requested"
      : "autopilot_merge_refused",
    detail: {
      pullRequestId: pr.id,
      title: pr.title,
      url: pr.url,
      headSha: pr.headSha,
      policyVersion: policy.version,
      authorizedById: policy.updatedById,
      claimId: evaluation.claimId,
      automation: "autopilot",
      ...(result.requested ? {} : { reason: result.reason }),
    },
    at: now,
  });
  return result.requested ? 1 : 0;
}

// --------------------------------------------------------------- reads

// A project's Definition of Done and, for one item, its evaluation: what
// agents read to know what finishing means.
export async function definitionOfDoneOf(
  db: Database,
  userId: string,
  input: { organizationId: string; projectId: string; workItemId?: string },
) {
  return db.transaction(
    async (tx) => {
      await authorize(tx, userId, input.organizationId);
      const [stored] = await tx
        .select()
        .from(s.definitionOfDone)
        .where(
          and(
            eq(s.definitionOfDone.organizationId, input.organizationId),
            eq(s.definitionOfDone.projectId, input.projectId),
          ),
        );
      let evaluation = null;
      if (input.workItemId) {
        const subjects = await doneSubjects(tx, input.organizationId, [
          input.workItemId,
        ]);
        if (subjects[0]?.projectId !== input.projectId)
          throw new DomainError("not_found", "This item is unavailable.");
        evaluation =
          (await evaluateDone(tx, input.organizationId, subjects)).get(
            input.workItemId,
          )?.entity ?? null;
      }
      return {
        projectId: input.projectId,
        checks: effectiveDoneChecks(stored),
        version: stored?.version ?? 0,
        evaluation,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export type ClaimableEntry = {
  workItemId: string;
  key: string;
  title: string;
  projectId: string;
  typeId: string;
  statusId: string;
  rank: string;
  stage: Claimability["stage"];
  claimable: boolean;
  reasons: Claimability["reasons"];
  revisionNumber: number;
  committedRevisionNumber: number | null;
  dispatch: {
    failures: number;
    held: boolean;
    nextAttemptAt: string;
    lastError: string;
  } | null;
};

// Items agents can claim now (or, with `all`, every candidate with the
// reasons it cannot be claimed yet), in rank order, per project.
export async function listClaimable(
  db: Database,
  userId: string,
  input: {
    organizationId: string;
    projectId?: string;
    all?: boolean;
    limit?: number;
  },
) {
  return db.transaction(
    async (tx) => {
      await authorize(tx, userId, input.organizationId);
      const roster = await organizationDirectory(tx, input.organizationId);
      const projects = roster.projects.filter(
        (p) =>
          !p.archivedAt &&
          p.deliveryMode === "native" &&
          (!input.projectId || p.id === input.projectId),
      );
      if (
        input.projectId &&
        !roster.projects.some((p) => p.id === input.projectId)
      )
        throw new DomainError("not_found", "This project is unavailable.");
      const now = new Date();
      const entries: ClaimableEntry[] = [];
      const backoffs = await tx
        .select()
        .from(s.dispatchBackoff)
        .where(eq(s.dispatchBackoff.organizationId, input.organizationId));
      const backoffOf = new Map(backoffs.map((b) => [b.workItemId, b]));
      for (const project of projects) {
        const facts = await projectFacts(
          tx,
          input.organizationId,
          project.id,
          roster,
          now,
        );
        for (const item of [...facts.items].sort((a, b) =>
          a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0,
        )) {
          const verdict = claimability(item, facts.facts);
          if (verdict.stage === "outside") continue;
          if (!input.all && !verdict.claimable) continue;
          const backoff = backoffOf.get(item.id);
          entries.push({
            workItemId: item.id,
            key: facts.key(item),
            title: item.title,
            projectId: project.id,
            typeId: item.typeId,
            statusId: item.statusId,
            rank: item.rank,
            stage: verdict.stage,
            claimable: verdict.claimable,
            reasons: verdict.reasons,
            revisionNumber: item.revisionNumber,
            committedRevisionNumber: item.committedRevisionNumber ?? null,
            dispatch: backoff
              ? {
                  failures: backoff.failures,
                  held: isHeld(backoff),
                  nextAttemptAt: backoff.nextAttemptAt.toISOString(),
                  lastError: backoff.lastError,
                }
              : null,
          });
        }
      }
      return { items: entries.slice(0, input.limit ?? 200) };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// Live claims of the organization or one project, optionally only those
// held by the calling agent.
export async function listLiveClaims(
  db: Database,
  actor: Actor,
  input: { organizationId: string; projectId?: string; mine?: boolean },
) {
  return db.transaction(
    async (tx) => {
      await authorize(tx, actor.userId, input.organizationId);
      const claims = (
        await claimOrganizationEntities(
          tx,
          input.organizationId,
          input.projectId,
        )
      ).filter((e): e is ClaimEntity => e.type === "claim");
      return {
        claims: input.mine
          ? claims.filter(
              (c) => c.agentId === actor.agentId && c.ownerId === actor.userId,
            )
          : claims,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// The dispatcher's backoff rows of a project (the Factory queue shows held
// items with a Retry button).
export async function dispatchState(
  db: Database,
  userId: string,
  input: { organizationId: string; projectId: string },
) {
  return db.transaction(
    async (tx) => {
      await authorize(tx, userId, input.organizationId);
      const rows = await tx
        .select({
          workItemId: s.dispatchBackoff.workItemId,
          failures: s.dispatchBackoff.failures,
          nextAttemptAt: s.dispatchBackoff.nextAttemptAt,
          lastError: s.dispatchBackoff.lastError,
        })
        .from(s.dispatchBackoff)
        .innerJoin(
          s.workItem,
          and(
            eq(s.workItem.organizationId, s.dispatchBackoff.organizationId),
            eq(s.workItem.id, s.dispatchBackoff.workItemId),
          ),
        )
        .where(
          and(
            eq(s.dispatchBackoff.organizationId, input.organizationId),
            eq(s.workItem.projectId, input.projectId),
          ),
        );
      return {
        items: rows.map((r) => ({
          workItemId: r.workItemId,
          failures: r.failures,
          held: isHeld(r),
          nextAttemptAt: r.nextAttemptAt.toISOString(),
          lastError: r.lastError,
        })),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
