// One line of a unified diff as a review shows it: what kind of line it is
// and its number in the old and the new file, read from the hunk headers
// (`@@ -12,4 +12,6 @@`). Context lines carry both numbers, additions only the
// new one, deletions only the old one, and headers neither.
export type PatchLine = {
  kind: "hunk" | "add" | "delete" | "context" | "note";
  text: string;
  old?: number;
  new?: number;
};

const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function numberPatch(patch: string): PatchLine[] {
  let old = 0;
  let next = 0;
  return patch.split("\n").map((text): PatchLine => {
    const hunk = hunkHeader.exec(text);
    if (hunk) {
      old = Number(hunk[1]);
      next = Number(hunk[2]);
      return { kind: "hunk", text };
    }
    // "\ No newline at end of file" belongs to the line above it.
    if (text.startsWith("\\")) return { kind: "note", text };
    if (text.startsWith("+")) return { kind: "add", text, new: next++ };
    if (text.startsWith("-")) return { kind: "delete", text, old: old++ };
    return { kind: "context", text, old: old++, new: next++ };
  });
}
