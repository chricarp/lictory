import { z } from "zod";
import { intelligenceContextUseSchema } from "../../intelligence/shared";

// Lictory Intelligence is a non-human actor. It authors the commits, pull
// requests and discussions it proposes; the human who asked is recorded on
// every run. The id predates the name and is stored on history; keep it.
export const AI_ACTOR_ID = "lictory-ai";
export const AI_ACTOR_NAME = "Lictory Intelligence";

// Lictory Actions are the automated checks that run on pull requests, like CI.
// The Lictory Intelligence review (`pr_action` runs) is the only action today;
// each action has its own name, and its team policy.
export const INTELLIGENCE_REVIEW_ACTION = "Lictory Intelligence review";

export const aiRunKinds = ["item_review", "pr_action"] as const;
export type AiRunKind = (typeof aiRunKinds)[number];
export const aiRunStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "superseded",
] as const;
export type AiRunStatus = (typeof aiRunStatuses)[number];
// How a team treats the Lictory Intelligence review action on its pull
// requests. advisory: findings are informative discussions; required: merge
// waits for a completed run on the current head, and blocker findings open
// blocking threads.
export const aiActionPolicies = ["off", "advisory", "required"] as const;
export type AiActionPolicy = (typeof aiActionPolicies)[number];

// What a refinement team would raise: a validation (something is wrong or
// missing), a suggestion (an improvement) or a question (only humans can decide).
export const aiFindingKinds = ["validation", "suggestion", "question"] as const;
export const aiFindingCategories = [
  "missing_information",
  "ambiguity",
  "contradiction",
  "acceptance_criteria",
  "failure_behavior",
  "edge_case",
  "dependency",
  "testability",
  "decomposition",
  "estimation",
  "security",
  "operability",
] as const;
export const aiSeverities = ["blocker", "major", "minor", "info"] as const;
export type AiSeverity = (typeof aiSeverities)[number];

// A deterministic text change. `find` is an exact quote of the content the
// finding was produced against; empty means "append to `section`".
export const aiEditSchema = z.object({
  section: z.string().max(200),
  find: z.string().max(4000),
  replace: z.string().max(8000),
});
export type AiEdit = z.infer<typeof aiEditSchema>;

export const aiFindingSchema = z.object({
  id: z.string().min(1).max(160),
  workItemId: z.string().min(1).max(160),
  kind: z.enum(aiFindingKinds),
  category: z.enum(aiFindingCategories),
  severity: z.enum(aiSeverities),
  title: z.string().max(300),
  detail: z.string().max(4000),
  // Verbatim quotes from the analysed content: the evidence a human can check.
  evidence: z.array(z.string().max(1000)).max(5),
  question: z.string().max(1000).nullable(),
  recommendation: z.string().max(2000).nullable(),
  edit: aiEditSchema.nullable(),
  // Pull request runs only: the pull request discussion carrying this finding.
  threadId: z.string().nullable().default(null),
  // Lictory Intelligence Context entries the finding relied on.
  context: z.array(intelligenceContextUseSchema).max(10).default([]),
});
export type AiFinding = z.infer<typeof aiFindingSchema>;

// Explainable score: 100 minus a fixed weight per finding severity. The model
// never chooses the number, so equal findings always produce equal scores.
export const severityWeight: Record<AiSeverity, number> = {
  blocker: 25,
  major: 10,
  minor: 3,
  info: 0,
};
export function aiScore(findings: Pick<AiFinding, "severity">[]) {
  const penalty = findings.reduce(
    (sum, f) => sum + severityWeight[f.severity],
    0,
  );
  return Math.max(0, Math.min(100, 100 - penalty));
}
export function aiScoreBand(score: number) {
  return score >= 80 ? "good" : score >= 50 ? "fair" : "poor";
}

// Applies an edit to content. Returns undefined when the quoted text is no
// longer present, so callers can report the conflict instead of guessing.
export function applyAiEdit(content: string, edit: AiEdit): string | undefined {
  if (edit.find) {
    const at = content.indexOf(edit.find);
    if (at < 0) return undefined;
    return (
      content.slice(0, at) + edit.replace + content.slice(at + edit.find.length)
    );
  }
  const addition = edit.replace.trim();
  if (!addition) return undefined;
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const wanted = edit.section.trim().toLowerCase();
  const heading = lines.findIndex((l) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(l.trim());
    return m?.[2]!.trim().toLowerCase() === wanted;
  });
  if (!wanted || heading < 0) {
    const body = content.trimEnd();
    const block = wanted
      ? `## ${edit.section.trim()}\n\n${addition}`
      : addition;
    return body ? `${body}\n\n${block}\n` : `${block}\n`;
  }
  const level = /^(#+)/.exec(lines[heading]!.trim())![1]!.length;
  let end = lines.length;
  for (let i = heading + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]!.trim());
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  while (end > heading + 1 && lines[end - 1]!.trim() === "") end--;
  // An empty section gets a blank line after its heading, like Markdown prose.
  const lead = end === heading + 1 ? [""] : [];
  const trail = end < lines.length && lines[end]!.trim() !== "" ? [""] : [];
  return [
    ...lines.slice(0, end),
    ...lead,
    addition,
    ...trail,
    ...lines.slice(end),
  ].join("\n");
}
