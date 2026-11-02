import { openSource } from "@lictory/marketing/lib/open-source";

// Landing copy that is also published as structured data and in llms.txt, so the
// visible page, search-result rich snippets and AI assistants never disagree.

export const faqs: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "Is Lictory open source?",
    answer: `${openSource.summary} ${openSource.detail}`,
  },
  {
    question: "What is Lictory?",
    answer:
      "Lictory is a work-management platform focused on what happens before development. People and agents refine requirements on branches, review proposed changes through pull requests, and reach an agreed specification before delivering in Lictory or publishing to Jira.",
  },
  {
    question: "Who is Lictory for?",
    answer:
      "Software teams where product managers, engineers, QA, security and operations need to agree on what will be built before committing to it. Small teams can start immediately with defaults; larger organizations can add governance without changing the workflow.",
  },
  {
    question: "Do we have to leave Jira or Linear?",
    answer:
      "No. Set a project to external delivery and Lictory handles refinement, review and decomposition, then publishes approved work into Jira. Publishing to Linear is coming. Projects can switch to native delivery whenever they like.",
  },
  {
    question: "Is this just a document editor with comments?",
    answer:
      "Specifications have branches, pull requests, immutable revisions, diffs, anchored discussions, actionable suggestions, revision-bound approvals and readiness checks. Parallel contributions lead to one reviewable result, with a history of how the team reached agreement.",
  },
  {
    question: "Do product people need to understand Git?",
    answer:
      "No. A branch is a place to explore a proposed change without altering the agreed specification. A pull request brings that change back for review. You work with requirements, discussions and approvals, not a code repository.",
  },
  {
    question: "What can Litto and MCP agents do?",
    answer:
      "Delegate refinement work to Litto, the built-in assistant, or connect your own agent through MCP. Agents can inspect context, propose specification changes on branches and open pull requests using the same work item capabilities and permissions as the UI. Human decisions require explicit authorization; account security and credentials stay in the browser.",
  },
  {
    question: "What happens to approvals when the spec changes?",
    answer:
      "Approvals reference the revision that was reviewed. Material changes mark relevant approvals as stale, so reviewers see exactly what changed since they approved.",
  },
  {
    question: "Can we use Lictory without AI?",
    answer:
      "Yes. Branches, reviews, discussions, approvals and delivery work without AI. Litto and automated findings assist refinement when Lictory Intelligence is enabled; they never silently rewrite, resolve, approve or publish your work.",
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
    feature: "Publish approved work to Jira",
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
