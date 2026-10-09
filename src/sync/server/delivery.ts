import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "../../db/schema";
import type { StatusCategory, WorkflowStatus } from "../shared/protocol";
import type { labelColors } from "../shared/protocol";
import { DomainError } from "./errors";
import { notifyIteration } from "../../notifications/server";

type Database = PostgresJsDatabase<typeof s>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Tx;

const fail = (
  message: string,
  category: DomainError["category"] = "validation",
): never => {
  throw new DomainError(category, message);
};
// Activity actor for scheduled changes; rendered as "Lictory" by clients.
export const SYSTEM_ACTOR = "system";
const DAY = 86_400_000;
const closed: StatusCategory[] = ["done", "canceled"];

export const defaultTypes = [
  {
    name: "Epic",
    icon: "epic",
    color: "purple",
    level: 2,
    hasSpecification: true,
  },
  {
    name: "Story",
    icon: "story",
    color: "green",
    level: 1,
    hasSpecification: true,
  },
  {
    name: "Task",
    icon: "task",
    color: "blue",
    level: 1,
    hasSpecification: false,
  },
  { name: "Bug", icon: "bug", color: "red", level: 1, hasSpecification: false },
  {
    name: "Subtask",
    icon: "subtask",
    color: "gray",
    level: 0,
    hasSpecification: false,
  },
] as const;

export const defaultStatuses: {
  name: string;
  color: (typeof labelColors)[number];
  category: StatusCategory;
}[] = [
  { name: "Backlog", color: "gray", category: "backlog" },
  { name: "Todo", color: "gray", category: "unstarted" },
  { name: "In Progress", color: "amber", category: "started" },
  { name: "In Review", color: "blue", category: "started" },
  { name: "Done", color: "green", category: "done" },
  { name: "Canceled", color: "gray", category: "canceled" },
];

// Idempotent: an organization that already has types keeps them.
export async function seedTypes(tx: Executor, organizationId: string) {
  const hasTypes = await tx
    .select({ id: s.workItemType.id })
    .from(s.workItemType)
    .where(eq(s.workItemType.organizationId, organizationId))
    .limit(1);
  if (!hasTypes.length)
    await tx.insert(s.workItemType).values(
      defaultTypes.map((t, position) => ({
        organizationId,
        ...t,
        position,
      })),
    );
}

export async function activity(
  tx: Tx,
  organizationId: string,
  actorId: string,
  rows: { projectId: string; workItemId: string }[],
  action: string,
  detail: Record<string, unknown>,
  now: Date,
) {
  if (!rows.length) return;
  await tx.insert(s.activity).values(
    rows.map((r) => ({
      id: crypto.randomUUID(),
      organizationId,
      projectId: r.projectId,
      workItemId: r.workItemId,
      actorId,
      action,
      detail,
      createdAt: now,
    })),
  );
}

export async function lastIterationNumber(
  tx: Tx,
  organizationId: string,
  projectId: string,
) {
  const [row] = await tx
    .select({ n: max(s.iteration.number) })
    .from(s.iteration)
    .where(
      and(
        eq(s.iteration.organizationId, organizationId),
        eq(s.iteration.projectId, projectId),
      ),
    );
  return row?.n ?? 0;
}

export async function iterationEvents(
  tx: Tx,
  organizationId: string,
  items: (typeof s.workItem.$inferSelect)[],
  kind: (typeof s.iterationEvent.$inferInsert)["kind"],
  actorId: string,
  at: Date,
  iterationId?: string,
) {
  const rows = items
    .filter((i) => iterationId ?? i.iterationId)
    .map((i) => ({
      organizationId,
      iterationId: (iterationId ?? i.iterationId)!,
      workItemId: i.id,
      kind,
      points: i.estimate ?? 0,
      actorId: actorId === SYSTEM_ACTOR ? null : actorId,
      createdAt: at,
    }));
  if (rows.length) await tx.insert(s.iterationEvent).values(rows);
}

export async function completeIteration(
  tx: Tx,
  organizationId: string,
  project: { id: string; statuses: Pick<WorkflowStatus, "id" | "category">[] },
  iterationId: string,
  carryOverTo: string | null,
  actorId: string,
  now: Date,
) {
  const [it] = await tx
    .select()
    .from(s.iteration)
    .where(
      and(
        eq(s.iteration.organizationId, organizationId),
        eq(s.iteration.projectId, project.id),
        eq(s.iteration.id, iterationId),
      ),
    );
  if (!it) fail("The iteration is unavailable.");
  if (it!.state !== "active")
    fail("Only the active iteration can be completed.");
  if (carryOverTo) {
    const [target] = await tx
      .select()
      .from(s.iteration)
      .where(
        and(
          eq(s.iteration.organizationId, organizationId),
          eq(s.iteration.projectId, project.id),
          eq(s.iteration.id, carryOverTo),
        ),
      );
    if (target?.state !== "planned")
      fail(
        "Unfinished work can only move to a planned iteration of this project.",
      );
  }
  const category = new Map(project.statuses.map((x) => [x.id, x.category]));
  const items = await tx
    .select()
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.iterationId, iterationId),
        isNull(s.workItem.archivedAt),
      ),
    );
  const unfinished = items.filter(
    (i) => !closed.includes(category.get(i.statusId) ?? "backlog"),
  );
  const report = await iterationReportRows(tx, organizationId, it!, now);
  const summary = {
    ...report.totals,
    carriedOver: {
      count: unfinished.length,
      points: unfinished.reduce((sum, i) => sum + (i.estimate ?? 0), 0),
    },
    carriedOverTo: carryOverTo,
  };
  if (unfinished.length) {
    await iterationEvents(
      tx,
      organizationId,
      unfinished,
      "removed",
      actorId,
      now,
      iterationId,
    );
    if (carryOverTo)
      await iterationEvents(
        tx,
        organizationId,
        unfinished,
        "added",
        actorId,
        now,
        carryOverTo,
      );
    await tx
      .update(s.workItem)
      .set({ iterationId: carryOverTo, updatedAt: now })
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          inArray(
            s.workItem.id,
            unfinished.map((i) => i.id),
          ),
        ),
      );
    await activity(
      tx,
      organizationId,
      actorId,
      unfinished.map((i) => ({ projectId: i.projectId, workItemId: i.id })),
      "iteration_changed",
      { from: iterationId, to: carryOverTo, reason: "carried_over" },
      now,
    );
  }
  await tx
    .update(s.iteration)
    .set({ state: "completed", completedAt: now, summary })
    .where(
      and(
        eq(s.iteration.organizationId, organizationId),
        eq(s.iteration.id, iterationId),
      ),
    );
  await notifyIteration(tx, {
    organizationId,
    iterationId,
    kind: "iteration_completed",
    actorId: actorId === SYSTEM_ACTOR ? null : actorId,
  });
}

// Automatic cycles. Deterministic from stored state and `now`, so running it
// twice (or from two workers under the organization lock) changes nothing.
export async function advanceProjectSchedule(
  tx: Tx,
  organizationId: string,
  projectId: string,
  now: Date,
  actorId = SYSTEM_ACTOR,
) {
  const [project] = await tx
    .select()
    .from(s.project)
    .where(
      and(
        eq(s.project.organizationId, organizationId),
        eq(s.project.id, projectId),
      ),
    );
  if (
    !project ||
    project.archivedAt ||
    project.deliveryMode !== "native" ||
    project.iterationMode !== "automatic"
  )
    return false;
  const statuses = await tx
    .select({ id: s.workflowStatus.id, category: s.workflowStatus.category })
    .from(s.workflowStatus)
    .where(
      and(
        eq(s.workflowStatus.organizationId, organizationId),
        eq(s.workflowStatus.projectId, projectId),
      ),
    );
  const length = project.iterationWeeks * 7 * DAY;
  let changed = false;
  const open = async () =>
    tx
      .select()
      .from(s.iteration)
      .where(
        and(
          eq(s.iteration.organizationId, organizationId),
          eq(s.iteration.projectId, projectId),
          sql`${s.iteration.state} <> 'completed'`,
        ),
      )
      .orderBy(asc(s.iteration.number));
  const create = async (startsAt: Date) => {
    changed = true;
    const id = crypto.randomUUID();
    await tx.insert(s.iteration).values({
      id,
      organizationId,
      projectId,
      number: (await lastIterationNumber(tx, organizationId, projectId)) + 1,
      startsAt,
      endsAt: new Date(startsAt.getTime() + length),
    });
    return id;
  };
  let iterations = await open();
  if (!iterations.length) {
    const [last] = await tx
      .select()
      .from(s.iteration)
      .where(
        and(
          eq(s.iteration.organizationId, organizationId),
          eq(s.iteration.projectId, projectId),
        ),
      )
      .orderBy(sql`${s.iteration.number} desc`)
      .limit(1);
    // First cycle starts on the most recent configured weekday (UTC).
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const back = (today.getUTCDay() - project.iterationStartDay + 7) % 7;
    const start =
      last && last.endsAt > new Date(today.getTime() - back * DAY)
        ? last.endsAt
        : new Date(today.getTime() - back * DAY);
    await create(start);
    iterations = await open();
  }
  for (let guard = 0; guard < 200; guard++) {
    const active = iterations.find((i) => i.state === "active");
    const planned = iterations.filter((i) => i.state === "planned");
    if (active && active.endsAt <= now) {
      const nextId = planned[0]?.id ?? (await create(active.endsAt));
      await completeIteration(
        tx,
        organizationId,
        { id: projectId, statuses },
        active.id,
        nextId,
        actorId,
        now,
      );
      changed = true;
      iterations = await open();
      continue;
    }
    if (!active && planned[0] && planned[0].startsAt <= now) {
      await tx
        .update(s.iteration)
        .set({ state: "active", startedAt: planned[0].startsAt })
        .where(
          and(
            eq(s.iteration.organizationId, organizationId),
            eq(s.iteration.id, planned[0].id),
          ),
        );
      await notifyIteration(tx, {
        organizationId,
        iterationId: planned[0].id,
        kind: "iteration_started",
        actorId: actorId === SYSTEM_ACTOR ? null : actorId,
      });
      changed = true;
      iterations = await open();
      continue;
    }
    const upcoming = planned.length;
    if (upcoming < project.upcomingIterations) {
      const last = iterations.at(-1)!;
      await create(last.endsAt);
      iterations = await open();
      continue;
    }
    break;
  }
  return changed;
}

export async function automaticProjects(db: Database) {
  return db
    .select({
      organizationId: s.project.organizationId,
      projectId: s.project.id,
    })
    .from(s.project)
    .where(
      and(
        eq(s.project.iterationMode, "automatic"),
        eq(s.project.deliveryMode, "native"),
        isNull(s.project.archivedAt),
      ),
    );
}

type IterationRow = typeof s.iteration.$inferSelect;
export type IterationPoint = {
  at: string;
  scope: number;
  remaining: number;
  scopeCount: number;
  remainingCount: number;
};
// Replays recorded events: burndown, scope change and totals never depend on
// the current state of items, so later edits cannot rewrite history.
export async function iterationReportRows(
  tx: Executor,
  organizationId: string,
  it: IterationRow,
  now = new Date(),
) {
  const events = await tx
    .select()
    .from(s.iterationEvent)
    .where(
      and(
        eq(s.iterationEvent.organizationId, organizationId),
        eq(s.iterationEvent.iterationId, it.id),
      ),
    )
    .orderBy(asc(s.iterationEvent.createdAt), asc(s.iterationEvent.id))
    .then((rows) =>
      // Carry-over is written at the completion instant and is not progress.
      it.completedAt ? rows.filter((e) => e.createdAt < it.completedAt!) : rows,
    );
  const state = new Map<
    string,
    { in: boolean; done: boolean; points: number }
  >();
  const measure = () => {
    let scope = 0,
      remaining = 0,
      scopeCount = 0,
      remainingCount = 0;
    for (const x of state.values()) {
      if (!x.in) continue;
      scope += x.points;
      scopeCount++;
      if (!x.done) {
        remaining += x.points;
        remainingCount++;
      }
    }
    return { scope, remaining, scopeCount, remainingCount };
  };
  const start = it.startedAt ?? it.startsAt;
  const end = it.completedAt ?? (now < it.endsAt ? now : it.endsAt);
  const series: IterationPoint[] = [];
  // Added-after-start work is measured at its latest estimate, so an item
  // added unestimated and sized later still counts as scope change.
  const addedIds = new Set<string>();
  let removed = { count: 0, points: 0 };
  const completed = new Set<string>();
  let cursor = 0;
  const apply = (e: (typeof events)[number]) => {
    const x = state.get(e.workItemId) ?? { in: false, done: false, points: 0 };
    const afterStart = e.createdAt > start;
    if (e.kind === "added") {
      x.in = true;
      x.points = e.points;
      if (afterStart) addedIds.add(e.workItemId);
    } else if (e.kind === "removed") {
      x.in = false;
      if (afterStart)
        removed = {
          count: removed.count + 1,
          points: removed.points + x.points,
        };
    } else if (e.kind === "estimate_changed") x.points += e.points;
    else if (e.kind === "completed") x.done = true;
    else if (e.kind === "reopened") x.done = false;
    state.set(e.workItemId, x);
  };
  for (; cursor < events.length && events[cursor]!.createdAt <= start; cursor++)
    apply(events[cursor]!);
  const atStart = measure();
  series.push({ at: start.toISOString(), ...atStart });
  for (let day = start.getTime() + DAY; ; day += DAY) {
    const until = new Date(Math.min(day, end.getTime()));
    for (
      ;
      cursor < events.length && events[cursor]!.createdAt <= until;
      cursor++
    )
      apply(events[cursor]!);
    series.push({ at: until.toISOString(), ...measure() });
    if (until >= end) break;
  }
  for (; cursor < events.length; cursor++) apply(events[cursor]!);
  for (const [id, x] of state) if (x.in && x.done) completed.add(id);
  const final = measure();
  const added = {
    count: addedIds.size,
    points: [...addedIds].reduce(
      (sum, id) => sum + (state.get(id)?.points ?? 0),
      0,
    ),
  };
  return {
    series,
    totals: {
      atStart: { count: atStart.scopeCount, points: atStart.scope },
      final: { count: final.scopeCount, points: final.scope },
      completed: {
        count: final.scopeCount - final.remainingCount,
        points: final.scope - final.remaining,
      },
      addedAfterStart: added,
      removedAfterStart: removed,
    },
  };
}
