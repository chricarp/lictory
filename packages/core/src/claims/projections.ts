import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Entity, StatusCategory } from "@lictory/core/contracts/protocol";
import {
  effectiveAutonomy,
  effectiveDoneChecks,
  liveClaimStates,
  type DoneEvaluationEntity,
} from "@lictory/core/claims/contracts";
import {
  definitionPasses,
  evaluateDefinitionOfDone,
  type DoneSignOffRecord,
} from "@lictory/core/claims/definition-of-done";
import { claimPorts, type CodeEvidence } from "@lictory/core/claims/ports";
import {
  canonicalJson,
  writeEntities,
  writeOperations,
} from "@lictory/core/domain/projections";
import type { Tx } from "@lictory/core/domain/service";

// Read projections of the claims module (docs/internals/claims.md). They
// are part of every snapshot, so `applyMutation`, `rebuildProjections` and
// this module's own writers keep them in the same transaction as the
// domain rows they show.

// Live claims, autonomy policies and Definitions of Done of an organization
// (or one project). Only stored rows are projected: a project without a
// policy shows Lictory's defaults in every client.
export async function claimOrganizationEntities(
  tx: Tx,
  organizationId: string,
  projectId?: string,
): Promise<Entity[]> {
  const [claims, policies, definitions] = await Promise.all([
    tx
      .select()
      .from(s.workItemClaim)
      .where(
        and(
          eq(s.workItemClaim.organizationId, organizationId),
          inArray(s.workItemClaim.state, [...liveClaimStates]),
          projectId ? eq(s.workItemClaim.projectId, projectId) : undefined,
        ),
      )
      .orderBy(asc(s.workItemClaim.createdAt)),
    tx
      .select()
      .from(s.autonomyPolicy)
      .where(
        and(
          eq(s.autonomyPolicy.organizationId, organizationId),
          projectId ? eq(s.autonomyPolicy.projectId, projectId) : undefined,
        ),
      ),
    tx
      .select()
      .from(s.definitionOfDone)
      .where(
        and(
          eq(s.definitionOfDone.organizationId, organizationId),
          projectId ? eq(s.definitionOfDone.projectId, projectId) : undefined,
        ),
      ),
  ]);
  const questions = claims.length
    ? await tx
        .select({
          claimId: s.claimQuestion.claimId,
          threadId: s.claimQuestion.threadId,
        })
        .from(s.claimQuestion)
        .where(
          and(
            eq(s.claimQuestion.organizationId, organizationId),
            inArray(
              s.claimQuestion.claimId,
              claims.map((c) => c.id),
            ),
            isNull(s.claimQuestion.resolvedAt),
          ),
        )
        .orderBy(asc(s.claimQuestion.askedAt), asc(s.claimQuestion.id))
    : [];
  return [
    ...claims.map(
      (c) =>
        ({
          type: "claim",
          id: c.id,
          organizationId,
          projectId: c.projectId,
          workItemId: c.workItemId,
          agentId: c.agentId,
          agentName: c.agentName,
          agentSessionId: c.agentSessionId,
          ownerId: c.ownerId,
          source: c.source as "agent" | "dispatcher",
          state: c.state as "starting" | "active" | "waiting",
          leaseExpiresAt: c.leaseExpiresAt.toISOString(),
          claimedAt: c.createdAt.toISOString(),
          waitingThreadIds: questions
            .filter((q) => q.claimId === c.id)
            .map((q) => q.threadId),
          lastProgress: c.lastProgress,
          lastProgressAt: c.lastProgressAt?.toISOString() ?? null,
          sessionWaitingSince: c.sessionWaitingSince?.toISOString() ?? null,
        }) satisfies Entity,
    ),
    ...policies.map(
      (p) =>
        ({
          type: "autonomyPolicy",
          id: p.projectId,
          organizationId,
          projectId: p.projectId,
          level: p.level,
          implementerAgentIds: p.implementerAgentIds,
          reviewerAgentId: p.reviewerAgentId,
          reportingChannelId: p.reportingChannelId,
          maxConcurrentSessions: p.maxConcurrentSessions,
          autopilotRequires: p.autopilotRequires,
          version: p.version,
          updatedById: p.updatedById,
          updatedAt: p.updatedAt.toISOString(),
        }) satisfies Entity,
    ),
    ...definitions.map(
      (d) =>
        ({
          type: "definitionOfDone",
          id: d.projectId,
          organizationId,
          projectId: d.projectId,
          checks: d.checks,
          version: d.version,
          updatedById: d.updatedById,
          updatedAt: d.updatedAt.toISOString(),
        }) satisfies Entity,
    ),
  ];
}

// What the Definition of Done is evaluated from, per item.
export type DoneSubject = {
  id: string;
  projectId: string;
  category: StatusCategory | undefined;
  committedRevisionId: string | null;
  currentRevisionId: string | null;
  deliveryMode: "native" | "external";
};

// People who can change properties in a project (the accountable person
// moving an item to Done needs it).
async function propertyChangers(
  tx: Tx,
  organizationId: string,
  projectIds: string[],
) {
  if (!projectIds.length) return new Set<string>();
  const rows = await tx
    .select({
      projectId: s.discipline.projectId,
      userId: s.disciplineMember.userId,
    })
    .from(s.disciplineMember)
    .innerJoin(
      s.discipline,
      and(
        eq(s.discipline.organizationId, s.disciplineMember.organizationId),
        eq(s.discipline.id, s.disciplineMember.disciplineId),
      ),
    )
    .innerJoin(
      s.projectMember,
      and(
        eq(s.projectMember.projectId, s.discipline.projectId),
        eq(s.projectMember.userId, s.disciplineMember.userId),
      ),
    )
    .innerJoin(
      s.member,
      and(
        eq(s.member.organizationId, s.disciplineMember.organizationId),
        eq(s.member.userId, s.disciplineMember.userId),
      ),
    )
    .where(
      and(
        eq(s.disciplineMember.organizationId, organizationId),
        inArray(s.discipline.projectId, projectIds),
        isNull(s.discipline.archivedAt),
        eq(s.discipline.canChangeProperties, true),
      ),
    );
  return new Set(rows.map((r) => `${r.projectId}:${r.userId}`));
}

export type DoneEvaluation = {
  entity: DoneEvaluationEntity;
  // Who Done is attributed to when the item moves by itself: the live
  // claim's owner, else the assignee. Null when nobody can (see `held`).
  accountableId: string | null;
  claimId: string | null;
  code: CodeEvidence;
};

// Items the Definition of Done is evaluated for: native work in progress
// (started) or held by a live claim. Done items leave the projection; the
// completion is recorded in their activity.
export async function evaluateDone(
  tx: Tx,
  organizationId: string,
  subjects: DoneSubject[],
): Promise<Map<string, DoneEvaluation>> {
  const native = subjects.filter((x) => x.deliveryMode === "native");
  const results = new Map<string, DoneEvaluation>();
  if (!native.length) return results;
  const ids = native.map((x) => x.id);
  const claims = await tx
    .select({
      id: s.workItemClaim.id,
      workItemId: s.workItemClaim.workItemId,
      ownerId: s.workItemClaim.ownerId,
    })
    .from(s.workItemClaim)
    .where(
      and(
        eq(s.workItemClaim.organizationId, organizationId),
        inArray(s.workItemClaim.workItemId, ids),
        inArray(s.workItemClaim.state, [...liveClaimStates]),
      ),
    );
  const claimed = new Map(claims.map((c) => [c.workItemId, c]));
  const evaluated = native.filter(
    (x) => x.category === "started" || claimed.has(x.id),
  );
  if (!evaluated.length) return results;
  const evaluatedIds = evaluated.map((x) => x.id);
  const projectIds = [...new Set(evaluated.map((x) => x.projectId))];
  const [definitions, policies, signOffs, items, changers, agents, evidence] =
    await Promise.all([
      tx
        .select()
        .from(s.definitionOfDone)
        .where(
          and(
            eq(s.definitionOfDone.organizationId, organizationId),
            inArray(s.definitionOfDone.projectId, projectIds),
          ),
        ),
      tx
        .select()
        .from(s.autonomyPolicy)
        .where(
          and(
            eq(s.autonomyPolicy.organizationId, organizationId),
            inArray(s.autonomyPolicy.projectId, projectIds),
          ),
        ),
      tx
        .select()
        .from(s.doneSignOff)
        .where(
          and(
            eq(s.doneSignOff.organizationId, organizationId),
            inArray(s.doneSignOff.workItemId, evaluatedIds),
            isNull(s.doneSignOff.withdrawnAt),
          ),
        )
        .orderBy(asc(s.doneSignOff.createdAt)),
      tx
        .select({
          id: s.workItem.id,
          assigneeId: s.workItem.assigneeId,
          hasSpecification: s.workItemType.hasSpecification,
        })
        .from(s.workItem)
        .innerJoin(
          s.workItemType,
          and(
            eq(s.workItemType.organizationId, s.workItem.organizationId),
            eq(s.workItemType.id, s.workItem.typeId),
          ),
        )
        .where(
          and(
            eq(s.workItem.organizationId, organizationId),
            inArray(s.workItem.id, evaluatedIds),
          ),
        ),
      propertyChangers(tx, organizationId, projectIds),
      claimPorts().agents.agents(tx, organizationId),
      claimPorts().evidence.evidence(tx, organizationId, evaluatedIds),
    ]);
  const definitionOf = new Map(definitions.map((d) => [d.projectId, d]));
  const policyOf = new Map(policies.map((p) => [p.projectId, p]));
  const itemOf = new Map(items.map((i) => [i.id, i]));
  for (const subject of evaluated) {
    const revisionId =
      subject.committedRevisionId ?? subject.currentRevisionId ?? null;
    const records = new Map<string, DoneSignOffRecord>();
    for (const row of signOffs)
      if (row.workItemId === subject.id && row.revisionId === revisionId)
        records.set(row.checkId, {
          kind: row.kind as "sign_off" | "override",
          userId: row.userId,
          createdAt: row.createdAt.toISOString(),
          reason: row.reason,
        });
    const policy = effectiveAutonomy(policyOf.get(subject.projectId));
    const reviewer = policy.reviewerAgentId
      ? {
          id: policy.reviewerAgentId,
          name:
            agents.find((a) => a.id === policy.reviewerAgentId)?.name ??
            "The reviewer agent",
        }
      : null;
    const code: CodeEvidence = evidence.get(subject.id) ?? {
      connected: false,
      explanation: "No code evidence is available for this item.",
    };
    const checks = evaluateDefinitionOfDone({
      checks: effectiveDoneChecks(definitionOf.get(subject.projectId)),
      code,
      reviewerAgent: reviewer,
      signOffs: records,
    });
    const passed = definitionPasses(checks);
    const claim = claimed.get(subject.id);
    const item = itemOf.get(subject.id);
    const candidate = claim?.ownerId ?? item?.assigneeId ?? null;
    const accountableId =
      candidate && changers.has(`${subject.projectId}:${candidate}`)
        ? candidate
        : null;
    const held = !passed
      ? null
      : item?.hasSpecification && !subject.committedRevisionId
        ? "Every check passes, but no revision is accepted for delivery. A person accepts the scope or moves the item to Done."
        : !candidate
          ? "Every check passes, but nobody is accountable for moving it: assign the item or move it to Done."
          : !accountableId
            ? "Every check passes, but the accountable person cannot change properties in this project. Someone who can moves it to Done."
            : null;
    results.set(subject.id, {
      entity: {
        type: "doneEvaluation",
        id: subject.id,
        organizationId,
        projectId: subject.projectId,
        workItemId: subject.id,
        checks,
        passed,
        revisionId,
        code: code.connected
          ? {
              connected: true,
              explanation: null,
              pullRequests: code.pullRequests.map((pr) => ({
                id: pr.id,
                title: pr.title,
                url: pr.url,
                state: pr.state,
                headSha: pr.headSha,
              })),
            }
          : {
              connected: false,
              explanation: code.explanation,
              pullRequests: [],
            },
        held,
      },
      accountableId: held ? null : accountableId,
      claimId: claim?.id ?? null,
      code,
    });
  }
  return results;
}

export async function doneEvaluationEntities(
  tx: Tx,
  organizationId: string,
  subjects: DoneSubject[],
): Promise<Entity[]> {
  const evaluated = await evaluateDone(tx, organizationId, subjects);
  return [...evaluated.values()].map((e) => e.entity);
}

// The subjects of the given items (or every item with a live claim or in a
// started status), read from the domain tables.
export async function doneSubjects(
  tx: Tx,
  organizationId: string,
  workItemIds?: string[],
): Promise<DoneSubject[]> {
  if (workItemIds?.length === 0) return [];
  const rows = await tx
    .select({
      id: s.workItem.id,
      projectId: s.workItem.projectId,
      category: s.workflowStatus.category,
      committedRevisionId: s.workItem.committedRevisionId,
      deliveryMode: s.project.deliveryMode,
      archivedAt: s.workItem.archivedAt,
      currentRevisionId: sql<string | null>`(
        select r.id from ${s.specificationRevision} r
        where r.organization_id = ${s.workItem.organizationId}
          and r.work_item_id = ${s.workItem.id}
        order by r.number desc limit 1)`,
    })
    .from(s.workItem)
    .innerJoin(
      s.workflowStatus,
      and(
        eq(s.workflowStatus.organizationId, s.workItem.organizationId),
        eq(s.workflowStatus.id, s.workItem.statusId),
      ),
    )
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
        workItemIds
          ? inArray(s.workItem.id, workItemIds)
          : sql`(${s.workflowStatus.category} = 'started' or exists (
              select 1 from ${s.workItemClaim} c
              where c.organization_id = ${s.workItem.organizationId}
                and c.work_item_id = ${s.workItem.id}
                and c.state in ('starting', 'active', 'waiting')))`,
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    category: r.category,
    committedRevisionId: r.committedRevisionId,
    currentRevisionId: r.currentRevisionId,
    deliveryMode: r.deliveryMode,
  }));
}

// Writes the Definition of Done evaluations of the given items (or every
// item in progress or claimed) that differ from their stored projection:
// evidence changes outside any command (code host events), and commands
// that change many items at once (workflow configuration). Returns the
// evaluations.
export async function syncDoneProjections(
  tx: Tx,
  organizationId: string,
  workItemIds?: string[],
) {
  const subjects = await doneSubjects(tx, organizationId, workItemIds);
  const evaluations = await evaluateDone(tx, organizationId, subjects);
  const keys = subjects.map((x) => `doneEvaluation:${x.id}`);
  const stored = keys.length
    ? await tx
        .select({ key: s.syncEntity.key, data: s.syncEntity.data })
        .from(s.syncEntity)
        .where(
          and(
            eq(s.syncEntity.organizationId, organizationId),
            inArray(s.syncEntity.key, keys),
          ),
        )
    : [];
  const storedBy = new Map(stored.map((r) => [r.key, canonicalJson(r.data)]));
  const changed = [...evaluations.values()].filter(
    (e) =>
      storedBy.get(`doneEvaluation:${e.entity.id}`) !== canonicalJson(e.entity),
  );
  await writeEntities(
    tx,
    organizationId,
    changed.map((e) => ({
      entity: e.entity,
      scope: { projectId: e.entity.projectId, workItemId: e.entity.workItemId },
    })),
  );
  const vanished = stored
    .map((r) => r.key)
    .filter((key) => !evaluations.has(key.slice("doneEvaluation:".length)));
  if (vanished.length)
    await writeOperations(
      tx,
      organizationId,
      vanished.map((key) => ({ operation: "delete" as const, key })),
    );
  return evaluations;
}
