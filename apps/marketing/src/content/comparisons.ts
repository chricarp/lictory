// Public comparison pages (/compare/[slug]). Claims about other products are
// limited to their built-in capabilities as we understand them, matching the
// landing page comparison table. Keep the copy honest about where they fit better.

export type Comparison = {
  slug: "jira" | "linear";
  competitor: "Jira" | "Linear";
  /** Document title and search result headline. */
  title: string;
  description: string;
  /** Visible page heading. */
  headline: string;
  intro: string;
  /** One-line verdicts shown side by side near the top. */
  verdict: { lictory: string; competitor: string };
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
    updated: "2026-10-15",
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
];

export function comparison(slug: string) {
  return comparisons.find((item) => item.slug === slug);
}
