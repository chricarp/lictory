import {
  comparisonCellText,
  comparisonRows,
  type ComparisonCell,
} from "@lictory/marketing/components/landing/content";
import type { ProductId } from "@lictory/marketing/content/products";

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
    | "lictory-vs-taiga";
  competitor: string;
  /** The competitor's profile, for the licensing, hosting and pricing table. */
  product?: ProductId;
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
    slug: "jira",
    competitor: "Jira",
    product: "jira",
    title: "Lictory vs Jira: review requirements before they become tickets",
    description:
      "How Lictory compares with Jira for requirements refinement, specification review and delivery, and how to refine in Lictory while delivering in Jira.",
    headline: "Lictory vs Jira",
    intro:
      "Jira is where many software teams track delivery. Lictory focuses on the step before it: turning a rough proposal into a specification that product, engineering and QA have actually agreed on. You can use Lictory instead of Jira, or in front of it.",
    verdict: {
      lictory:
        "Choose Lictory when ambiguity, rework and “that is not what we agreed” are the problem, and you want reviews, approvals and readiness you can trace.",
      competitor:
        "Choose Jira alone when requirements are already clear and you mainly need configurable issue tracking, a large app marketplace or service management.",
    },
    sections: [
      {
        id: "short-answer",
        title: "The short answer",
        body: `Jira tracks the work. Lictory agrees what the work is.

In Jira, a requirement is usually an issue description, a few comments and perhaps a linked Confluence page. The text can change at any time, and “ready” is typically a status, a label or a checklist someone ticks.

In Lictory, a requirement is reviewed the way developers review code: every change creates an immutable **revision**, reviewers discuss the **exact sentence** they are concerned about, suggested wording is **accepted or rejected** as a new revision, and **approvals belong to the revision** that was reviewed.`,
      },
      {
        id: "differences",
        title: "Where the two differ",
        body: `- **Revisions and diffs.** Jira keeps a change history for the description. Lictory treats every change as a numbered revision you can compare, restore and cite.
- **Anchored discussions.** Jira comments belong to the whole issue. Lictory threads attach to a text range, a section or a suggestion, and can be marked blocking.
- **Suggestions.** Lictory reviewers propose concrete wording; accepting it creates a new revision with clear attribution.
- **Approvals that go stale.** In Lictory, Engineering approving revision 12 does not silently cover revision 14. Material changes mark the affected approvals for another review.
- **Readiness as evidence.** Instead of a “Ready” status, Lictory evaluates checks: by default specification written, no open blocking discussions, required reviews requested, the current revision approved by every required review, and every child specification ready. Each project can add its own, such as a required “Acceptance criteria” section, a QA approval or a manual sign-off.
- **Decisions.** Important conclusions from long threads are promoted into durable decision records instead of being buried in comments.`,
      },
      {
        id: "with-jira",
        title: "Using Lictory with Jira",
        body: `Each Lictory project chooses where delivery happens. Set a project to **external delivery** and Jira stays the system your engineers work in:

1. Product drafts a proposal in Lictory, even if it is rough.
2. Engineering, QA and other disciplines review it, raise blocking concerns and suggest changes.
3. Once the readiness checks pass, the approved specification is decomposed into stories and tasks.
4. Someone with permission explicitly hands the work off to Jira Cloud. Only ready specifications are exported, and each Jira issue links back to the revision it came from.

After hand-off, Jira owns status, assignee, sprint and comments. Lictory owns the summary, description and acceptance criteria it published, shows the Jira status read-only, and holds edits made to those fields in Jira as conflicts instead of overwriting them silently. Exports are idempotent, so retrying a partial failure does not create duplicate issues.`,
      },
      {
        id: "native",
        title: "Replacing Jira for delivery",
        body: `Small and medium teams can also deliver natively in Lictory, with the same refinement workflow: configurable work item types (Epic, Story, Task, Bug, Subtask by default), per-project workflow statuses, a kanban board, a ranked backlog, sprints or automatic cycles, estimates, burndown, velocity and relations (blocks, relates, duplicates).

Readiness then gates starting work: per project, a spec-backed item that is not ready can move into progress freely, with a warning, or not at all.

Lictory deliberately does not try to be a time tracker, a capacity planner, a portfolio suite or a workflow builder with transition rules.`,
      },
      {
        id: "when-jira",
        title: "When Jira is the better fit",
        body: `Jira is the stronger choice if you depend on complex workflow schemes with validators and transition rules, on Marketplace apps, on Jira Service Management, on built-in time tracking or on portfolio planning across many teams. In those cases, keep Jira for delivery and consider Lictory only for refinement and review.`,
      },
    ],
    faqs: [
      {
        question: "Can we use Lictory and Jira together?",
        answer:
          "Yes. Set a Lictory project to external delivery. Specifications are refined, reviewed and approved in Lictory, then ready work is explicitly handed off to Jira Cloud with a link back to the approved revision.",
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
          "Lictory does not silently overwrite it. The item is held as a conflict until the person exporting confirms whether to replace the Jira text with the latest approved revision.",
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
      "How Lictory compares with Linear for specification review, approvals, readiness and delivery, and when to use each.",
    headline: "Lictory vs Linear",
    intro:
      "Linear is a fast, opinionated issue tracker that many engineering teams love. Lictory shares its preference for simplicity, and adds the part Linear leaves to documents and meetings: reviewing, approving and proving that a specification is ready before work starts.",
    verdict: {
      lictory:
        "Choose Lictory when product, engineering and QA need to agree on behavior before committing, and you want revision-bound approvals and readiness checks.",
      competitor:
        "Choose Linear alone when your team mostly agrees on what to build and needs a fast tracker for issues, projects and cycles.",
    },
    sections: [
      {
        id: "short-answer",
        title: "The short answer",
        body: `Linear is built to help engineers move issues quickly. Lictory is built to make sure the issue describes something everyone agreed to.

In Linear, the requirement is an issue or project description plus comments. In Lictory, a specification has **immutable revisions**, **diffs**, **threads anchored to the exact text**, **suggestions** reviewers accept or reject, **approvals bound to a revision** and **readiness checks** that pass as answers arrive.`,
      },
      {
        id: "differences",
        title: "Where the two differ",
        body: `- **Review as a workflow.** Lictory reviews are requested from disciplines such as Product, Engineering, QA or Security, and each approves a specific revision.
- **Stale approvals.** When approved content changes materially, the affected approvals go stale, so nobody ships against an approval that no longer matches the text.
- **Blocking discussions.** A thread can block readiness until it is resolved; resolving never deletes history.
- **Readiness checks.** Configurable per project and versioned: by default specification written, no open blocking discussions, required reviews requested and approved on the current revision, and every child specification ready; projects add required sections, discipline approvals or manual sign-offs.
- **Decisions.** Durable records of conclusions, such as “retries reuse the original transaction ID”, that outlive the thread they came from.
- **Optional AI that proposes, never decides.** Lictory Intelligence finds gaps, contradictions and missing edge cases and proposes changes; people accept or reject them. Everything keeps working with it disabled.`,
      },
      {
        id: "delivery",
        title: "Delivery with Linear-like simplicity",
        body: `Lictory includes native delivery for small and medium teams: configurable work item types, per-project workflow statuses, a board, a ranked backlog, manual sprints or automatic cycles, estimates, burndown, velocity and relations.

Teams that want to keep delivery in an external tool can hand off approved work to Jira Cloud today. **Publishing to Linear is coming**; until then, Linear teams can run delivery natively in Lictory or use Lictory for refinement and review alongside Linear.`,
      },
      {
        id: "when-linear",
        title: "When Linear is the better fit",
        body: `If your requirements are short, mostly owned by engineers and rarely disputed, the extra structure of reviews and approvals may be more than you need. Linear’s speed, keyboard-first interface and integrations make it an excellent tracker on its own.`,
      },
    ],
    faqs: [
      {
        question: "Can Lictory publish work to Linear?",
        answer:
          "Not yet. Publishing to Jira Cloud is available today and Linear support is coming. Meanwhile, teams can deliver natively in Lictory, which offers boards, backlog, sprints and cycles.",
      },
      {
        question: "Is Lictory as simple as Linear?",
        answer:
          "That is the goal for delivery: strong defaults, a small number of concepts and no configuration before first use. The review workflow adds structure only where agreement matters.",
      },
      {
        question: "Does Lictory replace product requirement documents?",
        answer:
          "Yes. The specification is the document, and it carries its own revisions, discussions, approvals and readiness, so there is no separate PRD to keep in sync.",
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
      "Plane and Lictory are both open-source work management you can run on your own servers, and both cover boards, cycles and estimates. They differ in what they treat as the core: Plane is a broad project tool with paid editions for governance; Lictory is built around reviewing and approving specifications before work starts, with everything in one MIT-licensed edition.",
    verdict: {
      lictory:
        "Choose Lictory when the expensive mistakes happen before development: unclear requirements, approvals nobody can trace, “ready” that was never proven. Everything is MIT licensed with no paid tier.",
      competitor:
        "Choose Plane when you want a broad project tool with Gantt timelines, time tracking, a hosted cloud option and an importer from Jira, and paid editions are acceptable for workflows, approvals and SSO.",
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

Lictory is narrower on purpose. Its core is the step before delivery: a **specification** changes through immutable **revisions**, reviewers comment on the **exact text**, suggested wording is **accepted or rejected**, **approvals belong to the revision** that was reviewed, and **readiness checks** prove the work can start. Boards, backlog, sprints, cycles and estimates are there for delivery, without Gantt charts or time tracking.`,
      },
      {
        id: "editions",
        title: "Open source, editions and what costs money",
        body: `Both are open source, under different terms:

- **Plane** publishes its Community Edition under **AGPL-3.0**. Plane says the Commercial Edition adds “governance and scale”: workflows, approvals, SSO, audit trails, work item types and more. On Plane Cloud, the free plan covers up to 12 users, and features such as the Wiki, time tracking and custom work item types start at paid plans.
- **Lictory** is **MIT licensed**, with one edition. Specification review, approvals, readiness checks, OpenID Connect sign-in, audit history and native delivery are all in the code you install. There is no hosted Lictory to pay for, and no paid tier.

The MIT license also matters if you plan to modify the code: it does not require you to publish changes, while AGPL-3.0 has obligations when a modified version is offered to users over a network.`,
      },
      {
        id: "self-hosting",
        title: "Self-hosting",
        body: `Plane supports Docker Compose, Kubernetes with Helm, Podman and one-click platforms such as Coolify and Portainer, and offers air-gapped deployments.

Lictory runs on **one Linux server with Docker Compose**. The \`lictory\` command installs a published release, checks the server, takes backups, upgrades and rolls back. PostgreSQL runs in a container by default, or you point Lictory at your own or a managed PostgreSQL. Lictory is only self-hosted: if you want a vendor to run it for you, Plane Cloud is the closer fit.`,
      },
      {
        id: "migration",
        title: "Coming from Jira",
        body: `Plane documents a Jira importer for Jira Cloud and Server/Data Center, available on Plane Cloud and the Commercial Edition for self-hosted instances.

Lictory has **no Jira importer** today. Teams usually keep Jira for delivery at first: a Lictory project set to external delivery refines and approves specifications, then hands the ready work off to **Jira Cloud** with a link back to the approved revision. Projects can move to native delivery later.`,
      },
      {
        id: "when-plane",
        title: "When Plane is the better fit",
        body: `Choose Plane if you need Gantt timelines, time tracking, intake forms, dashboards, a vendor-hosted cloud or an importer that brings Jira history across. Its scope is closer to a general project management suite, which is exactly what Lictory deliberately does not try to be.`,
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
          "Plane documents approvals as steps on work item state transitions, in its Enterprise Grid plan. We found no documented approval of pages or specification revisions. In Lictory, approvals belong to the revision that was reviewed and go stale when it changes materially.",
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
      "OpenProject is a mature open-source project management suite covering classic, agile and hybrid projects: Gantt charts, time and cost tracking, wikis, meetings and portfolios. Lictory covers far less ground on purpose, and goes deeper on one thing: getting a software specification reviewed, approved and proven ready before delivery starts.",
    verdict: {
      lictory:
        "Choose Lictory when you are a software team whose problem is agreeing on requirements: reviews on the exact text, approvals bound to a revision and readiness you can prove.",
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

Lictory is built for software teams and focuses on the requirements themselves. A specification has immutable **revisions** you can compare, **threads anchored to the exact text**, **suggestions** reviewers accept or reject, **approvals bound to a revision** and **readiness checks**. It then delivers with boards, backlog, sprints or cycles, estimates and relations, or hands the work off to Jira Cloud.`,
      },
      {
        id: "documents",
        title: "Reviewing requirements",
        body: `This is the largest difference. OpenProject's Documents module supports real-time co-editing, and its documentation states that there is no versioning of documents. Its public roadmap lists document workflows with approval steps and review cycles, inline comments and track changes as planned.

In Lictory, the review workflow is the product. Every change to a specification is a numbered revision. When Engineering approved revision 12 and the text is now revision 14, Lictory shows that Engineering's approval needs another review. A blocking discussion keeps the specification from being ready until it is resolved, and resolving it never deletes history.`,
      },
      {
        id: "scope",
        title: "Scope: a suite or a focused tool",
        body: `OpenProject covers classic, agile and hybrid project management, which suits organizations that plan schedules, track hours and costs, or run projects outside software.

Lictory deliberately stops short of that. It has no Gantt charts, time tracking, budgets, capacity planning or portfolio management, and it will not grow into them. If you need those, OpenProject is the better tool; Lictory is for software teams who need delivery essentials with Linear-like simplicity.`,
      },
      {
        id: "editions",
        title: "Licensing, editions and hosting",
        body: `OpenProject's Community edition is **GPL-3.0** and free. Enterprise plans, in OpenProject's cloud (hosted in the EU) or on-premises, are priced per user per month with minimum user counts and add further features. OpenProject installs with Docker Compose, DEB/RPM packages or Helm charts.

Lictory is **MIT licensed** and has a single edition with every feature. It is only self-hosted, on one Linux server with Docker Compose, and the \`lictory\` command handles installation, backups, upgrades and rollback.`,
      },
      {
        id: "migration",
        title: "Coming from Jira",
        body: `OpenProject offers a Jira migrator, currently in beta for Jira Data Center and not for Jira Cloud. Lictory has **no importer**; instead, a Lictory project can keep Jira Cloud for delivery and hand approved work off to it, so teams adopt Lictory for refinement without moving their tickets.`,
      },
    ],
    faqs: [
      {
        question:
          "Is OpenProject or Lictory better for requirements management?",
        answer:
          "For reviewing and approving software requirements, Lictory: specifications have revisions, anchored discussions, suggestions, revision-bound approvals and readiness checks. OpenProject's Documents module has no versioning today, and document approval workflows are on its roadmap.",
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
      "Taiga is a long-standing open-source agile tool with Scrum and Kanban, epics, a wiki and a friendly interface. Lictory covers the same everyday agile delivery and adds what Taiga leaves to user story descriptions and comments: reviewing, approving and proving that a specification is ready.",
    verdict: {
      lictory:
        "Choose Lictory when user stories are not enough: product, engineering and QA need to review the exact text, approve a specific revision and see readiness as evidence.",
      competitor:
        "Choose Taiga when you want a simple, proven Scrum or Kanban tool with a hosted option at a flat price, and requirements are settled in conversation rather than in review.",
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

Lictory covers similar delivery ground (a board, a ranked backlog, sprints or automatic cycles, estimates, burndown, velocity, epics and subtasks) and puts the specification at the center. Requirements are drafted, reviewed on the exact text, revised through accepted suggestions and approved per revision, and readiness checks show when a story can start.`,
      },
      {
        id: "requirements",
        title: "Where requirements live",
        body: `In Taiga, a requirement is the description of a user story or epic, plus its comments and wiki pages. That works well when the team mostly agrees.

In Lictory, the specification is reviewed like code. Engineering, QA, Security and other disciplines are asked to review it; their discussions attach to the sentence in question and can block readiness; approvals name the revision they cover and go stale when it changes materially. Important conclusions become durable **decisions** instead of staying buried in a thread.`,
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
        body: `If your team wants a straightforward Scrum or Kanban tool, likes Taiga's interface, needs custom fields, or prefers a hosted plan without per-user pricing, Taiga is a good choice, and the extra structure of reviews and approvals may be more than you need.`,
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

export function comparisonPath(item: Comparison) {
  return `/compare/${item.slug}`;
}
