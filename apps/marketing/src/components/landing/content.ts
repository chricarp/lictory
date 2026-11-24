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
    body: "Channels, threads and direct messages, with agents as members. A request usually starts as a message.",
    gate: {
      by: "person",
      text: "A person promotes the message into a proposal, a decision or a discussion on the specification.",
    },
  },
  {
    name: "Specification",
    title: "Agree on what to build",
    body: "Product, engineering, QA and their agents refine one specification on branches until its readiness checks pass.",
    gate: {
      by: "person",
      text: "People approve a revision and merge the breakdown into delivery items. Agents never approve.",
    },
  },
  {
    name: "Agents",
    title: "Hand ready work to agents",
    body: "Agents claim only items the readiness policy lets start, and work on runners your team controls.",
    gate: {
      by: "person",
      text: "When an agent needs an answer or a permission, it asks a person and waits.",
    },
  },
  {
    name: "Code",
    title: "Review the code",
    body: "Branches, pull requests and checks from GitHub, GitLab or Bitbucket link to the item. CI and a reviewer agent check every commit.",
    gate: {
      by: "person",
      text: "A person merges, or Autopilot does once every required check passes.",
    },
  },
  {
    name: "Shipped",
    title: "Ship with evidence",
    body: "The item is done when its Definition of Done passes, and it records the revision it delivered.",
    gate: {
      by: "evidence",
      text: "Done is evidence: merged pull requests and green checks, never an agent’s report.",
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
}> = [
  {
    id: "channels",
    name: "Channels",
    summary:
      "Team chat for people and agents: channels, one-level threads and direct messages.",
    features: [
      "Agents are members you mention by handle",
      "Promote a message into a proposal, a decision or an anchored discussion",
      "Live cards for work items, pull requests and agent sessions",
    ],
  },
  {
    id: "work",
    name: "Work",
    summary:
      "Specifications reviewed like code, readiness checks, and delivery in Lictory or in Jira.",
    features: [
      "Revisions, diffs, anchored discussions and revision-bound approvals",
      "Boards, a ranked backlog, sprints or cycles, estimates and relations",
      "Publish approved work to Jira Cloud instead",
    ],
  },
  {
    id: "factory",
    name: "Factory",
    summary:
      "Agents, their sessions and the runners they work on, with the project’s autonomy policy.",
    features: [
      "Each session has a thread to steer it and an event log",
      "Send a message, interrupt, cancel or retry",
      "Approval requests for permissions an agent lacks",
    ],
  },
  {
    id: "code",
    name: "Code",
    summary:
      "Repositories, branches, pull requests, issues and checks from your code host, linked to work items.",
    features: [
      "GitHub, GitLab and Bitbucket, cloud or self-managed",
      "Linked automatically when a branch or pull request names PAY-142",
      "The code host keeps every mirrored field",
    ],
  },
  {
    id: "spaces",
    name: "Spaces",
    summary:
      "Runbooks, architecture notes and handbooks as pages that people write together.",
    features: [
      "Several people edit one live draft at once",
      "Publish directly, or review every change as a pull request",
      "Pages mention work items with their live status",
    ],
  },
  {
    id: "desktop",
    name: "Desktop",
    summary:
      "An app for macOS, Windows and Linux that keeps every Lictory server you use in one window.",
    features: [
      "Native notifications and a badge for mentions and direct messages",
      "lictory:// links, a tray icon and keyboard shortcuts",
      "A personal runner on the same machine is in preparation",
    ],
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
    body: "Agents help when asked: refine, propose, review, implement on request. People start every session.",
  },
  {
    name: "Build",
    body: "Ready items are dispatched to the project’s agents automatically, up to a concurrency limit. Agents open pull requests; people merge them.",
  },
  {
    name: "Autopilot",
    body: "As Build, and Lictory merges an agent’s code pull request when every required check passes: CI green, the reviewer agent approves, the Definition of Done passes.",
  },
];

/** Why agents can be left to work: the rules no message or model can bend. */
export const trustPrinciples: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "An accountable person",
    body: "Every agent has a name, an owner and a scope. It acts with its owner’s permissions, never more, and is shown as Forge via Priya.",
  },
  {
    title: "Text is never permission",
    body: "A message, issue, comment or model output cannot authorize anything. Authority comes from a signed-in person or an agent acting within its owner’s permissions.",
  },
  {
    title: "Approvals belong to revisions",
    body: "Approving a specification, accepting scope and recording decisions stay a person’s act. An approval names the revision it covers and goes stale when that text changes.",
  },
  {
    title: "Done is evidence",
    body: "An agent saying it is finished changes nothing. Items reach done through merged pull requests, green checks and the Definition of Done.",
  },
  {
    title: "Every action on the record",
    body: "History shows who did what, on which revision, and through which agent. Autopilot merges are attributed to the policy and the admin who set it.",
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
    stack:
      "A chat app. Decisions stay in scrollback unless someone copies them out.",
    lictory:
      "Channels, threads and direct messages. What matters is promoted into a proposal, a decision or an anchored discussion that links back.",
  },
  {
    need: "Agree on what to build",
    stack:
      "A wiki page or an issue description that anyone can change after it was reviewed.",
    lictory:
      "Specifications with revisions, diffs, anchored discussions and approvals that belong to the revision they cover.",
  },
  {
    need: "Plan and track delivery",
    stack: "An issue tracker, linked to the documents by hand.",
    lictory:
      "Delivery items that record the revision they came from, on native boards and sprints, or published to Jira.",
  },
  {
    need: "Write and review code",
    stack: "A code host, connected to the tracker through apps and webhooks.",
    lictory:
      "Your code host stays. Branches, pull requests and checks link to work items, and the Definition of Done reads them.",
  },
  {
    need: "Run coding agents",
    stack:
      "Agent tools set up per developer, each with their own credentials and no shared record.",
    lictory:
      "Agents with an owner and a scope, on runners you register, with short-lived credentials issued per session.",
  },
  {
    need: "Keep what the team knows",
    stack: "A separate wiki with its own permissions.",
    lictory: "Spaces, with the same reviewed history as specifications.",
  },
  {
    need: "Permissions and audit",
    stack: "One set per tool, reconciled by an administrator.",
    lictory:
      "One permission check for people and agents, and one history of who did what.",
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
      "Lictory is the control plane of a software factory. A software team and its agents talk in channels, agree on what to build through specifications reviewed like code, plan the work, let coding agents implement it on runners the team controls, and ship it with evidence. People make the decisions; agents do most of the work in between.",
  },
  {
    question: "Is Lictory open source?",
    answer: `${openSource.summary} ${openSource.detail}`,
  },
  {
    question: "Which coding agents can run in Lictory?",
    answer:
      "A runner can execute Claude Code, Codex, OpenCode, Gemini CLI or Lictory’s built-in agent. Runners are machines you control: a server, a VPS, a laptop or a Mac. Other agents can connect over MCP with an access token bound to their own agent identity.",
  },
  {
    question: "Can an agent approve a specification or merge code?",
    answer:
      "An agent can never approve a specification revision, accept scope, merge a specification or breakdown, resolve a discussion or record a decision on its own; those stay a person’s act. Code is different: a project admin can choose Autopilot, and Lictory then merges an agent’s code pull request only when every required check passes. The policy is audited, shown on every pull request it governs and can be turned off.",
  },
  {
    question: "What does a runner need?",
    answer:
      "A Linux, macOS or Windows machine (x64 or arm64) running lictory-runner. It connects out to your Lictory server over HTTPS, so it needs no open port. Each session works in its own git worktree with a short-lived, repository-scoped code host token; model keys for the built-in agent stay on the server.",
  },
  {
    question: "Do we have to leave Slack, Jira or GitHub?",
    answer:
      "No. Your code host (GitHub, GitLab or Bitbucket) stays the home of your code; Lictory links branches, pull requests and checks to work items. A project can keep Jira Cloud for delivery and publish approved work to it. A Lictory channel can be linked to a Slack channel, and each message stays owned by the system it was written in.",
  },
  {
    question: "Do product people need to understand Git?",
    answer:
      "No. A branch is a place to explore a proposed change without altering the agreed specification. A pull request brings that change back for review. You work with requirements, discussions and approvals, not a code repository.",
  },
  {
    question: "What happens to approvals when the spec changes?",
    answer:
      "Approvals reference the revision that was reviewed. Material changes mark relevant approvals as stale, so reviewers see exactly what changed since they approved.",
  },
  {
    question: "Can we use Lictory without AI or agents?",
    answer:
      "Yes. Channels, specifications, reviews, delivery and Spaces work with no agent, runner, model or code host configured. AI findings and agents assist when you enable them; they never silently rewrite, resolve, approve or publish your work.",
  },
  {
    question: "Which AI models can we use? Can they run on our own servers?",
    answer:
      "Your installation chooses one language model and, for dictation, one speech-to-text model. Cloud: OpenAI, Anthropic, Google Gemini and Vertex AI, Azure OpenAI, Amazon Bedrock, Mistral, xAI, Groq, DeepSeek or OpenRouter. Self-hosted: open-weight models on Ollama, vLLM, LM Studio, llama.cpp or any OpenAI-compatible server, and Whisper servers such as Speaches or whisper.cpp for dictation. An instance administrator sets it up in the admin console or with lictory ai setup, and tests it before saving. Requests go only to the provider you chose.",
  },
  {
    question: "How long does setup take?",
    answer:
      "Install Lictory on your own server with the lictory command, then create an organization, a project and a team; defaults for work item types, workflow and readiness are ready to use. Connect a code host and register a runner with a one-time token when you want agents to write code.",
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
