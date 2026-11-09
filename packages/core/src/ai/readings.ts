import type { Nodes } from "mdast";
import {
  normalizeQuote,
  occurrenceIn,
  parseMarkdownTree,
  sameHeading,
  textModel,
  type TextModel,
} from "@lictory/core/editor/markdown-text";
import {
  aiFindingSchema,
  type AiFinding,
  type AiReadings,
  type AiSeverity,
} from "@lictory/core/contracts/ai";

// Two readings of acceptance criteria: for each criterion a pull request
// adds or changes, the review model writes how QA would test it and what an
// implementer would build. Only a difference in observable behaviour becomes
// a finding. One model writes both readings, so a divergence shows possible
// ambiguity in the text, not two independent people disagreeing.

const CRITERIA_HEADING = "Acceptance criteria";
// Bounded like the rest of the context: the first criteria are read.
const MAX_CRITERIA = 20;
const MAX_CRITERION = 1000;
const MAX_CASES = 6;
// The heaviest severity a divergence can carry, so turning the review on
// under the `required` policy never starts blocking merges by itself.
const SEVERITY_CAP: AiSeverity = "major";

export type Criterion = {
  ref: string;
  // The criterion as a reader sees it rendered (what discussions quote).
  text: string;
  // Where a discussion anchors: the section heading and which copy of the
  // text under it this criterion is.
  section: string;
  occurrence: number;
};

// Criteria are the list items (each nested item on its own) or, without any
// list, the paragraphs under the first "Acceptance criteria" heading, up to
// the next heading of the same or a higher level. Their text and position
// come from the same text model the reader uses to place discussions.
export function acceptanceCriteria(content: string): Omit<Criterion, "ref">[] {
  const tree = parseMarkdownTree(content);
  const model = textModel(tree);
  const textIn = (nodes: Nodes[]) => {
    const range = rangeOf(model, nodes);
    return range ? model.text.slice(range.from, range.to) : "";
  };
  const start = tree.children.findIndex(
    (n) => n.type === "heading" && sameHeading(textIn([n]), CRITERIA_HEADING),
  );
  if (start < 0) return [];
  const heading = tree.children[start] as Extract<Nodes, { type: "heading" }>;
  // Subsections belong to the section, as in readiness checks; a discussion
  // anchors under the nearest heading, which is how the reader places it.
  let under = { text: textIn([heading]), end: rangeOf(model, [heading])!.to };
  const blocks: { nodes: Nodes[]; section: typeof under }[] = [];
  const items = (node: Nodes) => {
    if (node.type !== "list") return;
    for (const item of node.children) {
      blocks.push({
        nodes: item.children.filter((c) => c.type !== "list"),
        section: under,
      });
      for (const nested of item.children) items(nested);
    }
  };
  let paragraphs: typeof blocks = [];
  let listed = false;
  for (const node of tree.children.slice(start + 1)) {
    if (node.type === "heading") {
      if (node.depth <= heading.depth) break;
      under = { text: textIn([node]), end: rangeOf(model, [node])?.to ?? 0 };
    } else if (node.type === "list") {
      listed = true;
      items(node);
    } else if (node.type === "paragraph")
      paragraphs.push({ nodes: [node], section: under });
  }
  // Paragraphs count only when the section has no list at all.
  if (listed) paragraphs = [];
  return [...blocks, ...paragraphs].flatMap(({ nodes, section }) => {
    const range = rangeOf(model, nodes);
    if (!range) return [];
    const text = model.text.slice(range.from, range.to).trim();
    if (!text || text.length > MAX_CRITERION) return [];
    // Which copy of this text under its heading it is, counted the way the
    // reader places quotes.
    const occurrence = occurrenceIn(
      model.text.slice(section.end, range.to),
      text,
    );
    return [{ text, section: section.text, occurrence }];
  });
}

// Where the text of these nodes is in the document's text model.
function rangeOf(model: TextModel, nodes: Nodes[]) {
  const own = new Set<Nodes>();
  const walk = (node: Nodes) => {
    own.add(node);
    if ("children" in node) for (const c of node.children as Nodes[]) walk(c);
  };
  nodes.forEach(walk);
  const hits = model.segments.filter((s) => own.has(s.node));
  if (!hits.length) return undefined;
  return {
    from: Math.min(...hits.map((s) => s.start)),
    to: Math.max(...hits.map((s) => s.end)),
  };
}

const same = (a: string, b: string) => normalizeQuote(a) === normalizeQuote(b);

// The criteria a pull request asks about: those its head adds or rewords
// against the merge base, and those an open two-readings discussion is still
// about (so a re-run can say whether it still diverges).
export function criteriaToRead(
  base: string,
  head: string,
  open: string[] = [],
): { criteria: Criterion[]; truncated: boolean } {
  const before = acceptanceCriteria(base).map((c) => c.text);
  const wanted = acceptanceCriteria(head).filter(
    (c) =>
      !before.some((b) => same(b, c.text)) || open.some((o) => same(o, c.text)),
  );
  return {
    criteria: wanted
      .slice(0, MAX_CRITERIA)
      .map((c, i) => ({ ref: `A${i + 1}`, ...c })),
    truncated: wanted.length > MAX_CRITERIA,
  };
}

// What the model returns for one criterion (see analyzer.ts).
export type ModelReading = {
  criterionRef: string;
  qa: { situation: string; expected: string }[];
  implementer: { builds: string; done: string };
  diverges: boolean;
  divergence: string | null;
  question: string | null;
  severity: string;
  previousFindingId: string | null;
};

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const order: AiSeverity[] = ["info", "minor", "major", "blocker"];
const capped = (severity: string): AiSeverity => {
  const wanted = order.includes(severity as AiSeverity)
    ? (severity as AiSeverity)
    : SEVERITY_CAP;
  return order.indexOf(wanted) > order.indexOf(SEVERITY_CAP)
    ? SEVERITY_CAP
    : wanted;
};

// Model output is untrusted. A reading becomes a finding only when it names
// a criterion that was sent, says the readings diverge and explains how, and
// carries both readings. Everything else is dropped; `read` counts the
// criteria the model gave a usable reading for, divergent or not.
export function normalizeReadings(
  output: ModelReading[],
  criteria: Criterion[],
  input: {
    workItemId: string;
    firstId: number;
    max: number;
    previous?: Map<string, string>;
  },
): { findings: AiFinding[]; anchors: Map<string, Criterion>; read: number } {
  const findings: AiFinding[] = [];
  const anchors = new Map<string, Criterion>();
  const used = new Set<string>();
  for (const r of output) {
    const criterion = criteria.find(
      (c) => c.ref === r.criterionRef.trim().toUpperCase(),
    );
    if (!criterion || used.has(criterion.ref)) continue;
    const qa = r.qa
      .map((c) => ({
        situation: cut(c.situation.trim(), 500),
        expected: cut(c.expected.trim(), 500),
      }))
      .filter((c) => c.situation && c.expected)
      .slice(0, MAX_CASES);
    const builds = r.implementer.builds.trim();
    const done = r.implementer.done.trim();
    if (!qa.length || !builds || !done) continue;
    used.add(criterion.ref);
    const divergence = r.divergence?.trim();
    if (!r.diverges || !divergence || findings.length >= input.max) continue;
    const readings: AiReadings = {
      criterion: criterion.text,
      qa,
      implementer: { builds: cut(builds, 1000), done: cut(done, 1000) },
      divergence: cut(divergence, 2000),
    };
    const parsed = aiFindingSchema.safeParse({
      id: `f${input.firstId + findings.length}`,
      workItemId: input.workItemId,
      kind: "question",
      category: "ambiguity",
      severity: capped(r.severity),
      title: cut(
        `QA and an implementer would read “${criterion.text}” differently`,
        300,
      ),
      detail: readings.divergence,
      evidence: [criterion.text],
      question: r.question?.trim()
        ? cut(r.question.trim(), 1000)
        : "Which reading is intended?",
      recommendation:
        "State the expected outcome for this case in the criterion, so a tester and an implementer reach the same result.",
      edit: null,
      threadId: null,
      context: [],
      readings,
    });
    if (!parsed.success) continue;
    findings.push(parsed.data);
    anchors.set(parsed.data.id, criterion);
    if (input.previous && r.previousFindingId)
      input.previous.set(parsed.data.id, r.previousFindingId);
  }
  return { findings, anchors, read: used.size };
}

// The discussion body: both readings in full, so people can judge the
// divergence themselves instead of trusting it.
export function renderReadings(r: AiReadings) {
  return [
    "**QA would test**",
    ...r.qa.map((c) => `- ${c.situation} → ${c.expected}`),
    "",
    "**An implementer would build**",
    "",
    r.implementer.builds,
    "",
    `**…and call it done when** ${r.implementer.done}`,
    "",
    "_Both readings come from one model reading the specification twice. A divergence points to possibly ambiguous text, not to two people disagreeing._",
  ].join("\n");
}
