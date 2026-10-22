import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  AI_ACTOR_ID,
  INTELLIGENCE_REVIEW_ACTION,
  aiFindingSchema,
  aiScore,
  applyAiEdit,
  type AiFinding,
} from "@lictory/core/contracts/ai";
import { aiPolicy, aiRunEntity } from "@lictory/core/domain/ai";
import {
  lock,
  snapshot,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import {
  writeEntities,
  writeProjections,
} from "@lictory/core/domain/projections";
import {
  AnalyzerError,
  createAnalyzer,
  type Analyzer,
  type ItemReviewOutput,
} from "@lictory/core/ai/analyzer";
import {
  itemReviewContext,
  pullRequestContext,
} from "@lictory/core/ai/context";
import {
  scopeLabel,
  type IntelligenceContextUse,
} from "@lictory/core/intelligence/shared";

type Run = typeof s.aiRun.$inferSelect;
const MAX_ATTEMPTS = 3;
// A run still "running" after this long lost its worker and is retried.
const LEASE_MS = 10 * 60_000;
const MAX_FINDINGS = 25;

// Processes queued runs until none remain (or `limit` is reached). Safe to call
// concurrently and repeatedly: claims are per run under the organization lock.
export async function processAiRuns(
  db: Database,
  options: { analyzer?: Analyzer; limit?: number; now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date());
  let analyzer = options.analyzer;
  const outcome = { completed: 0, failed: 0, superseded: 0 };
  for (let i = 0; i < (options.limit ?? 20); i++) {
    const run = await claim(db, now());
    if (!run) break;
    try {
      analyzer ??= createAnalyzer();
      const result = await execute(db, run, analyzer);
      outcome[result]++;
    } catch (error) {
      const message =
        error instanceof AnalyzerError
          ? error.message
          : "Lictory Intelligence could not finish this run. Run it again.";
      if (!(error instanceof AnalyzerError))
        console.error(
          JSON.stringify({
            event: "ai.run.error",
            runId: run.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      await finish(db, run, async (tx) => {
        await tx
          .update(s.aiRun)
          .set({ status: "failed", error: message, completedAt: now() })
          .where(eq(s.aiRun.id, run.id));
      });
      outcome.failed++;
    }
  }
  return outcome;
}

async function projectOf(tx: Tx, run: Run) {
  const [row] = await tx
    .select({ projectId: s.workItem.projectId })
    .from(s.workItem)
    .where(
      and(
        eq(s.workItem.organizationId, run.organizationId),
        eq(s.workItem.id, run.workItemId),
      ),
    );
  return row!.projectId;
}

async function claim(db: Database, now: Date): Promise<Run | undefined> {
  const pending = or(
    eq(s.aiRun.status, "queued"),
    and(
      eq(s.aiRun.status, "running"),
      lt(s.aiRun.startedAt, new Date(now.getTime() - LEASE_MS)),
    ),
  );
  const candidates = await db
    .select({ id: s.aiRun.id, organizationId: s.aiRun.organizationId })
    .from(s.aiRun)
    .where(pending)
    .orderBy(asc(s.aiRun.createdAt))
    .limit(5);
  for (const candidate of candidates) {
    const claimed = await db.transaction(async (tx) => {
      await lock(tx, candidate.organizationId);
      const [row] = await tx
        .select()
        .from(s.aiRun)
        .where(and(eq(s.aiRun.id, candidate.id), pending));
      if (!row) return undefined;
      const exhausted = row.attempts >= MAX_ATTEMPTS;
      const [next] = await tx
        .update(s.aiRun)
        .set(
          exhausted
            ? {
                status: "failed",
                error: "The analysis was interrupted repeatedly. Run it again.",
                completedAt: now,
              }
            : { status: "running", startedAt: now, attempts: row.attempts + 1 },
        )
        .where(eq(s.aiRun.id, row.id))
        .returning();
      await writeEntities(tx, row.organizationId, [
        {
          entity: aiRunEntity(next!),
          scope: {
            projectId: await projectOf(tx, row),
            workItemId: row.workItemId,
          },
        },
      ]);
      return exhausted ? null : next;
    });
    if (claimed) return claimed;
  }
  return undefined;
}

// Writes a run's outcome and its projections under the organization lock. Superseded or re-claimed runs never overwrite newer state.
async function finish(
  db: Database,
  run: Run,
  write: (tx: Tx, current: Run) => Promise<void>,
) {
  await db.transaction(async (tx) => {
    await lock(tx, run.organizationId);
    const [current] = await tx
      .select()
      .from(s.aiRun)
      .where(eq(s.aiRun.id, run.id));
    if (current?.status !== "running" || current.attempts !== run.attempts)
      return;
    const scope = {
      organizationId: run.organizationId,
      projectId: await projectOf(tx, run),
      workItemId: run.workItemId,
    };
    const before = await snapshot(tx, scope);
    await write(tx, current);
    const after = await snapshot(tx, scope);
    await writeProjections(tx, run.organizationId, before, after, scope);
  });
}

async function activity(
  tx: Tx,
  run: Run,
  projectId: string,
  action: string,
  detail: Record<string, unknown>,
) {
  await tx.insert(s.activity).values({
    id: crypto.randomUUID(),
    organizationId: run.organizationId,
    projectId,
    workItemId: run.workItemId,
    actorId: AI_ACTOR_ID,
    action,
    detail: { runId: run.id, requestedById: run.requestedById, ...detail },
  });
}

async function currentRevisions(tx: Tx, organizationId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; content: string }>();
  const rows = await tx
    .select({
      id: s.specificationRevision.id,
      workItemId: s.specificationRevision.workItemId,
      content: s.specificationRevision.content,
    })
    .from(s.specificationRevision)
    .where(
      and(
        eq(s.specificationRevision.organizationId, organizationId),
        inArray(s.specificationRevision.workItemId, ids),
      ),
    )
    .orderBy(desc(s.specificationRevision.number));
  const map = new Map<string, { id: string; content: string }>();
  for (const r of rows) if (!map.has(r.workItemId)) map.set(r.workItemId, r);
  return map;
}

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

// Model output is untrusted: keep only findings about analysed items, keep
// edits only when they apply to the exact content that was reviewed, and fit
// every field to the stored schema.
export function normalizeFindings(
  output: (ItemReviewOutput["findings"][number] & {
    previousFindingId?: string | null;
  })[],
  keys: Map<string, string>,
  contents: Map<string, string>,
  previous?: Map<string, string>,
  // Lictory Intelligence Context refs the model was given; citations of
  // anything else are dropped.
  context = new Map<string, IntelligenceContextUse>(),
): AiFinding[] {
  const findings: AiFinding[] = [];
  for (const f of output) {
    if (findings.length >= MAX_FINDINGS) break;
    const workItemId = keys.get(f.itemKey.trim().toUpperCase());
    if (!workItemId) continue;
    const content = contents.get(workItemId) ?? "";
    const edit =
      f.edit?.replace.trim() && applyAiEdit(content, f.edit) !== undefined
        ? {
            section: cut(f.edit.section, 200),
            find: f.edit.find,
            replace: f.edit.replace,
          }
        : null;
    const parsed = aiFindingSchema.safeParse({
      id: `f${findings.length + 1}`,
      workItemId,
      kind: f.kind,
      category: f.category,
      severity: f.severity,
      title: cut(f.title.trim() || "Untitled finding", 300),
      detail: cut(f.detail.trim(), 4000),
      evidence: f.evidence
        .map((e) => cut(e.trim(), 1000))
        .filter(Boolean)
        .slice(0, 5),
      question: f.question?.trim() ? cut(f.question.trim(), 1000) : null,
      recommendation: f.recommendation?.trim()
        ? cut(f.recommendation.trim(), 2000)
        : null,
      edit:
        edit && edit.find.length <= 4000 && edit.replace.length <= 8000
          ? edit
          : null,
      threadId: null,
      context: [
        ...new Set((f.contextRefs ?? []).map((r) => r.trim().toUpperCase())),
      ]
        .map((r) => context.get(r))
        .filter((u): u is IntelligenceContextUse => Boolean(u))
        .slice(0, 10),
    });
    if (!parsed.success) continue;
    findings.push(parsed.data);
    if (previous && f.previousFindingId)
      previous.set(parsed.data.id, f.previousFindingId);
  }
  return findings;
}

async function execute(
  db: Database,
  run: Run,
  analyzer: Analyzer,
): Promise<"completed" | "superseded"> {
  const policy = await aiPolicy(db, run.organizationId);
  if (!policy.enabled || !policy.available)
    throw new AnalyzerError(
      "Lictory Intelligence was turned off for this organization before the run started.",
    );
  if (run.kind === "item_review") {
    const prepared = await db.transaction((tx) =>
      itemReviewContext(tx, run.organizationId, run.workItemId),
    );
    const output = await analyzer.reviewItem(prepared.context);
    const contents = await db.transaction((tx) =>
      currentRevisions(
        tx,
        run.organizationId,
        Object.keys(prepared.contextRevisions),
      ),
    );
    const reviewed = new Map(
      [...contents]
        .filter(([id, r]) => prepared.contextRevisions[id] === r.id)
        .map(([id, r]) => [id, r.content]),
    );
    const findings = normalizeFindings(
      output.findings,
      prepared.keys,
      reviewed,
      undefined,
      prepared.intelligence.uses,
    );
    const score = aiScore(findings);
    await finish(db, run, async (tx) => {
      // Content that changed while the model was thinking makes the result
      // outdated immediately; it is still shown, as history.
      const now = await currentRevisions(
        tx,
        run.organizationId,
        Object.keys(prepared.contextRevisions),
      );
      const changed = Object.entries(prepared.contextRevisions).some(
        ([id, revisionId]) => now.get(id)?.id !== revisionId,
      );
      await tx
        .update(s.aiRun)
        .set({
          status: "completed",
          completedAt: new Date(),
          contextRevisions: prepared.contextRevisions,
          intelligenceContext: [...prepared.intelligence.uses.values()],
          score,
          summary: cut(output.summary.trim(), 4000),
          strengths: output.strengths.slice(0, 3).map((x) => cut(x, 500)),
          findings,
          model: analyzer.model,
          error: null,
          ...(changed
            ? {
                staleAt: new Date(),
                staleReason: "Content changed while the review ran",
              }
            : {}),
        })
        .where(eq(s.aiRun.id, run.id));
      await activity(tx, run, prepared.projectId, "ai_review_completed", {
        score,
        findings: findings.length,
      });
    });
    return "completed";
  }
  const prepared = await db.transaction((tx) =>
    pullRequestContext(tx, run.organizationId, run),
  );
  if (prepared?.head.id !== run.headCommitId) {
    await finish(db, run, async (tx) => {
      await tx
        .update(s.aiRun)
        .set({
          status: "superseded",
          completedAt: new Date(),
          error: prepared
            ? "A newer commit replaced the reviewed head."
            : `The pull request closed before the ${INTELLIGENCE_REVIEW_ACTION} ran.`,
        })
        .where(eq(s.aiRun.id, run.id));
    });
    return "superseded";
  }
  const output = await analyzer.reviewPullRequest(prepared.context);
  const previousIds = new Map<string, string>();
  const findings = normalizeFindings(
    output.findings,
    prepared.keys,
    new Map([[prepared.item.id, prepared.head.content]]),
    previousIds,
    prepared.intelligence.uses,
  );
  // Finding id → discussion of the same issue opened by an earlier run.
  const repeated = new Map<string, string>();
  for (const [id, previousId] of previousIds) {
    const thread = prepared.previousFindings.find(
      (p) => p.id === previousId,
    )?.threadId;
    if (thread && ![...repeated.values()].includes(thread))
      repeated.set(id, thread);
  }
  const score = aiScore(findings);
  let result: "completed" | "superseded" = "completed";
  await finish(db, run, async (tx, current) => {
    const [pr] = await tx
      .select()
      .from(s.specificationPullRequest)
      .where(eq(s.specificationPullRequest.id, prepared.pr.id));
    const [source] = await tx
      .select()
      .from(s.specificationBranch)
      .where(eq(s.specificationBranch.id, prepared.pr.sourceId));
    if (
      !pr ||
      pr.deletedAt ||
      pr.status === "merged" ||
      source?.headId !== current.headCommitId
    ) {
      await tx
        .update(s.aiRun)
        .set({
          status: "superseded",
          completedAt: new Date(),
          error: `The pull request changed while the ${INTELLIGENCE_REVIEW_ACTION} ran.`,
        })
        .where(eq(s.aiRun.id, run.id));
      result = "superseded";
      return;
    }
    const [project] = await tx
      .select({ policy: s.project.aiActionPolicy })
      .from(s.project)
      .where(
        and(
          eq(s.project.organizationId, run.organizationId),
          eq(s.project.id, prepared.item.projectId),
        ),
      );
    const required = project?.policy === "required";
    const revisionId = (
      await currentRevisions(tx, run.organizationId, [prepared.item.id])
    ).get(prepared.item.id)!.id;
    const commit = `\`${prepared.head.id.slice(0, 7)}\``;
    const reply = async (threadId: string, body: string) =>
      tx.insert(s.threadMessage).values({
        organizationId: run.organizationId,
        threadId,
        authorId: AI_ACTOR_ID,
        body,
      });
    const open = async (
      section: string,
      quote: string | undefined,
      body: string,
      blocking: boolean,
    ) => {
      const id = crypto.randomUUID();
      await tx.insert(s.thread).values({
        id,
        organizationId: run.organizationId,
        workItemId: prepared.item.id,
        revisionId,
        pullRequestId: pr.id,
        commitId: prepared.head.id,
        authorId: AI_ACTOR_ID,
        blocking,
        anchor: {
          version: 1,
          kind: "document",
          section: cut(section, 200),
          ...(quote ? { quote: cut(quote, 2000) } : {}),
        },
      });
      await reply(id, body);
      return id;
    };
    for (const f of findings) {
      const existing = repeated.get(f.id);
      if (existing) {
        f.threadId = existing;
        await reply(existing, `Still present at commit ${commit}.`);
        continue;
      }
      f.threadId = await open(
        f.edit?.section.trim() ? f.edit.section : INTELLIGENCE_REVIEW_ACTION,
        // Anchor only to text that exists in the reviewed content.
        f.evidence.find((e) => prepared.head.content.includes(e)),
        renderFinding(f),
        required && f.severity === "blocker",
      );
    }
    // Never resolve on the team's behalf: say what changed and let them decide.
    for (const previous of prepared.previousFindings)
      if (![...repeated.values()].includes(previous.threadId!))
        await reply(
          previous.threadId!,
          `The ${INTELLIGENCE_REVIEW_ACTION} no longer detects this at commit ${commit}. Resolve the discussion if you agree.`,
        );
    const rundown = renderRundown(
      output.summary,
      output.strengths,
      findings,
      score,
      commit,
      [...prepared.intelligence.uses.values()],
    );
    const [summaryThread] = await tx
      .select({ id: s.thread.id, anchor: s.thread.anchor })
      .from(s.thread)
      .where(
        and(
          eq(s.thread.organizationId, run.organizationId),
          eq(s.thread.pullRequestId, pr.id),
          eq(s.thread.authorId, AI_ACTOR_ID),
          // Pull requests reviewed before the rename keep their summary thread.
          inArray(sql<string>`${s.thread.anchor}->>'section'`, [
            summarySection,
            "Lictory Action summary",
          ]),
        ),
      )
      .limit(1);
    if (summaryThread) await reply(summaryThread.id, rundown);
    else await open(summarySection, undefined, rundown, false);
    await tx
      .update(s.aiRun)
      .set({
        status: "completed",
        completedAt: new Date(),
        contextRevisions: prepared.contextRevisions,
        intelligenceContext: [...prepared.intelligence.uses.values()],
        score,
        summary: cut(output.summary.trim(), 4000),
        strengths: output.strengths.slice(0, 3).map((x) => cut(x, 500)),
        findings,
        model: analyzer.model,
        error: null,
      })
      .where(eq(s.aiRun.id, run.id));
    await activity(tx, run, prepared.item.projectId, "ai_action_completed", {
      pullRequestId: pr.id,
      commitId: prepared.head.id,
      score,
      findings: findings.length,
    });
  });
  return result;
}

const severityLabel = {
  blocker: "Blocker",
  major: "Major",
  minor: "Minor",
  info: "Note",
} as const;
const kindLabel = {
  validation: "Validation",
  suggestion: "Suggestion",
  question: "Question",
} as const;

function renderFinding(f: AiFinding) {
  return [
    `**${severityLabel[f.severity]} · ${kindLabel[f.kind]}:** ${f.title}`,
    "",
    f.detail,
    ...(f.evidence.length ? ["", ...f.evidence.map((e) => `> ${e}`)] : []),
    ...(f.question ? ["", `**Question for the team:** ${f.question}`] : []),
    ...(f.recommendation
      ? ["", `**Recommendation:** ${f.recommendation}`]
      : []),
    ...(f.context.length
      ? [
          "",
          `**Based on Lictory Intelligence Context:** ${f.context
            .map((c) => `${scopeLabel[c.scope]} › ${c.scopeName} › ${c.title}`)
            .join("; ")}`,
        ]
      : []),
    ...(f.edit
      ? [
          "",
          `**Suggested change** under “${f.edit.section}”:`,
          "",
          "```diff",
          ...(f.edit.find ? f.edit.find.split("\n").map((l) => `- ${l}`) : []),
          ...f.edit.replace.split("\n").map((l) => `+ ${l}`),
          "```",
          "",
          `_Commit it from the ${INTELLIGENCE_REVIEW_ACTION} in the Actions tab. Nothing changes until someone does._`,
        ]
      : []),
  ].join("\n");
}

const summarySection = `${INTELLIGENCE_REVIEW_ACTION} summary`;

function renderRundown(
  summary: string,
  strengths: string[],
  findings: AiFinding[],
  score: number,
  commit: string,
  context: IntelligenceContextUse[],
) {
  const count = (severity: AiFinding["severity"]) =>
    findings.filter((f) => f.severity === severity).length;
  return [
    `### ${INTELLIGENCE_REVIEW_ACTION} of commit ${commit}: ${score}/100`,
    "",
    summary.trim(),
    ...(strengths.length
      ? ["", "**What works**", ...strengths.slice(0, 3).map((x) => `- ${x}`)]
      : []),
    "",
    findings.length
      ? `**Findings:** ${count("blocker")} blocker, ${count("major")} major, ${count("minor")} minor, ${count("info")} notes.`
      : "**No findings.**",
    ...findings.map(
      (f) =>
        `- ${severityLabel[f.severity]}: ${f.title}${f.edit ? " _(suggested change)_" : ""}`,
    ),
    ...(context.length
      ? [
          "",
          `_Grounded in ${context.length} Lictory Intelligence Context ${context.length === 1 ? "entry" : "entries"}: ${context.map((c) => c.title).join(", ")}._`,
        ]
      : []),
    "",
    "_Lictory Intelligence findings are proposals. The pull request's reviewers decide what is merged._",
  ].join("\n");
}
