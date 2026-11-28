import {
  comparisonCellText,
  comparisonRows,
  type ComparisonCell,
} from "@lictory/marketing/components/landing/content";
import {
  product as findProduct,
  type ProductId,
  type ProductProfile,
} from "@lictory/marketing/content/products";

// Public comparison pages (/compare/[slug]). Claims about other products are
// limited to what their own public websites and documentation say, with the
// sources listed on the product's profile (content/products.ts). Keep the copy
// honest about where they fit better, and leave out what cannot be checked.

/** A capability cell; "undocumented" means we could not find it in their docs. */
export type CapabilityCell = ComparisonCell | "undocumented";

export const capabilityCellText: Record<CapabilityCell, string> = {
  ...comparisonCellText,
  undocumented: "Not documented",
};

export type CapabilityRow = {
  feature: string;
  lictory: CapabilityCell;
  competitor: CapabilityCell;
  /** Short qualification shown under the feature, such as a paid edition. */
  note?: string;
};

export type Comparison = {
  /** URL segment after /compare/. */
  slug:
    | "jira"
    | "linear"
    | "lictory-vs-plane"
    | "lictory-vs-openproject"
    | "lictory-vs-taiga"
    | "slack-and-jira";
  competitor: string;
  /** The competitor's profile, for the licensing, hosting and pricing table. */
  product?: ProductId;
  /** Further profiles when the competitor is a stack of products. */
  alsoProducts?: readonly ProductId[];
  /** Document title and search result headline. */
  title: string;
  description: string;
  /** Visible page heading. */
  headline: string;
  intro: string;
  /** Who each product is best for, shown side by side near the top. */
  verdict: { lictory: string; competitor: string };
  /**
   * Capabilities checked against the competitor's documentation. Without it,
   * the page shows the landing page's comparison rows for this competitor.
   */
  capabilities?: readonly CapabilityRow[];
  /** Markdown sections, rendered in order. */
  sections: ReadonlyArray<{ id: string; title: string; body: string }>;
  faqs: ReadonlyArray<{ question: string; answer: string }>;
  /** ISO date of the last material content change. */
  updated: string;
};

export const comparisons: readonly Comparison[] = [
  {
    slug: "slack-and-jira",
    competitor: "Slack + Jira",
    product: "slack",
    alsoProducts: ["jira"],
    title:
      "Lictory vs Slack + Jira: one workspace for conversation, specifications, agents and delivery",
    description:
      "Lictory compared with running a software team on Slack and Jira: chat, reviewed specifications, delivery and coding agents in one self-hosted product.",
    headline: "Lictory vs Slack + Jira",
    intro:
      "Many teams talk in Slack and track work in Jira. Lictory puts the conversation, the agreed specification, the delivery work and the coding agents in one self-hosted product. Use it instead of both, or keep either one and connect it.",
    verdict: {
      lictory:
        "Choose Lictory for conversations, specifications, delivery and coding agents in one data model and one permission system, on servers you run.",
      competitor:
        "Keep Slack and Jira when your company has standardized on them, depends on their apps or Jira’s configurable workflows, or wants a vendor-hosted service.",
    },
    capabilities: [
      {
        feature: "Channels, threads and direct messages",
        lictory: "yes",
        competitor: "yes",
      },
      {
        feature: "Turn a chat message into a work item",
        lictory: "yes",
        competitor: "yes",
        note: "Slack + Jira: with the Jira Cloud app for Slack.",
      },
      {
        feature: "Boards, backlog and sprints",
        lictory: "yes",
        competitor: "yes",
      },
      {
        feature: "Specifications with revisions and revision-bound approvals",
        lictory: "yes",
        competitor: "no",
      },
      {
        feature: "Readiness as evidence-based checks",
        lictory: "yes",
        competitor: "partial",
      },
      {
        feature: "Coding agents on runners you register, each with an owner",
        lictory: "yes",
        competitor: "undocumented",
      },
      {
        feature: "One permission model and history for chat, work and agents",
        lictory: "yes",
        competitor: "no",
        note: "Slack + Jira: two products, each with its own.",
      },
      {
        feature: "Open source",
        lictory: "yes",
        competitor: "no",
      },
      {
        feature: "Run it on your own server",
        lictory: "yes",
        competitor: "partial",
        note: "Slack + Jira: Jira Data Center, for existing customers until 28 March 2029.",
      },
      {
        feature: "A service the vendor hosts for you",
        lictory: "no",
        competitor: "yes",
      },
      {
        feature: "Marketplace of third-party apps",
        lictory: "no",
        competitor: "yes",
      },
    ],
    sections: [
      {
        id: "short-answer",
        title: "The short answer",
        body: `Slack is where the team talks. Jira is where the work is tracked. Between them, people copy decisions into tickets and ask which version was agreed.

Lictory is one product for the whole path: a **channel** message is **promoted** into a proposal, refined into a **specification** people approve revision by revision, broken down into **delivery items**, and implemented by **coding agents** on runners you control, linked to your code host’s pull requests and checks. Every step links to the one before it.`,
      },
      {
        id: "differences",
        title: "Where they differ",
        body: `- **Decisions leave the chat.** A message or thread becomes a proposal, a decision or a discussion anchored on the specification’s text, linked back to the conversation.
- **Requirements are reviewed like code.** Specifications change through immutable revisions with diffs; reviewers approve a specific revision, and approvals go stale when the text changes. A Jira description is edited in place.
- **Agents are accountable members.** An agent has a name, an owner and a scope, and acts with its owner’s permissions. It claims only work the readiness policy allows to start, and asks people in its session’s thread.
- **Done is evidence.** An item is done when its Definition of Done passes: linked pull requests merged, required checks green. An agent’s report changes nothing.
- **One record.** Chat, specifications, delivery and agent sessions share one permission check and one history.`,
      },
      {
        id: "alongside",
        title: "Using Lictory alongside Slack or Jira",
        body: `You do not have to move everything at once.

- **Keep Jira for delivery.** A project set to external delivery refines and approves specifications in Lictory, then publishes ready work to Jira Cloud with a link back to the approved revision. Jira then owns status and assignment.
- **Link Slack channels.** A Lictory channel can be linked to a Slack channel. Each message is owned by the system it was written in, and Lictory never rewrites a Slack-authored message.
- **Keep your code host.** GitHub, GitLab or Bitbucket stays the home of your code; Lictory links branches, pull requests and checks to work items.`,
      },
      {
        id: "cost",
        title: "Seats, integrations and where data lives",
        body: `Slack and Jira are each licensed per user and run on their vendor’s cloud. Lictory is MIT licensed with every feature in the open-source code: you pay for the server, the runners and the AI provider you choose, if any.

Fewer products means fewer integrations to maintain and fewer places to revoke access when someone leaves. The trade-off: you operate the server yourself. There is no Lictory cloud.`,
      },
      {
        id: "when-stack",
        title: "When Slack and Jira are the better fit",
        body: `Keep them if your company has standardized on them across many teams, if you rely on their marketplace apps, Jira’s workflow schemes, service management, time tracking or portfolio planning, or if you want a vendor-hosted service. Lictory is not a time tracker, a capacity planner or a workflow builder.`,
      },
    ],
    faqs: [
      {
        question: "Can Lictory replace Slack and Jira for a software team?",
        answer:
          "For many small and medium software teams, yes: channels, specifications, boards, backlog, sprints or cycles, and coding agents on your own runners. Teams that depend on marketplace apps, service management or time tracking usually keep those tools.",
      },
      {
        question: "Can we keep Jira and still use Lictory?",
        answer:
          "Yes. Set a project to external delivery: Lictory handles conversation, refinement, review and breakdown, then publishes approved work to Jira Cloud. One system owns delivery state for each piece of work.",
      },
      {
        question: "What happens to messages in a linked Slack channel?",
        answer:
          "A message is owned by the system it was written in. Edits and deletions flow only from there, and Lictory never rewrites a Slack message.",
      },
      {
        question: "Where does our data live?",
        answer:
          "Lictory runs only on your own server; there is no Lictory cloud. Slack stores each workspace’s data in one region of its own service, the United States unless the workspace uses data residency.",
      },
    ],
    updated: "2026-11-24",
  },
  {
    slug: "jira",
    competitor: "Jira",
    product: "jira",
    title: "Lictory vs Jira: review requirements before they become tickets",
    description:
      "Lictory compared with Jira for requirements refinement, specification review and delivery, and how to refine in Lictory while delivering in Jira.",
    headline: "Lictory vs Jira",
    intro:
      "Jira tracks delivery. Lictory covers the step before it: turning a rough proposal into a specification product, engineering and QA actually agreed on. Use it instead of Jira, or in front of it.",
    verdict: {
      lictory:
        "Choose Lictory when ambiguity, rework and “that is not what we agreed” are the problem, and you want traceable reviews, approvals and readiness.",
      competitor:
        "Choose Jira alone when requirements are already clear and you mainly need configurable issue tracking, a large app marketplace or service management.",
    },
    sections: [
      {
        id: "short-answer",
        title: "The short answer",
        body: `Jira tracks the work. Lictory agrees what the work is.

In Jira, a requirement is an issue description, a few comments and perhaps a Confluence page. The text can change at any time, and “ready” is a status or a checklist someone ticks.

In Lictory, a requirement is reviewed like code: every change creates an immutable **revision**, reviewers discuss the **exact sentence**, suggested wording is **accepted or rejected** as a new revision, and **approvals belong to the revision** that was reviewed.`,
      },
      {
        id: "differences",
        title: "Where the two differ",
        body: `- **Revisions and diffs.** Jira keeps a change history for the description. Lictory makes every change a numbered revision you can compare, restore and cite.
- **Anchored discussions.** Jira comments belong to the whole issue. Lictory threads attach to a text range, a section or a suggestion, and can be blocking.
- **Suggestions.** Reviewers propose concrete wording; accepting it creates a new, attributed revision.
- **Approvals that go stale.** Engineering approving revision 12 does not silently cover revision 14. Material changes mark the affected approvals for another review.
- **Readiness as evidence.** Instead of a “Ready” status, checks: by default specification written, no open blocking discussions, required reviews requested and approved on the current revision, and every child specification ready. Projects add their own, such as a required “Acceptance criteria” section, a QA approval or a manual sign-off.
- **Decisions.** Conclusions from long threads become durable decision records instead of buried comments.`,
      },
      {
        id: "with-jira",
        title: "Using Lictory with Jira",
        body: `Each Lictory project chooses where delivery happens. Set a project to **external delivery** and Jira stays the system your engineers work in:

1. Product drafts a proposal in Lictory, even a rough one.
2. Engineering, QA and other disciplines review it, raise blocking concerns and suggest changes.
3. Once the readiness checks pass, the approved specification is decomposed into stories and tasks.
4. Someone with permission hands the work off to Jira Cloud. Only ready specifications are exported, and each Jira issue links back to its revision.

After hand-off, Jira owns status, assignee, sprint and comments. Lictory owns the summary, description and acceptance criteria it published, shows the Jira status read-only, and holds edits made to those fields in Jira as conflicts instead of overwriting them. Exports are idempotent: retrying a partial failure creates no duplicates.`,
      },
      {
        id: "native",
        title: "Replacing Jira for delivery",
        body: `Small and medium teams can also deliver natively in Lictory, with the same refinement workflow: configurable work item types (Epic, Story, Task, Bug, Subtask by default), per-project workflow statuses, a kanban board, a ranked backlog, sprints or automatic cycles, estimates, burndown, velocity and relations (blocks, relates, duplicates).

Readiness then gates starting work: per project, an item that is not ready can start freely, with a warning, or not at all.

Lictory is not a time tracker, a capacity planner, a portfolio suite or a workflow builder.`,
      },
      {
        id: "when-jira",
        title: "When Jira is the better fit",
        body: `Jira is stronger if you depend on workflow schemes with validators and transition rules, Marketplace apps, Jira Service Management, built-in time tracking or portfolio planning across many teams. Then keep Jira for delivery and use Lictory for refinement and review.`,
      },
    ],
    faqs: [
      {
        question: "Can we use Lictory and Jira together?",
        answer:
          "Yes. Set a Lictory project to external delivery: specifications are refined and approved in Lictory, then ready work is handed off to Jira Cloud with a link back to the approved revision.",
      },
      {
        question: "Who owns the status of work after it is published to Jira?",
        answer:
          "Jira. Exactly one system owns delivery state: after hand-off, status, assignee, sprint and comments belong to Jira, and Lictory shows them read-only.",
      },
      {
        question:
          "What happens if someone edits a published description in Jira?",
        answer:
          "Lictory does not overwrite it. The item is held as a conflict until the person exporting decides whether to replace the Jira text with the latest approved revision.",
      },
      {
        question: "Do product managers need to learn Git to use Lictory?",
        answer:
          "No. The workflow is inspired by pull requests, but the language is about proposals, revisions, reviews and approvals.",
      },
    ],
    updated: "2026-11-08",
  },
  {
    slug: "linear",
    competitor: "Linear",
    title: "Lictory vs Linear: agree on the spec, then ship fast",
    description:
      "Lictory compared with Linear for specification review, approvals, readiness and delivery, and when to use each.",
    headline: "Lictory vs Linear",
    intro:
      "Linear is a fast, opinionated issue tracker. Lictory shares its taste for simplicity and adds what Linear leaves to documents and meetings: reviewing, approving and proving a specification ready before work starts.",
    verdict: {
      lictory:
        "Choose Lictory when product, engineering and QA need to agree on behavior before committing, and you want revision-bound approvals and readiness checks.",
      competitor:
        "Choose Linear alone when your team mostly agrees on what to build and needs a fast tracker.",
    },
    sections: [
      {
        id: "short-answer",
        title: "The short answer",
        body: `Linear helps engineers move issues quickly. Lictory makes sure the issue describes something everyone agreed to.

In Linear, the requirement is an issue or project description plus comments. In Lictory, a specification has **immutable revisions**, **diffs**, **threads anchored to the exact text**, **suggestions** reviewers accept or reject, **approvals bound to a revision** and **readiness checks** that pass as answers arrive.`,
      },
      {
        id: "differences",
        title: "Where the two differ",
        body: `- **Review as a workflow.** Reviews are requested from disciplines such as Product, Engineering, QA or Security; each approves a specific revision.
- **Stale approvals.** When approved content changes materially, the affected approvals go stale.
- **Blocking discussions.** A thread can block readiness until resolved; resolving never deletes history.
- **Readiness checks.** Per project and versioned: by default specification written, no open blocking discussions, required reviews requested and approved on the current revision, and every child specification ready. Projects add required sections, discipline approvals or manual sign-offs.
- **Decisions.** Durable records such as “retries reuse the original transaction ID” that outlive their thread.
- **Optional AI that proposes, never decides.** Lictory Intelligence finds gaps, contradictions and missing edge cases; people accept or reject its proposals. Everything works with it disabled.`,
      },
      {
        id: "delivery",
        title: "Delivery with Linear-like simplicity",
        body: `Lictory includes native delivery for small and medium teams: configurable work item types, per-project workflow statuses, a board, a ranked backlog, manual sprints or automatic cycles, estimates, burndown, velocity and relations.

Teams that deliver in an external tool can hand off approved work to Jira Cloud today. **Publishing to Linear is coming**; until then, deliver natively in Lictory or refine in Lictory alongside Linear.`,
      },
      {
        id: "when-linear",
        title: "When Linear is the better fit",
        body: `If your requirements are short, owned by engineers and rarely disputed, reviews and approvals may be more structure than you need. Linear’s speed, keyboard-first interface and integrations make it an excellent tracker on its own.`,
      },
    ],
    faqs: [
      {
        question: "Can Lictory publish work to Linear?",
        answer:
          "Not yet; Jira Cloud today, Linear is coming. Meanwhile, deliver natively in Lictory with boards, backlog, sprints and cycles.",
      },
      {
        question: "Is Lictory as simple as Linear?",
        answer:
          "That is the goal for delivery: strong defaults, few concepts, no configuration before first use. Reviews add structure only where agreement matters.",
      },
      {
        question: "Does Lictory replace product requirement documents?",
        answer:
          "Yes. The specification is the document, with its own revisions, discussions, approvals and readiness. No separate PRD to keep in sync.",
      },
    ],
    updated: "2026-10-15",
  },
  {
    slug: "lictory-vs-plane",
    competitor: "Plane",
    product: "plane",
    title: "Lictory vs Plane: two open-source Jira alternatives compared",
    description:
      "Lictory and Plane are both open source and self-hostable. How they differ in licensing, editions, specification review, delivery features and Jira migration.",
    headline: "Lictory vs Plane",
    intro:
      "Plane and Lictory are both open-source, self-hostable work management with boards, cycles and estimates. Plane is a broad project tool with paid editions for governance. Lictory is built around reviewing and approving specifications before work starts, in one MIT-licensed edition.",
    verdict: {
      lictory:
        "Choose Lictory when the expensive mistakes happen before development: unclear requirements, untraceable approvals, “ready” that was never proven. MIT licensed, no paid tier.",
      competitor:
        "Choose Plane for a broad project tool with Gantt timelines, time tracking, a hosted cloud and a Jira importer, if paid editions for workflows, approvals and SSO are acceptable.",
    },
    capabilities: [
      {
        feature: "Approvals tied to a specification revision",
        lictory: "yes",
        competitor: "undocumented",
        note: "Plane documents approvals for work item state transitions (Enterprise Grid), not for pages.",
      },
      {
        feature: "Readiness checks that gate starting work",
        lictory: "yes",
        competitor: "undocumented",
      },
      {
        feature: "Reviewers accept or reject suggested wording",
        lictory: "yes",
        competitor: "undocumented",
      },
      {
        feature: "Approval steps on workflow transitions",
        lictory: "no",
        competitor: "yes",
        note: "Plane: Enterprise Grid. Lictory deliberately has no transition rules.",
      },
      {
        feature: "Board, cycles and estimates",
        lictory: "yes",
        competitor: "yes",
      },
      {
        feature: "Wiki or knowledge pages",
        lictory: "yes",
        competitor: "yes",
        note: "Plane: pages in every edition, the Wiki from the Pro plan. Lictory: Spaces with reviewed page history.",
      },
      {
        feature: "Gantt or timeline view",
        lictory: "no",
        competitor: "yes",
      },
      {
        feature: "Time tracking",
        lictory: "no",
        competitor: "yes",
        note: "Plane: worklogs from the Pro plan.",
      },
      {
        feature: "Import from Jira",
        lictory: "no",
        competitor: "yes",
        note: "Plane: Plane Cloud and the Commercial Edition, not the self-hosted Community Edition.",
      },
      {
        feature: "Hand approved work off to Jira Cloud",
        lictory: "yes",
        competitor: "undocumented",
      },
      {
        feature: "MCP server for AI agents",
        lictory: "yes",
        competitor: "yes",
      },
      {
        feature: "Vendor-hosted cloud",
        lictory: "no",
        competitor: "yes",
      },
    ],
    sections: [
      {
        id: "short-answer",
        title: "The short answer",
        body: `Plane is a general-purpose project tool: work items, cycles, modules, several layouts including Gantt, pages, intake and dashboards, with a hosted cloud and a self-hosted Community Edition.

Lictory is narrower on purpose. Its core is the step before delivery: a **specification** changes through immutable **revisions**, reviewers comment on the **exact text**, suggested wording is **accepted or rejected**, **approvals belong to the revision**, and **readiness checks** prove the work can start. Delivery has boards, backlog, sprints, cycles and estimates, without Gantt charts or time tracking.`,
      },
      {
        id: "editions",
        title: "Open source, editions and what costs money",
        body: `Both are open source, under different terms:

- **Plane** publishes its Community Edition under **AGPL-3.0**. Plane says the Commercial Edition adds “governance and scale”: workflows, approvals, SSO, audit trails, work item types and more. On Plane Cloud, the free plan covers up to 12 users, and features such as the Wiki, time tracking and custom work item types start at paid plans.
- **Lictory** is **MIT licensed**, with one edition. Specification review, approvals, readiness checks, OpenID Connect sign-in, audit history and native delivery are all in the code you install. No hosted Lictory, no paid tier.

If you modify the code, MIT does not require you to publish changes; AGPL-3.0 has obligations when a modified version is offered to users over a network.`,
      },
      {
        id: "self-hosting",
        title: "Self-hosting",
        body: `Plane supports Docker Compose, Kubernetes with Helm, Podman and one-click platforms such as Coolify and Portainer, and offers air-gapped deployments.

Lictory runs on **one Linux server with Docker Compose**. The \`lictory\` command installs a release, checks the server, takes backups, upgrades and rolls back. PostgreSQL runs in a container by default, or on your own or a managed server. Lictory is only self-hosted: if you want a vendor to run it, Plane Cloud is the closer fit.`,
      },
      {
        id: "migration",
        title: "Coming from Jira",
        body: `Plane documents a Jira importer for Jira Cloud and Server/Data Center, available on Plane Cloud and the Commercial Edition for self-hosted instances.

Lictory has **no Jira importer** today. Teams usually keep Jira for delivery at first: a project set to external delivery refines and approves specifications, then hands ready work off to **Jira Cloud** with a link back to the approved revision. Projects can move to native delivery later.`,
      },
      {
        id: "when-plane",
        title: "When Plane is the better fit",
        body: `Choose Plane if you need Gantt timelines, time tracking, intake forms, dashboards, a vendor-hosted cloud or an importer that brings Jira history across. Its scope is closer to a general project management suite, which Lictory is not.`,
      },
    ],
    faqs: [
      {
        question: "Are Lictory and Plane both open source?",
        answer:
          "Yes. Plane's Community Edition is AGPL-3.0, with a separate Commercial Edition for features such as workflows, approvals and SSO. Lictory is MIT licensed with a single edition that contains every feature.",
      },
      {
        question: "Can Plane approve a specification revision?",
        answer:
          "Plane documents approvals as steps on work item state transitions, in its Enterprise Grid plan, and none for pages or specification revisions that we could find. In Lictory, approvals belong to the reviewed revision and go stale when it changes materially.",
      },
      {
        question: "Which is easier to self-host?",
        answer:
          "Both run with Docker Compose. Plane also supports Kubernetes, Podman and one-click platforms. Lictory targets one Linux server and ships a lictory command for installation, health checks, backups, upgrades and rollback.",
      },
      {
        question: "Can I import my Jira projects?",
        answer:
          "Into Plane, yes: its Jira importer is available on Plane Cloud and the Commercial Edition. Lictory has no importer yet; teams keep Jira for delivery and hand approved work off to Jira Cloud.",
      },
    ],
    updated: "2026-11-08",
  },
  {
    slug: "lictory-vs-openproject",
    competitor: "OpenProject",
    product: "openproject",
    title: "Lictory vs OpenProject: open-source project management compared",
    description:
      "Lictory and OpenProject are both open source and self-hosted. How they compare on licensing, editions, document review, Gantt and time tracking, delivery and Jira migration.",
    headline: "Lictory vs OpenProject",
    intro:
      "OpenProject is a mature open-source suite for classic, agile and hybrid projects: Gantt charts, time and cost tracking, wikis, meetings and portfolios. Lictory covers far less ground and goes deeper on one thing: getting a software specification reviewed, approved and proven ready before delivery starts.",
    verdict: {
      lictory:
        "Choose Lictory when your software team’s problem is agreeing on requirements: reviews on the exact text, revision-bound approvals and provable readiness.",
      competitor:
        "Choose OpenProject when you need broad project management: Gantt scheduling, time and cost tracking, budgets, meetings or portfolio management, possibly beyond software teams.",
    },
    capabilities: [
      {
        feature: "Versioned specification documents with diffs",
        lictory: "yes",
        competitor: "no",
        note: "OpenProject’s Documents module states it has no versioning; track changes is on its roadmap.",
      },
      {
        feature: "Approvals tied to a document revision",
        lictory: "yes",
        competitor: "undocumented",
        note: "Document approval workflows are listed on OpenProject’s roadmap.",
      },
      {
        feature: "Readiness checks that gate starting work",
        lictory: "yes",
        competitor: "undocumented",
      },
      {
        feature: "Agile boards, backlog and sprints",
        lictory: "yes",
        competitor: "yes",
      },
      {
        feature: "Gantt charts",
        lictory: "no",
        competitor: "yes",
      },
      {
        feature: "Time tracking, costs and budgets",
        lictory: "no",
        competitor: "yes",
      },
      {
        feature: "Portfolio management",
        lictory: "no",
        competitor: "yes",
        note: "OpenProject: Enterprise plans.",
      },
      {
        feature: "Wiki",
        lictory: "yes",
        competitor: "yes",
        note: "Lictory: Spaces, with page changes reviewed like specifications.",
      },
      {
        feature: "Configurable workflow statuses",
        lictory: "yes",
        competitor: "yes",
      },
      {
        feature: "Import from Jira",
        lictory: "no",
        competitor: "partial",
        note: "OpenProject: a beta migrator for Jira Data Center; Jira Cloud is not supported.",
      },
      {
        feature: "Hand approved work off to Jira Cloud",
        lictory: "yes",
        competitor: "undocumented",
      },
      {
        feature: "Vendor-hosted cloud",
        lictory: "no",
        competitor: "yes",
      },
    ],
    sections: [
      {
        id: "short-answer",
        title: "The short answer",
        body: `OpenProject is a project management suite: work packages, Gantt charts, agile boards, time and cost reporting, budgets, wikis, forums, meetings and, in Enterprise plans, portfolio and resource management.

Lictory is built for software teams and focuses on the requirements. A specification has immutable **revisions** you can compare, **threads anchored to the exact text**, **suggestions** reviewers accept or reject, **approvals bound to a revision** and **readiness checks**. It then delivers with boards, backlog, sprints or cycles, estimates and relations, or hands the work off to Jira Cloud.`,
      },
      {
        id: "documents",
        title: "Reviewing requirements",
        body: `This is the largest difference. OpenProject's Documents module supports real-time co-editing, and its documentation states there is no document versioning. Its public roadmap lists approval workflows, review cycles, inline comments and track changes as planned.

In Lictory, the review workflow is the product. Every change is a numbered revision. When Engineering approved revision 12 and the text is now revision 14, Engineering's approval needs another review. A blocking discussion keeps the specification from being ready until resolved, and resolving never deletes history.`,
      },
      {
        id: "scope",
        title: "Scope: a suite or a focused tool",
        body: `OpenProject suits organizations that plan schedules, track hours and costs, or run projects outside software.

Lictory has no Gantt charts, time tracking, budgets, capacity planning or portfolio management, and will not grow into them. If you need those, choose OpenProject; Lictory is for software teams who want delivery essentials with Linear-like simplicity.`,
      },
      {
        id: "editions",
        title: "Licensing, editions and hosting",
        body: `OpenProject's Community edition is **GPL-3.0** and free. Enterprise plans, in OpenProject's cloud (hosted in the EU) or on-premises, are priced per user per month with minimum user counts and add further features. OpenProject installs with Docker Compose, DEB/RPM packages or Helm charts.

Lictory is **MIT licensed** with a single edition. It is only self-hosted, on one Linux server with Docker Compose; the \`lictory\` command handles installation, backups, upgrades and rollback.`,
      },
      {
        id: "migration",
        title: "Coming from Jira",
        body: `OpenProject offers a Jira migrator, in beta for Jira Data Center and not for Jira Cloud. Lictory has **no importer**; a project can keep Jira Cloud for delivery and hand approved work off to it, so teams adopt Lictory for refinement without moving their tickets.`,
      },
    ],
    faqs: [
      {
        question:
          "Is OpenProject or Lictory better for requirements management?",
        answer:
          "For reviewing and approving software requirements, Lictory: revisions, anchored discussions, suggestions, revision-bound approvals and readiness checks. OpenProject's Documents module has no versioning today; approval workflows are on its roadmap.",
      },
      {
        question: "Does Lictory have Gantt charts or time tracking?",
        answer:
          "No. Lictory deliberately has no Gantt charts, time tracking, budgets or portfolio management. OpenProject covers all of these.",
      },
      {
        question: "Are both free to self-host?",
        answer:
          "Yes. OpenProject's Community edition (GPL-3.0) is free, with paid Enterprise plans for more features. Lictory (MIT) is free with no paid edition.",
      },
      {
        question: "Can I migrate from Jira?",
        answer:
          "OpenProject has a beta migrator for Jira Data Center. Lictory has no importer; it can hand approved work off to Jira Cloud so you keep delivering there.",
      },
    ],
    updated: "2026-11-08",
  },
  {
    slug: "lictory-vs-taiga",
    competitor: "Taiga",
    product: "taiga",
    title: "Lictory vs Taiga: open-source agile tools compared",
    description:
      "Lictory and Taiga are both open source and self-hostable agile tools. How they compare on licensing, hosting, Scrum and Kanban, requirements review and Jira migration.",
    headline: "Lictory vs Taiga",
    intro:
      "Taiga is a long-standing open-source agile tool with Scrum, Kanban, epics and a wiki. Lictory covers the same everyday delivery and adds what Taiga leaves to story descriptions and comments: reviewing, approving and proving a specification ready.",
    verdict: {
      lictory:
        "Choose Lictory when user stories are not enough: product, engineering and QA need to review the exact text, approve a specific revision and see readiness as evidence.",
      competitor:
        "Choose Taiga for a simple, proven Scrum or Kanban tool with a flat-priced hosted option, when requirements are settled in conversation rather than review.",
    },
    capabilities: [
      {
        feature: "Specification revisions with diffs",
        lictory: "yes",
        competitor: "undocumented",
      },
      {
        feature: "Approvals tied to a specification revision",
        lictory: "yes",
        competitor: "undocumented",
      },
      {
        feature: "Readiness checks that gate starting work",
        lictory: "yes",
        competitor: "undocumented",
      },
      {
        feature: "Scrum backlog, sprints and burndown",
        lictory: "yes",
        competitor: "yes",
      },
      {
        feature: "Kanban board",
        lictory: "yes",
        competitor: "yes",
        note: "Taiga advertises swimlanes and WIP limits.",
      },
      {
        feature: "Epics and subtasks",
        lictory: "yes",
        competitor: "yes",
      },
      {
        feature: "Wiki",
        lictory: "yes",
        competitor: "yes",
      },
      {
        feature: "Custom fields",
        lictory: "no",
        competitor: "yes",
      },
      {
        feature: "Import from Jira",
        lictory: "no",
        competitor: "partial",
        note: "Taiga: Jira releases up to 8.5; not 8.6 or later.",
      },
      {
        feature: "Hand approved work off to Jira Cloud",
        lictory: "yes",
        competitor: "undocumented",
      },
      {
        feature: "Vendor-hosted cloud",
        lictory: "no",
        competitor: "yes",
      },
    ],
    sections: [
      {
        id: "short-answer",
        title: "The short answer",
        body: `Taiga is an agile project tool: a Scrum backlog with sprints, estimations and burndown, a Kanban board with swimlanes and WIP limits, epics, issues, a wiki and custom fields.

Lictory covers similar delivery ground (board, ranked backlog, sprints or automatic cycles, estimates, burndown, velocity, epics and subtasks) and puts the specification at the center: reviewed on the exact text, revised through accepted suggestions, approved per revision, with readiness checks that show when a story can start.`,
      },
      {
        id: "requirements",
        title: "Where requirements live",
        body: `In Taiga, a requirement is the description of a user story or epic, plus its comments and wiki pages. That works well when the team mostly agrees.

In Lictory, the specification is reviewed like code. Engineering, QA, Security and other disciplines review it; their discussions attach to the sentence and can block readiness; approvals name their revision and go stale when it changes materially. Conclusions become durable **decisions** instead of staying buried in a thread.`,
      },
      {
        id: "project-status",
        title: "Licensing, hosting and project status",
        body: `Taiga is **MPL-2.0**, self-hosted with Docker Compose, and also offered as Taiga Cloud with a free plan and flat-priced paid plans, plus private cloud and supported on-premises options. Its maintainers have said Taiga will stay free and open source. The planned successor, previously called Taiga Next, continues as a separate project named Tenzu, while Taiga 6 is still updated in its public repositories.

Lictory is **MIT licensed**, only self-hosted on one Linux server with Docker Compose, and has no paid edition.`,
      },
      {
        id: "migration",
        title: "Coming from Jira",
        body: `Taiga's importer supports Jira releases up to 8.5 and brings across issues, sprints, comments, attachments and history. Lictory has **no importer**; a Lictory project can instead keep Jira Cloud as its delivery system and hand approved work off to it.`,
      },
      {
        id: "when-taiga",
        title: "When Taiga is the better fit",
        body: `If your team wants a straightforward Scrum or Kanban tool, likes Taiga's interface, needs custom fields, or prefers a hosted plan without per-user pricing, Taiga is a good choice.`,
      },
    ],
    faqs: [
      {
        question: "Is Taiga still maintained?",
        answer:
          "Taiga 6 is still updated in its public repositories; recent changes include security fixes. The successor once called Taiga Next continues as a separate project named Tenzu, run by a different team.",
      },
      {
        question: "Do Lictory and Taiga both support Scrum and Kanban?",
        answer:
          "Yes. Both have a board, a backlog, sprints, estimates and burndown. Lictory also offers automatic cycles and adds specification review, revision-bound approvals and readiness checks.",
      },
      {
        question: "What licenses do they use?",
        answer:
          "Taiga is MPL-2.0. Lictory is MIT. Both can be self-hosted for free.",
      },
      {
        question: "Can I bring my Jira issues?",
        answer:
          "Taiga's importer supports Jira up to release 8.5. Lictory has no importer yet; it hands approved work off to Jira Cloud instead.",
      },
    ],
    updated: "2026-11-08",
  },
];

export function comparison(slug: string) {
  return comparisons.find((item) => item.slug === slug);
}

/** The capability table of a comparison. */
export function capabilityRows(item: Comparison): readonly CapabilityRow[] {
  if (item.capabilities) return item.capabilities;
  const key = item.slug;
  if (key !== "jira" && key !== "linear")
    throw new Error(`${item.slug} has no capability rows.`);
  return comparisonRows.map((row) => ({
    feature: row.feature,
    lictory: row.lictory,
    competitor: row[key],
  }));
}

/** Lictory first, then every product the comparison is about. */
export function comparisonProfiles(item: Comparison): ProductProfile[] {
  if (!item.product) return [];
  return [
    findProduct("lictory"),
    findProduct(item.product),
    ...(item.alsoProducts ?? []).map(findProduct),
  ];
}

/** When the facts about the other products were last checked: the oldest check. */
export function comparisonReviewed(item: Comparison) {
  return comparisonProfiles(item)
    .slice(1)
    .map((profile) => profile.reviewed)
    .sort()[0];
}

export function comparisonPath(item: Comparison) {
  return `/compare/${item.slug}`;
}
