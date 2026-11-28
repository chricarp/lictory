import { openSource } from "@lictory/marketing/lib/open-source";

// Landing copy that is also published as structured data and in llms.txt, so the
// visible page, search-result rich snippets and AI assistants never disagree.

/** The loop every piece of work follows, and the gate that ends each stage. */
export const loopStages: ReadonlyArray<{
  name: string;
  title: string;
  body: string;
  /** Who lets the work past this stage: a person, or evidence. */
  gate: { by: "person" | "evidence"; text: string };
}> = [
  {
    name: "Conversation",
    title: "Talk where the work starts",
    body: "Channels, threads and direct messages, with agents as members.",
    gate: {
      by: "person",
      text: "A person promotes a message into a proposal, a decision or a discussion.",
    },
  },
  {
    name: "Specification",
    title: "Agree on what to build",
    body: "Product, engineering, QA and agents refine one specification until its readiness checks pass.",
    gate: {
      by: "person",
      text: "People approve a revision and merge the breakdown. Agents never approve.",
    },
  },
  {
    name: "Agents",
    title: "Hand ready work to agents",
    body: "Agents claim ready items and work on runners your team controls.",
    gate: {
      by: "person",
      text: "An agent that needs an answer or a permission asks a person and waits.",
    },
  },
  {
    name: "Code",
    title: "Review the code",
    body: "Pull requests from GitHub, GitLab or Bitbucket link to the item. CI and a reviewer agent check every commit.",
    gate: {
      by: "person",
      text: "A person merges, or Autopilot does when every required check passes.",
    },
  },
  {
    name: "Shipped",
    title: "Ship with evidence",
    body: "Done when the Definition of Done passes, with the revision it delivered.",
    gate: {
      by: "evidence",
      text: "Merged pull requests and green checks, never an agent’s report.",
    },
  },
];

export type ModuleId =
  "channels" | "work" | "factory" | "code" | "spaces" | "desktop";

/** The product's modules: surfaces over one data model and one permission check. */
export const modules: ReadonlyArray<{
  id: ModuleId;
  name: string;
  summary: string;
  features: readonly string[];
  /** Where to get the module, when it is installed apart from the server. */
  link?: { label: string; href: string };
}> = [
  {
    id: "channels",
    name: "Channels",
    summary: "Team chat for people and agents.",
    features: [
      "Mention agents by handle",
      "Promote a message into a proposal or a decision",
      "Live cards for items, pull requests and sessions",
    ],
  },
  {
    id: "work",
    name: "Work",
    summary:
      "Specifications reviewed like code, and delivery in Lictory or Jira.",
    features: [
      "Revisions, diffs and revision-bound approvals",
      "Boards, backlog, sprints, cycles and estimates",
      "Or publish approved work to Jira Cloud",
    ],
  },
  {
    id: "factory",
    name: "Factory",
    summary: "Agents, their sessions and their runners.",
    features: [
      "A thread to steer each session, and its event log",
      "Message, interrupt, cancel or retry",
      "Approval requests for missing permissions",
    ],
  },
  {
    id: "code",
    name: "Code",
    summary: "Pull requests, issues and checks, linked to work items.",
    features: [
      "GitHub, GitLab and Bitbucket, cloud or self-managed",
      "Linked when a branch or pull request names PAY-142",
      "The code host owns every mirrored field",
    ],
  },
  {
    id: "spaces",
    name: "Spaces",
    summary: "Runbooks, architecture notes and handbooks, written together.",
    features: [
      "Edit one live draft together",
      "Publish directly, or review changes as pull requests",
      "Mention work items with their live status",
    ],
  },
  {
    id: "desktop",
    name: "Desktop",
    summary:
      "Every Lictory server you use, in one window. macOS, Windows and Linux.",
    features: [
      "Notifications and a badge for mentions",
      "lictory:// links, tray icon, keyboard shortcuts",
      "Coming: a personal runner on the same machine",
    ],
    link: { label: "Download the desktop app", href: "/download" },
  },
];

/** Coding harnesses a runner can execute. */
export const harnesses = [
  "Claude Code",
  "Codex",
  "OpenCode",
  "Gemini CLI",
  "Lictory’s built-in agent",
] as const;

/** A project's autonomy policy: how much the factory does by itself. */
export const autonomyLevels: ReadonlyArray<{
  name: string;
  isDefault?: boolean;
  body: string;
}> = [
  {
    name: "Assist",
    isDefault: true,
    body: "Agents help when asked. People start every session.",
  },
  {
    name: "Build",
    body: "Ready items go to agents automatically. People merge.",
  },
  {
    name: "Autopilot",
    body: "As Build, and Lictory merges an agent’s code pull request when every required check passes.",
  },
];

/** Why agents can be left to work: the rules no message or model can bend. */
export const trustPrinciples: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "An accountable person",
    body: "Every agent has an owner and a scope, and never more than its owner’s permissions.",
  },
  {
    title: "Text is never permission",
    body: "A message, issue, comment or model output authorizes nothing.",
  },
  {
    title: "Approvals belong to revisions",
    body: "Only people approve. An approval names its revision and goes stale when the text changes.",
  },
  {
    title: "Done is evidence",
    body: "Merged pull requests and green checks move items to done, not an agent’s report.",
  },
  {
    title: "Every action on the record",
    body: "Who did what, on which revision, through which agent. Autopilot merges name the admin who set the policy.",
  },
];

/** What a team needs, where it usually lives, and where it lives in Lictory. */
export const stackRows: ReadonlyArray<{
  need: string;
  stack: string;
  lictory: string;
}> = [
  {
    need: "Talk about the work",
    stack: "A chat app. Decisions get lost in scrollback.",
    lictory:
      "Channels, where what matters becomes a proposal, a decision or an anchored discussion.",
  },
  {
    need: "Agree on what to build",
    stack: "A wiki page or issue that anyone can edit after review.",
    lictory:
      "Specifications with revisions, diffs and revision-bound approvals.",
  },
  {
    need: "Plan and track delivery",
    stack: "An issue tracker, linked to the documents by hand.",
    lictory:
      "Delivery items that record their source revision, on native boards or in Jira.",
  },
  {
    need: "Write and review code",
    stack: "A code host, wired to the tracker with apps and webhooks.",
    lictory:
      "Your code host stays. Pull requests and checks link to work items.",
  },
  {
    need: "Run coding agents",
    stack:
      "Agent tools per developer, with personal credentials and no record.",
    lictory:
      "Agents with an owner and a scope, on your runners, with per-session credentials.",
  },
  {
    need: "Keep what the team knows",
    stack: "A separate wiki with its own permissions.",
    lictory: "Spaces, with the same reviewed history as specifications.",
  },
  {
    need: "Permissions and audit",
    stack: "One set per tool, reconciled by an administrator.",
    lictory: "One permission check for people and agents, one history.",
  },
];

/** Capabilities named in structured data: only what the page itself says. */
export const featureList: readonly string[] = [
  ...modules.map((module) => `${module.name}: ${module.summary}`),
  ...trustPrinciples.map((principle) => principle.title),
];

export const faqs: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "What is Lictory?",
    answer:
      "The control plane of a software factory. Your team and its agents talk, agree on a specification reviewed like code, and ship it: agents write the code on runners you control, people make the decisions.",
  },
  {
    question: "Is Lictory open source?",
    answer: `${openSource.summary} ${openSource.detail}`,
  },
  {
    question: "Which coding agents can run in Lictory?",
    answer:
      "Claude Code, Codex, OpenCode, Gemini CLI or Lictory’s built-in agent, on runners you control. Other agents connect over MCP with their own agent token.",
  },
  {
    question: "Can an agent approve a specification or merge code?",
    answer:
      "Never a specification: approvals, accepted scope, resolved discussions and decisions are always a person’s act. Code can be: under Autopilot, which a project admin turns on, Lictory merges an agent’s pull request when every required check passes.",
  },
  {
    question: "What does a runner need?",
    answer:
      "A Linux, macOS or Windows machine (x64 or arm64) running lictory-runner. It connects out over HTTPS and needs no open port. Each session gets its own git worktree and a short-lived, repository-scoped token.",
  },
  {
    question: "Do we have to leave Slack, Jira or GitHub?",
    answer:
      "No. Your code stays on GitHub, GitLab or Bitbucket. A project can publish approved work to Jira Cloud, and a channel can be linked to a Slack channel.",
  },
  {
    question: "Do product people need to understand Git?",
    answer:
      "No. You work with requirements, discussions and approvals. A branch is a proposed change; a pull request brings it back for review.",
  },
  {
    question: "What happens to approvals when the spec changes?",
    answer:
      "Approvals name the revision that was reviewed. A material change makes them stale, and reviewers see what changed since.",
  },
  {
    question: "Can we use Lictory without AI or agents?",
    answer:
      "Yes. Channels, specifications, reviews, delivery and Spaces work with no agent, runner, model or code host configured.",
  },
  {
    question: "Which AI models can we use? Can they run on our own servers?",
    answer:
      "Cloud: OpenAI, Anthropic, Google Gemini and Vertex AI, Azure OpenAI, Amazon Bedrock, Mistral, xAI, Groq, DeepSeek or OpenRouter. Self-hosted: Ollama, vLLM, LM Studio, llama.cpp or any OpenAI-compatible server, plus Whisper servers such as Speaches or whisper.cpp for dictation. Requests go only to the provider you chose.",
  },
  {
    question: "How long does setup take?",
    answer:
      "Install on your server with the lictory command, create an organization and a project, and start with the defaults. Connect a code host and register a runner when you want agents to write code.",
  },
];

// Lictory and Jira or Linear, capability by capability: the tables of
// /compare/jira and /compare/linear and of llms-full.txt.

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
