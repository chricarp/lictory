// Markdown split into blocks that render on their own, so a streaming reply
// only parses again the block that is still growing.

// Blocks end at a blank line outside a fenced code block, unless the next
// line is indented (it continues a list item or a paragraph).
export function splitBlocks(source: string): string[] {
  // Reference links and footnotes resolve across the whole document: keep
  // such a document whole rather than change what it means.
  if (/^ {0,3}\[[^\]]+\]:/m.test(source)) return source.trim() ? [source] : [];
  const lines = source.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0]!.repeat(marker.length);
      else if (marker.startsWith(fence)) fence = null;
    }
    current.push(line);
    if (fence || line.trim() !== "") continue;
    const next = lines.slice(i + 1).find((l) => l.trim() !== "");
    if (next === undefined || /^\s/.test(next)) continue;
    // A table or list that continues after the blank line stays one block.
    // A list continues through its items' paragraphs: the block stays open
    // while the next line is another item of a list this block holds.
    const listItem = /^\s*([-*+]|\d+[.)])\s/;
    if (listItem.test(next) && current.some((l) => listItem.test(l))) continue;
    blocks.push(current.join("\n"));
    current = [];
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks.filter((b) => b.trim() !== "");
}

// The block still streaming, made readable: open inline code, bold,
// emphasis and strikethrough are closed innermost first, an unclosed fence
// is closed, and a link whose target has not arrived yet is held back, so
// `**Issuer` never shows its asterisks. Finished text renders as written.
export function closeUnfinished(block: string): string {
  const fences = block.match(/^ {0,3}(`{3,}|~{3,})/gm)?.length ?? 0;
  if (fences % 2 === 1)
    return `${block}\n${/^ {0,3}~{3,}/m.test(block) ? "~~~" : "```"}`;
  // A link or image still being written: `[text` or `[text](http…`.
  let text = block.replace(/!?\[[^\]\n]*(\]\([^)\s]*)?$/, "");
  const open: string[] = [];
  const word = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const top = open.at(-1);
    if (c === "`") {
      // A code span opens and closes with a run of the same length.
      let run = 1;
      while (text[i + run] === "`") run++;
      const ticks = "`".repeat(run);
      if (top?.startsWith("`")) {
        if (top === ticks) open.pop();
      } else open.push(ticks);
      i += run - 1;
      continue;
    }
    if (top?.startsWith("`")) continue;
    if (c === "\\") {
      i++;
      continue;
    }
    const pair = text.slice(i, i + 2);
    if (pair === "__") {
      // Underscores (CommonMark): no opening after a letter, no closing
      // before one, so dunder__names__ stay text.
      if (top === pair && !word(text[i + 2])) open.pop();
      else if (!word(text[i - 1]) && !/\s/.test(text[i + 2] ?? " "))
        open.push(pair);
      i++;
      continue;
    }
    if (pair === "**" || pair === "~~") {
      if (top === pair) open.pop();
      else open.push(pair);
      i++;
      continue;
    }
    if (c === "*" || c === "_") {
      const before = text[i - 1];
      const after = text[i + 1];
      // A list bullet, a spaced operator or an underscore inside a word
      // (snake_case) is not emphasis.
      const lineStart = before === undefined || before === "\n";
      if (c === "*" && lineStart && after === " ") continue;
      if (/\s/.test(after ?? " ") && /\s/.test(before ?? " ")) continue;
      if (c === "_") {
        if (top === c && !word(after)) open.pop();
        else if (!word(before) && !/\s/.test(after ?? " ")) open.push(c);
        continue;
      }
      if (top === c) open.pop();
      else if (!/\s/.test(after ?? " ")) open.push(c);
    }
  }
  // A delimiter that only just opened (nothing after it yet) is dropped
  // rather than closed into an empty pair.
  let closing = "";
  while (open.length) {
    const last = open.pop()!;
    if (!closing && text.endsWith(last)) text = text.slice(0, -last.length);
    else closing += last;
  }
  text += closing;
  return text;
}
