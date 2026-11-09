import type { Node as PMNode } from "@tiptap/pm/model";

// Deterministic wording hints for acceptance criteria: phrases a tester
// cannot turn into pass or fail without asking the author. They are advice
// shown while editing, never findings: they create no discussions,
// revisions or readiness results, and they work with AI off.
//
// The list is deliberately short. Generic word lists are noisy ("should",
// "all", "and/or", "some", or a retry described without its count are not
// defects in themselves), so only phrase families that were reliably
// problems in acceptance criteria are flagged, and the unmeasurable
// qualities only in criteria that state no number at all.

type WordingHintKind =
  "placeholder" | "open_list" | "escape_clause" | "unmeasurable";

type WordingHint = {
  kind: WordingHintKind;
  // Offsets in the criterion's text, end exclusive.
  from: number;
  to: number;
  phrase: string;
  message: string;
};

const families: {
  kind: WordingHintKind;
  pattern: RegExp;
  message: (phrase: string) => string;
}[] = [
  {
    kind: "placeholder",
    // Case-sensitive: "TBD" in a criterion is a gap, "tbd" rarely means it.
    pattern:
      /\b(?:TBD|TBC|TODO|FIXME)\b|\bto be (?:decided|defined|determined|confirmed|clarified)\b|\?{2,}/g,
    message: (p) =>
      `“${p}” marks something undecided: agree the value or ask the team before review.`,
  },
  {
    kind: "open_list",
    pattern: /(?<![/\w])etc\b\.?|\band so (?:on|forth)\b/gi,
    message: (p) =>
      `“${p}” leaves open which other cases count: name each one a tester should check.`,
  },
  {
    kind: "escape_clause",
    pattern:
      /\b(?:if|where|when) (?:possible|appropriate|applicable)\b|\bas (?:appropriate|applicable)\b|\bas soon as possible\b|\bASAP\b/gi,
    message: (p) =>
      `“${p}” lets the reader decide whether this applies: state the condition.`,
  },
  {
    kind: "unmeasurable",
    pattern:
      /\b(?:fast|quickly|intuitive(?:ly)?|user[- ]friendly|easy to use|seamless(?:ly)?|smoothly|performant|efficient(?:ly)?|robust|appropriate(?:ly)?|reasonabl[ey]|acceptable|adequate(?:ly)?|suitable|sufficiently|properly|gracefully|timely|as expected|best practices?)\b/gi,
    message: (p) =>
      `“${p}” can't pass or fail a test: state the expected value, limit or behavior.`,
  },
];

// Quoted text and inline code name things ("Fast checkout", `retry`); they
// are blanked out so offsets stay put.
const quoted = /"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|`[^`\n]*`/g;
const blank = (text: string) =>
  text.replace(quoted, (s) => " ".repeat(s.length));

// A criterion that states any number already says what it means ("an
// appropriate error (409)", "fast: p95 under 500 ms").
const hasNumber = /\d/;

const sentenceStart = (before: string) =>
  /^[\s\uFFFC]*$/.test(before) || /[.!?:;]\s*$/.test(before);

export function findWordingHints(text: string): WordingHint[] {
  const visible = blank(text);
  const hints: WordingHint[] = [];
  const taken = (from: number, to: number) =>
    hints.some((h) => from < h.to && h.from < to);
  for (const family of families) {
    if (family.kind === "unmeasurable" && hasNumber.test(text)) continue;
    family.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = family.pattern.exec(visible))) {
      const phrase = match[0];
      const from = match.index;
      const to = from + phrase.length;
      // Hyphenated compounds are other words ("fast-forward", "robust-mode").
      if (visible[from - 1] === "-" || visible[to] === "-") continue;
      // A capitalized word inside a sentence is a name ("the Fast lane").
      if (
        family.kind === "unmeasurable" &&
        /^[A-Z]/.test(phrase) &&
        !sentenceStart(visible.slice(0, from))
      )
        continue;
      // "If possible duplicates are found": "possible" describes the noun.
      if (
        family.kind === "escape_clause" &&
        /^(?:if|when|where) possible$/i.test(phrase) &&
        /^\s+[a-z]/.test(visible.slice(to)) &&
        !/^\s+(?:and|or|but|then|so|the|a|an|it|we|they|this|that|otherwise)\b/.test(
          visible.slice(to),
        )
      )
        continue;
      if (taken(from, to)) continue;
      hints.push({
        kind: family.kind,
        from,
        to,
        phrase,
        message: family.message(phrase),
      });
    }
  }
  return hints.sort((a, b) => a.from - b.from);
}

// The section the hints apply to, matched like readiness sections: by the
// heading's name at any level, up to the next heading of the same or a
// higher level.
const SECTION = "acceptance criteria";
const headingName = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/[:\s]+$/, "")
    .trim()
    .toLowerCase();

export type PlacedWordingHint = WordingHint & {
  // Document positions of the phrase.
  pos: number;
  end: number;
  // The criterion's text, which keys a dismissal: changing the criterion
  // shows its hints again.
  criterion: string;
};

// Text of a textblock with one placeholder character per document position
// that is not text (references, mentions, hard breaks), so string offsets
// map to positions by addition. Inline code is blanked.
function blockText(node: PMNode) {
  let text = "";
  node.forEach((child) => {
    if (child.isText) {
      const value = child.text ?? "";
      text += child.marks.some((m) => m.type.spec.code)
        ? " ".repeat(value.length)
        : value;
    } else text += "￼".repeat(child.nodeSize);
  });
  return text;
}

// Untouched nodes are reused by ProseMirror across transactions, so a
// keystroke re-reads only the block it changed.
const cache = new WeakMap<PMNode, { text: string; hints: WordingHint[] }>();
function hintsOf(node: PMNode) {
  let entry = cache.get(node);
  if (!entry) {
    const text = blockText(node);
    entry = { text, hints: /\S/.test(text) ? findWordingHints(text) : [] };
    cache.set(node, entry);
  }
  return entry;
}

export function wordingHintsInDocument(doc: PMNode): PlacedWordingHint[] {
  const placed: PlacedWordingHint[] = [];
  let level: number | undefined;
  doc.forEach((block, offset) => {
    if (block.type.name === "heading") {
      const depth = Number(block.attrs.level ?? 1);
      if (level !== undefined && depth <= level) level = undefined;
      if (level === undefined && headingName(block.textContent) === SECTION)
        level = depth;
      return;
    }
    if (level === undefined) return;
    const place = (node: PMNode, start: number) => {
      const { text, hints } = hintsOf(node);
      for (const hint of hints)
        placed.push({
          ...hint,
          pos: start + hint.from,
          end: start + hint.to,
          criterion: text,
        });
    };
    if (block.isTextblock) {
      if (!block.type.spec.code) place(block, offset + 1);
      return;
    }
    block.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      if (node.type.spec.code) return false;
      // +1: the block's opening token; +1: the textblock's own.
      place(node, offset + 1 + pos + 1);
      return false;
    });
  });
  return placed;
}
