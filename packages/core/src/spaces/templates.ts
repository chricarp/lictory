import type { Command } from "@lictory/core/contracts/protocol";
import {
  canonicalizeDocument,
  type PageNode,
} from "@lictory/core/spaces/document/canonical";
import type {
  PageTemplateContext,
  PageTemplateKind,
} from "@lictory/core/spaces/template-catalog";

// Starting documents for new pages: small, opinionated structures built
// from ordinary blocks, with a live work list or a decision prompt where it
// helps. A template becomes the page's first version exactly like the empty
// document it replaces; everything in it is ordinary content people edit.

export {
  pageTemplateKinds,
  pageTemplates,
  type PageTemplateContext,
  type PageTemplateKind,
} from "@lictory/core/spaces/template-catalog";

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

// Sections start with a prompt, never an empty list: an empty bullet or
// task reads as a lone marker in the published page.
function content(kind: PageTemplateKind, context: PageTemplateContext): Node[] {
  switch (kind) {
    case "blank":
      return [p()];
    case "product-requirements":
      return [
        h(2, "Problem"),
        hint("Who has the problem, when, and what it costs them today."),
        h(2, "Goals"),
        hint("The outcomes that tell us this worked, as a list."),
        h(2, "Non-goals"),
        hint("What this deliberately does not cover."),
        h(2, "Requirements"),
        hint(
          "Describe the expected behavior, including failure cases. Select a requirement to create a work item from it.",
        ),
        h(2, "Open questions"),
        hint("Questions to settle before building, as tasks to tick off."),
        ...(context.epicId
          ? [h(2, "Delivery"), ...workList("epic-children", context)]
          : [h(2, "Related work"), ...workList("referenced", context)]),
      ];
    case "design-doc":
      return [
        h(2, "Context"),
        hint("What exists today and why it has to change."),
        h(2, "Proposal"),
        hint("How it will work: components, data and the main flows."),
        h(2, "Alternatives considered"),
        hint("Other approaches and why they were not chosen."),
        h(2, "Risks and failure behavior"),
        hint("What can go wrong, how it is detected and what happens then."),
        h(2, "Rollout"),
        hint("How it ships safely, and how it is turned off."),
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
        hint("Numbered steps, one action each, with the command to run."),
        h(2, "Verify"),
        hint("How to tell that it worked."),
        h(2, "Roll back"),
        hint("How to undo the steps if something goes wrong."),
        h(2, "Escalation"),
        hint("Who to contact when this runbook does not resolve it."),
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
        hint("Each option with its main trade-off."),
        h(2, "Consequences"),
        hint("What becomes easier or harder because of this decision."),
      ];
    case "retrospective":
      return [
        h(2, "What went well"),
        hint("What to keep doing."),
        h(2, "What did not go well"),
        hint("What slowed the team down or surprised it."),
        h(2, "What we learned"),
        hint("Lessons worth remembering next time."),
        h(2, "Actions"),
        hint(
          "Actions as tasks, each with an owner. Turn one into a work item once this page is published.",
        ),
        ...workList("iteration", context, "Work in the iteration"),
      ];
    case "iteration-notes":
      return [
        h(2, "Goal"),
        context.goal?.trim()
          ? p(context.goal.trim())
          : hint(
              "What this iteration should achieve, in one or two sentences.",
            ),
        ...(workList("iteration", context).length
          ? [h(2, "Work"), ...workList("iteration", context)]
          : []),
        h(2, "Risks"),
        hint(
          "What could keep the goal from being met, and what we do about it.",
        ),
        h(2, "Notes"),
        hint("Decisions, changes of scope and anything worth remembering."),
        h(2, "Retrospective"),
        h(3, "What went well"),
        hint("What to keep doing."),
        h(3, "What to change"),
        hint("What to try differently next iteration."),
        h(2, "Follow-ups"),
        hint("Follow-ups as tasks, each with an owner."),
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

/** The template as `createPage`'s `content`. */
export function templatePageContent(
  kind: PageTemplateKind,
  context: PageTemplateContext = {},
): CreatePageContent {
  return templateDocument(kind, context) as unknown as CreatePageContent;
}
type CreatePageContent = NonNullable<
  Extract<Command, { type: "createPage" }>["content"]
>;
