// Shared parsing of Markdown specifications. Used by server readiness checks and
// by the client to render acceptance criteria as a checklist.

export const ACCEPTANCE_HEADING = "## Acceptance criteria";

const headingPattern = /^##\s+acceptance criteria\s*$/i;
const itemPattern = /^\s*(?:[-*+]|\d+\.)\s+(?:\[( |x|X)\]\s*)?(.+?)\s*$/;

export type Criterion = { text: string; checked: boolean; line: number };

export function parseAcceptanceCriteria(content: string): {
  criteria: Criterion[];
  headingLine: number | null;
  endLine: number;
} {
  const lines = content.split("\n");
  const headingLine = lines.findIndex((line) => headingPattern.test(line));
  if (headingLine === -1)
    return { criteria: [], headingLine: null, endLine: lines.length };
  const criteria: Criterion[] = [];
  let endLine = lines.length;
  for (let i = headingLine + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,6}\s/.test(line)) {
      endLine = i;
      break;
    }
    const match = itemPattern.exec(line);
    if (match)
      criteria.push({
        text: match[2]!,
        checked: match[1]?.toLowerCase() === "x",
        line: i,
      });
  }
  return { criteria, headingLine, endLine };
}

export function hasAcceptanceCriteria(content: string) {
  return parseAcceptanceCriteria(content).criteria.length > 0;
}

// Appends a criterion, creating the section when needed. Returns new content.
export function appendAcceptanceCriterion(content: string, text: string) {
  const line = `- [ ] ${text.trim()}`;
  const { headingLine, endLine } = parseAcceptanceCriteria(content);
  const lines = content.split("\n");
  if (headingLine === null) {
    const trimmed = content.replace(/\s+$/, "");
    return `${trimmed ? `${trimmed}\n\n` : ""}${ACCEPTANCE_HEADING}\n\n${line}\n`;
  }
  // Insert before trailing blank lines of the section.
  let insertAt = endLine;
  while (insertAt > headingLine + 1 && lines[insertAt - 1]!.trim() === "")
    insertAt--;
  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}

export function toggleAcceptanceCriterion(content: string, line: number) {
  const lines = content.split("\n");
  const target = lines[line];
  if (target === undefined) return content;
  lines[line] = target.includes("[ ]")
    ? target.replace("[ ]", "[x]")
    : /\[[xX]\]/.test(target)
      ? target.replace(/\[[xX]\]/, "[ ]")
      : target.replace(/^(\s*(?:[-*+]|\d+\.)\s+)/, "$1[x] ");
  return lines.join("\n");
}

// Splits the document into the narrative body and the acceptance criteria
// section so the UI can render criteria as a checklist beneath the body.
export function splitSpecification(content: string) {
  const { headingLine, endLine } = parseAcceptanceCriteria(content);
  if (headingLine === null) return { body: content, tail: "" };
  const lines = content.split("\n");
  return {
    body: lines.slice(0, headingLine).join("\n"),
    tail: lines.slice(endLine).join("\n"),
  };
}
