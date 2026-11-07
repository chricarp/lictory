import {
  canonicalizeDocument,
  type PageNode,
} from "@lictory/core/spaces/document/canonical";

// Starting documents for new pages: small, opinionated structures built
// from ordinary blocks, with a live work list or a decision prompt where it
// helps. A template becomes the page's first version exactly like the empty
// document it replaces; everything in it is ordinary content people edit.

export const pageTemplateKinds = [
  "blank",
  "product-requirements",
  "design-doc",
  "runbook",
  "decision-record",
  "retrospective",
  "iteration-notes",
] as const;
export type PageTemplateKind = (typeof pageTemplateKinds)[number];

export const pageTemplates: Record<
  PageTemplateKind,
  { name: string; description: string }
> = {
  blank: { name: "Blank", description: "An empty page." },
  "product-requirements": {
    name: "Product requirements",
    description: "Problem, goals, scope, requirements and open questions.",
  },
  "design-doc": {
    name: "Design doc",
    description: "Context, proposal, alternatives, risks and decisions.",
  },
  runbook: {
    name: "Runbook",
    description: "When to use it, steps, verification, rollback, escalation.",
  },
  "decision-record": {
    name: "Decision record",
    description: "Context, the decision, options considered, consequences.",
  },
  retrospective: {
    name: "Retrospective",
    description: "What went well, what did not, and actions to take.",
  },
  "iteration-notes": {
    name: "Iteration notes",
    description: "Goal, the iteration's live work list, notes and demo.",
  },
};

// What the template can point its live work list at.
export type PageTemplateContext = {
  projectId?: string | null;
  iterationId?: string | null;
  epicId?: string | null;
};

type Node = PageNode;
const text = (value: string): Node[] =>
  value ? [{ type: "text", text: value }] : [];
const h = (level: 1 | 2 | 3, value: string): Node => ({
  type: "heading",
  attrs: { level },
  content: text(value),
});
const p = (value = ""): Node =>
  value ? { type: "paragraph", content: text(value) } : { type: "paragraph" };
// A prompt the author replaces: italic, so it reads as guidance.
const hint = (value: string): Node => ({
  type: "paragraph",
  content: [{ type: "text", text: value, marks: [{ type: "italic" }] }],
});
const bullets = (...values: string[]): Node => ({
  type: "bulletList",
  content: values.map((v) => ({ type: "listItem", content: [p(v)] })),
});
const steps = (...values: string[]): Node => ({
  type: "orderedList",
  attrs: { start: 1 },
  content: values.map((v) => ({ type: "listItem", content: [p(v)] })),
});
const tasks = (...values: string[]): Node => ({
  type: "taskList",
  content: values.map((v) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [p(v)],
  })),
});
const workList = (
  filter: "epic-children" | "iteration" | "referenced",
  context: PageTemplateContext,
  title?: string,
): Node[] => {
  const filterId =
    filter === "epic-children"
      ? context.epicId
      : filter === "iteration"
        ? context.iterationId
        : null;
  if (filter !== "referenced" && (!filterId || !context.projectId)) return [];
  return [
    {
      type: "workList",
      attrs: {
        projectId: context.projectId ?? null,
        filter,
        filterId: filterId ?? null,
        title: title ?? null,
      },
    },
  ];
};

function content(kind: PageTemplateKind, context: PageTemplateContext): Node[] {
  switch (kind) {
    case "blank":
      return [p()];
    case "product-requirements":
      return [
        h(2, "Problem"),
        hint("Who has the problem, when, and what it costs them today."),
        h(2, "Goals"),
        bullets(""),
        h(2, "Non-goals"),
        bullets(""),
        h(2, "Requirements"),
        hint(
          "Describe the expected behavior, including failure cases. Select a requirement to create a work item from it.",
        ),
        bullets(""),
        h(2, "Open questions"),
        tasks(""),
        ...(context.epicId
          ? [h(2, "Delivery"), ...workList("epic-children", context)]
          : [h(2, "Related work"), ...workList("referenced", context)]),
      ];
    case "design-doc":
      return [
        h(2, "Context"),
        hint("What exists today and why it has to change."),
        h(2, "Proposal"),
        p(),
        h(2, "Alternatives considered"),
        bullets(""),
        h(2, "Risks and failure behavior"),
        bullets(""),
        h(2, "Rollout"),
        p(),
        h(2, "Decisions"),
        hint("Type / and choose Decision to show a recorded decision here."),
        ...workList("referenced", context, "Related work"),
      ];
    case "runbook":
      return [
        h(2, "When to use this runbook"),
        hint("The alert, symptom or request that leads here."),
        h(2, "Before you start"),
        tasks("Access you need", "Who to tell"),
        h(2, "Steps"),
        steps(""),
        h(2, "Verify"),
        bullets(""),
        h(2, "Roll back"),
        steps(""),
        h(2, "Escalation"),
        p(),
      ];
    case "decision-record":
      return [
        h(2, "Status"),
        p("Proposed"),
        h(2, "Context"),
        hint("The forces at play and the question to decide."),
        h(2, "Decision"),
        hint(
          "What we decided. Type / and choose Decision to cite a decision recorded on a work item.",
        ),
        h(2, "Options considered"),
        bullets(""),
        h(2, "Consequences"),
        bullets(""),
      ];
    case "retrospective":
      return [
        h(2, "What went well"),
        bullets(""),
        h(2, "What did not go well"),
        bullets(""),
        h(2, "What we learned"),
        bullets(""),
        h(2, "Actions"),
        hint("Turn an action into a work item once this page is published."),
        tasks(""),
        ...workList("iteration", context, "Work in the iteration"),
      ];
    case "iteration-notes":
      return [
        h(2, "Goal"),
        hint("What this iteration should achieve, in one or two sentences."),
        ...(workList("iteration", context).length
          ? [h(2, "Work"), ...workList("iteration", context)]
          : []),
        h(2, "Notes"),
        bullets(""),
        h(2, "Demo"),
        bullets(""),
        h(2, "Follow-ups"),
        tasks(""),
      ];
  }
}

/**
 * The canonical starting document of a template. `context` points live work
 * lists at a project's epic or iteration; without it they are left out
 * (the "referenced" list needs none).
 */
export function templateDocument(
  kind: PageTemplateKind,
  context: PageTemplateContext = {},
): PageNode {
  return canonicalizeDocument({ type: "doc", content: content(kind, context) });
}
