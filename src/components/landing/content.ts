// Landing copy that is also published as structured data and in llms.txt, so the
// visible page, search-result rich snippets and AI assistants never disagree.

export const faqs: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "What is Lictory?",
    answer:
      "Lictory is a work-management platform for software teams that reviews requirements like code. Product, engineering and QA refine a rough proposal into an approved specification through revisions, anchored discussions, suggestions, revision-bound approvals and readiness checks, then deliver the work in Lictory or publish it to Jira or Linear.",
  },
  {
    question: "Who is Lictory for?",
    answer:
      "Software teams where product managers, engineers, QA, security and operations need to agree on what will be built before committing to it. Small teams can start immediately with defaults; larger organizations can add governance without changing the workflow.",
  },
  {
    question: "Do we have to leave Jira or Linear?",
    answer:
      "No. Set a team to external delivery and Lictory handles refinement, review and decomposition, then publishes approved work into your existing tracker. Teams can switch to native delivery whenever they like.",
  },
  {
    question: "Is this just a document editor with comments?",
    answer:
      "No. Specifications have immutable revisions, diffs, anchored threads, actionable suggestions, per-revision approvals and readiness checks. The review workflow is the product.",
  },
  {
    question: "Do product people need to understand Git?",
    answer:
      "Not at all. The behavior is inspired by pull requests, but the language is about proposals, revisions, reviews and approvals.",
  },
  {
    question: "What happens if Lictory Intelligence is disabled?",
    answer:
      "Everything core keeps working. Lictory Intelligence only adds findings and proposals; humans stay authoritative over every change, resolution and approval.",
  },
  {
    question: "What happens to approvals when the spec changes?",
    answer:
      "Approvals reference the revision that was reviewed. Material changes mark relevant approvals as stale, so reviewers see exactly what changed since they approved.",
  },
  {
    question: "How long does setup take?",
    answer:
      "Minutes. Create an organization, a project and a team; defaults for work item types, workflow and readiness are ready to use.",
  },
];

export type ComparisonCell = "yes" | "no" | "partial" | "n/a";

export type ComparisonRow = {
  feature: string;
  lictory: ComparisonCell;
  jira: ComparisonCell;
  linear: ComparisonCell;
  /** Differentiators are always shown; shared capabilities sit behind "Show all". */
  differentiator?: boolean;
};

export const comparisonProducts = [
  { key: "lictory", label: "Lictory" },
  { key: "jira", label: "Jira" },
  { key: "linear", label: "Linear" },
] as const;

export const comparisonCellText: Record<ComparisonCell, string> = {
  yes: "Yes",
  no: "No",
  partial: "Partial",
  "n/a": "Not applicable",
};

export const comparisonRows: ComparisonRow[] = [
  {
    feature: "Approvals bound to a specific revision",
    lictory: "yes",
    jira: "no",
    linear: "no",
    differentiator: true,
  },
  {
    feature: "Approvals go stale after material edits",
    lictory: "yes",
    jira: "no",
    linear: "no",
    differentiator: true,
  },
  {
    feature: "Accept or reject suggested changes",
    lictory: "yes",
    jira: "no",
    linear: "no",
    differentiator: true,
  },
  {
    feature: "Readiness as evidence-based checks",
    lictory: "yes",
    jira: "partial",
    linear: "no",
    differentiator: true,
  },
  {
    feature: "Durable decision records",
    lictory: "yes",
    jira: "no",
    linear: "no",
    differentiator: true,
  },
  {
    feature: "Specification revisions with diffs",
    lictory: "yes",
    jira: "partial",
    linear: "no",
  },
  {
    feature: "Threads anchored to text ranges",
    lictory: "yes",
    jira: "partial",
    linear: "partial",
  },
  {
    feature: "Lictory Intelligence gap and contradiction finding",
    lictory: "yes",
    jira: "partial",
    linear: "partial",
  },
  {
    feature: "Boards, backlog, sprints and cycles",
    lictory: "yes",
    jira: "yes",
    linear: "yes",
  },
  {
    feature: "Estimates, burndown, velocity",
    lictory: "yes",
    jira: "yes",
    linear: "yes",
  },
  {
    feature: "Publish approved work to Jira or Linear",
    lictory: "yes",
    jira: "n/a",
    linear: "n/a",
  },
  {
    feature: "Set up without an admin project",
    lictory: "yes",
    jira: "no",
    linear: "yes",
  },
];
