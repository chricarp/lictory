import type {
  Directory,
  Entity,
  EntityOf,
  Iteration,
  IterationReport,
  RefinementState,
  StatusCategory,
} from "../sync/shared/protocol";
import { iterationLabel } from "../sync/shared/protocol";

// Insights: figures about refinement, delivery and people computed from the
// workspace, never by the model. Lictory Intelligence asks for them with the
// `getInsights` capability and the chat renders them as cards; the model only
// comments on what came back, so every number shown is traceable to data.

export const insightTopics = ["refinement", "delivery", "people"] as const;
export type InsightTopic = (typeof insightTopics)[number];

export type Tone =
  "neutral" | "muted" | "primary" | "warning" | "success" | "danger";
export type Segment = { key: string; label: string; value: number; tone: Tone };
export type InsightItem = {
  id: string;
  key: string;
  title: string;
  reason: string;
  tone: Tone;
};

export type InsightCard =
  // One total split into parts: a hero number and a segmented bar.
  | {
      kind: "distribution";
      id: string;
      title: string;
      value: number;
      unit: string;
      caption: string;
      segments: Segment[];
    }
  // One stacked bar per row (people, teams).
  | {
      kind: "breakdown";
      id: string;
      title: string;
      caption: string;
      legend: Omit<Segment, "value">[];
      rows: {
        id: string;
        label: string;
        note: string | null;
        segments: Segment[];
      }[];
    }
  // Values over time (burndown, velocity), oldest first.
  | {
      kind: "trend";
      id: string;
      title: string;
      caption: string;
      unit: string;
      style: "line" | "bars";
      labels: string[];
      series: { key: string; label: string; tone: Tone; values: number[] }[];
    }
  // Items that need a person's attention, with the reason.
  | {
      kind: "attention";
      id: string;
      title: string;
      caption: string;
      items: InsightItem[];
      more: number;
    };

export type Insights = {
  topic: InsightTopic;
  scope: { projectName: string | null; teamName: string | null };
  headline: string;
  cards: InsightCard[];
};

type WorkItem = EntityOf<"workItem">;

const DAY = 86_400_000;
const STALE_DAYS = 14;
const ATTENTION_LIMIT = 6;
const PEOPLE_LIMIT = 10;

const refinementSegments: Record<RefinementState, Omit<Segment, "value">> = {
  draft: { key: "draft", label: "Draft", tone: "neutral" },
  refinement: { key: "refinement", label: "Refinement", tone: "warning" },
  in_review: { key: "in_review", label: "In review", tone: "primary" },
  ready: { key: "ready", label: "Ready", tone: "success" },
};
const categorySegments: Partial<
  Record<StatusCategory, Omit<Segment, "value">>
> = {
  backlog: { key: "backlog", label: "Backlog", tone: "neutral" },
  unstarted: { key: "unstarted", label: "To do", tone: "muted" },
  started: { key: "started", label: "In progress", tone: "primary" },
  done: { key: "done", label: "Done", tone: "success" },
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function tally<T>(
  values: T[],
  segments: Omit<Segment, "value">[],
  keyOf: (value: T) => string | null,
): Segment[] {
  return segments.map((s) => ({
    ...s,
    value: values.filter((v) => keyOf(v) === s.key).length,
  }));
}

export function computeInsights(input: {
  topic: InsightTopic;
  entities: Entity[];
  directory: Directory;
  projectId?: string;
  teamId?: string;
  now: Date;
  // The project's active iteration with its report, when there is one.
  iteration?: { iteration: Iteration; report: IterationReport } | null;
}): Insights {
  const { directory, projectId, teamId, now } = input;
  const projects = new Map(directory.projects.map((p) => [p.id, p]));
  const categories = new Map(directory.statuses.map((s) => [s.id, s.category]));
  const teams = directory.teams.filter(
    (t) => !t.archivedAt && (!projectId || t.projectId === projectId),
  );
  const items = input.entities.filter(
    (e): e is WorkItem =>
      e.type === "workItem" &&
      !e.archivedAt &&
      (!projectId || e.projectId === projectId) &&
      (!teamId || e.teamId === teamId),
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  const categoryOf = (i: WorkItem) => categories.get(i.statusId) ?? "backlog";
  const open = (i: WorkItem) =>
    categoryOf(i) !== "done" && categoryOf(i) !== "canceled";
  const keyOf = (i: WorkItem) =>
    `${projects.get(i.projectId)?.key ?? "?"}-${i.number}`;
  const idle = (i: WorkItem) =>
    Math.floor((now.getTime() - new Date(i.updatedAt).getTime()) / DAY);
  const attention = (
    id: string,
    title: string,
    caption: string,
    found: InsightItem[],
  ): InsightCard => ({
    kind: "attention",
    id,
    title,
    caption,
    items: found.slice(0, ATTENTION_LIMIT),
    more: Math.max(0, found.length - ATTENTION_LIMIT),
  });
  const ref = (i: WorkItem, reason: string, tone: Tone): InsightItem => ({
    id: i.id,
    key: keyOf(i),
    title: i.title,
    reason,
    tone,
  });
  const scope = {
    projectName: projectId ? (projects.get(projectId)?.name ?? null) : null,
    teamName: teamId
      ? (directory.teams.find((t) => t.id === teamId)?.name ?? null)
      : null,
  };
  const cards: InsightCard[] = [];

  if (input.topic === "refinement") {
    const specs = items.filter((i) => i.refinementState !== null && open(i));
    const states = tally(
      specs,
      Object.values(refinementSegments),
      (i) => i.refinementState,
    );
    const ready = states.find((s) => s.key === "ready")!.value;
    cards.push({
      kind: "distribution",
      id: "refinement-state",
      title: "Refinement status",
      value: ready,
      unit: "ready",
      caption: `of ${plural(specs.length, "open specification")}`,
      segments: states,
    });
    const reviews = specs.flatMap((i) =>
      i.reviews.filter((r) => r.status !== "cancelled"),
    );
    if (reviews.length) {
      const segments: Segment[] = [
        {
          key: "approved",
          label: "Approved",
          tone: "success",
          value: reviews.filter((r) => r.approved).length,
        },
        {
          key: "changes",
          label: "Changes requested",
          tone: "danger",
          value: reviews.filter(
            (r) => !r.approved && r.status === "changes_requested",
          ).length,
        },
        {
          key: "waiting",
          label: "Waiting",
          tone: "primary",
          value: reviews.filter(
            (r) => !r.approved && r.status !== "changes_requested",
          ).length,
        },
      ];
      cards.push({
        kind: "distribution",
        id: "reviews",
        title: "Reviews",
        value: segments[0]!.value,
        unit: "approved",
        caption: `of ${plural(reviews.length, "review")}`,
        segments,
      });
    }
    const checks = specs.reduce((n, i) => n + i.readinessTotal, 0);
    if (checks) {
      const passed = specs.reduce((n, i) => n + i.readinessPassed, 0);
      cards.push({
        kind: "distribution",
        id: "readiness",
        title: "Readiness checks",
        value: passed,
        unit: "passing",
        caption: `of ${plural(checks, "check")}`,
        segments: [
          { key: "passed", label: "Passing", tone: "success", value: passed },
          {
            key: "failing",
            label: "Not yet",
            tone: "warning",
            value: checks - passed,
          },
        ],
      });
    }
    const found = [
      ...specs
        .filter((i) => i.blockingThreads > 0)
        .sort((a, b) => b.blockingThreads - a.blockingThreads)
        .map((i) =>
          ref(i, plural(i.blockingThreads, "blocking discussion"), "danger"),
        ),
      ...specs
        .filter(
          (i) =>
            i.blockingThreads === 0 &&
            i.refinementState !== "ready" &&
            idle(i) >= STALE_DAYS,
        )
        .sort((a, b) => idle(b) - idle(a))
        .map((i) => ref(i, `No change in ${idle(i)} days`, "warning")),
    ];
    if (found.length)
      cards.push(
        attention(
          "refinement-attention",
          "Needs attention",
          "Blocking discussions first, then specifications that stopped moving",
          found,
        ),
      );
    if (!teamId && teams.length > 1) {
      const rows = [
        ...teams.map((t) => ({ id: t.id, label: t.name })),
        { id: "none", label: "No team" },
      ]
        .map((row) => {
          const own = specs.filter((i) => (i.teamId ?? "none") === row.id);
          return {
            ...row,
            note: own.length ? plural(own.length, "spec") : null,
            segments: tally(
              own,
              Object.values(refinementSegments),
              (i) => i.refinementState,
            ),
          };
        })
        .filter((row) => row.note);
      if (rows.length > 1)
        cards.push({
          kind: "breakdown",
          id: "refinement-teams",
          title: "By team",
          caption: "Open specifications by refinement state",
          legend: Object.values(refinementSegments),
          rows,
        });
    }
    const blocking = specs.filter((i) => i.blockingThreads > 0).length;
    return {
      topic: input.topic,
      scope,
      headline: specs.length
        ? `${ready} of ${plural(specs.length, "open specification")} ${ready === 1 ? "is" : "are"} ready${blocking ? `; ${plural(blocking, "has", "have")} blocking discussions` : ""}.`
        : "There are no open specifications in this scope.",
      cards,
    };
  }

  if (input.topic === "delivery") {
    const active = items.filter((i) => categoryOf(i) !== "canceled");
    const segments = tally(active, Object.values(categorySegments), categoryOf);
    const count = (key: string) =>
      segments.find((s) => s.key === key)?.value ?? 0;
    cards.push({
      kind: "distribution",
      id: "delivery-status",
      title: "Work by status",
      value: count("started"),
      unit: "in progress",
      caption: `${count("done")} done of ${plural(active.length, "item")}`,
      segments,
    });
    const it = input.iteration;
    if (it) {
      const { report } = it;
      // Teams that do not estimate still get a burndown, in items.
      const byPoints = report.series.some((p) => p.scope > 0);
      const scopeOf = (p: (typeof report.series)[number]) =>
        byPoints ? p.scope : p.scopeCount;
      const remainingOf = (p: (typeof report.series)[number]) =>
        byPoints ? p.remaining : p.remainingCount;
      const total = byPoints
        ? report.totals.final.points
        : report.totals.final.count;
      const done = byPoints
        ? report.totals.completed.points
        : report.totals.completed.count;
      // A burndown needs at least two days of history to say anything.
      if (
        new Set(report.series.map((p) => p.at.slice(0, 10))).size > 1 &&
        report.series.some((p) => scopeOf(p) > 0)
      )
        cards.push({
          kind: "trend",
          id: "burndown",
          title: `Burndown · ${iterationLabel(it.iteration)}`,
          caption: `${done} of ${plural(total, byPoints ? "point" : "item")} done`,
          unit: byPoints ? "points" : "items",
          style: "line",
          labels: report.series.map((p) => p.at.slice(5, 10)),
          series: [
            {
              key: "scope",
              label: "Scope",
              tone: "muted",
              values: report.series.map(scopeOf),
            },
            {
              key: "remaining",
              label: "Remaining",
              tone: "primary",
              values: report.series.map(remainingOf),
            },
          ],
        });
      if (
        report.velocity.length > 1 &&
        report.velocity.some((v) => v.committed > 0 || v.completed > 0)
      )
        cards.push({
          kind: "trend",
          id: "velocity",
          title: "Velocity",
          caption: `Last ${plural(report.velocity.length, "completed iteration")}`,
          unit: "points",
          style: "bars",
          labels: report.velocity.map((v) => iterationLabel(v)),
          series: [
            {
              key: "committed",
              label: "Committed",
              tone: "muted",
              values: report.velocity.map((v) => v.committed),
            },
            {
              key: "completed",
              label: "Completed",
              tone: "success",
              values: report.velocity.map((v) => v.completed),
            },
          ],
        });
    }
    const blockers = new Map<string, WorkItem>();
    for (const e of input.entities)
      if (e.type === "relation" && e.kind === "blocks") {
        const from = byId.get(e.fromId);
        const to = byId.get(e.toId);
        if (from && to && open(from) && open(to)) blockers.set(to.id, from);
      }
    const found = [
      ...[...blockers].map(([id, by]) =>
        ref(byId.get(id)!, `Blocked by ${keyOf(by)}`, "danger"),
      ),
      ...active
        .filter((i) => categoryOf(i) === "started" && !i.assigneeId)
        .map((i) => ref(i, "In progress without an assignee", "warning")),
      ...active
        .filter(
          (i) =>
            categoryOf(i) === "started" &&
            i.assigneeId &&
            !blockers.has(i.id) &&
            idle(i) >= STALE_DAYS,
        )
        .sort((a, b) => idle(b) - idle(a))
        .map((i) =>
          ref(i, `In progress, no change in ${idle(i)} days`, "warning"),
        ),
    ];
    if (found.length)
      cards.push(
        attention(
          "delivery-attention",
          "Needs attention",
          "Blocked work, then work in progress nobody owns or moves",
          found,
        ),
      );
    return {
      topic: input.topic,
      scope,
      headline: active.length
        ? `${count("started")} in progress, ${count("done")} done and ${count("backlog") + count("unstarted")} not started${blockers.size ? `; ${plural(blockers.size, "item is", "items are")} blocked` : ""}.`
        : "There is no work in this scope.",
      cards,
    };
  }

  // People: open work per assignee, plus their share of pending reviews.
  const iterationId = input.iteration?.iteration.id;
  const members = new Map(directory.members.map((m) => [m.id, m.name]));
  const legend: Omit<Segment, "value">[] = [
    { key: "unstarted", label: "To do", tone: "muted" },
    { key: "started", label: "In progress", tone: "primary" },
    ...(iterationId
      ? [
          {
            key: "done",
            label: "Done this iteration",
            tone: "success" as const,
          },
        ]
      : []),
  ];
  const counted = items.filter(
    (i) =>
      categoryOf(i) === "unstarted" ||
      categoryOf(i) === "started" ||
      (iterationId &&
        categoryOf(i) === "done" &&
        i.iterationId === iterationId),
  );
  const owners = [...new Set(counted.map((i) => i.assigneeId ?? "none"))];
  const rows = owners
    .map((owner) => {
      const own = counted.filter((i) => (i.assigneeId ?? "none") === owner);
      const points = own.reduce((n, i) => n + (i.estimate ?? 0), 0);
      return {
        id: owner,
        label:
          owner === "none"
            ? "Unassigned"
            : (members.get(owner) ?? "Former member"),
        note: [plural(own.length, "item"), points ? `${points} pts` : null]
          .filter(Boolean)
          .join(" · "),
        segments: tally(own, legend, categoryOf),
        total: own.length,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, PEOPLE_LIMIT)
    .map(({ total: _total, ...row }) => row);
  if (rows.length)
    cards.push({
      kind: "breakdown",
      id: "workload",
      title: "Workload",
      caption:
        owners.length > PEOPLE_LIMIT
          ? `Top ${PEOPLE_LIMIT} of ${owners.length} by assigned items`
          : "Assigned items by status",
      legend,
      rows,
    });
  const pending = items.flatMap((i) =>
    open(i)
      ? i.reviews.filter(
          (r) =>
            !r.approved &&
            (r.status === "requested" || r.status === "in_progress"),
        )
      : [],
  );
  const reviewers = new Map<string, number>();
  for (const r of pending)
    for (const who of r.assigneeIds)
      if (members.has(who)) reviewers.set(who, (reviewers.get(who) ?? 0) + 1);
  if (reviewers.size)
    cards.push({
      kind: "breakdown",
      id: "review-load",
      title: "Review requests",
      caption: "Pending reviews assigned to each person",
      legend: [{ key: "pending", label: "Pending", tone: "primary" }],
      rows: [...reviewers]
        .sort((a, b) => b[1] - a[1])
        .slice(0, PEOPLE_LIMIT)
        .map(([who, n]) => ({
          id: who,
          label: members.get(who)!,
          note: plural(n, "review"),
          segments: [
            { key: "pending", label: "Pending", tone: "primary", value: n },
          ],
        })),
    });
  const busiest = rows.find((r) => r.id !== "none");
  const assignees = owners.filter((o) => o !== "none").length;
  return {
    topic: input.topic,
    scope,
    headline: rows.length
      ? `${plural(assignees, "person", "people")} ${assignees === 1 ? "holds" : "hold"} assigned work${busiest ? `; ${busiest.label} has the most (${busiest.note})` : ""}.`
      : "Nobody has open work in this scope.",
    cards,
  };
}
