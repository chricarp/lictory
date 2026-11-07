// The page templates people choose from (names and what each starts with),
// without the document engine: the "New page" dialog shows them, and builds
// the chosen document with `templateDocument` (./templates) on demand.

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
    description:
      "Goal, the iteration's live work list, risks, notes and a short retrospective.",
  },
};

// What the template can point its live work list at.
export type PageTemplateContext = {
  projectId?: string | null;
  iterationId?: string | null;
  epicId?: string | null;
  /** The iteration's goal, written into iteration notes when it has one. */
  goal?: string | null;
};
