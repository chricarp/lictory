// Selecting text in a read-only document from the keyboard, so a passage
// can be anchored (commented on, suggested, asked about) without a pointer
// or the browser's caret browsing. The reader is one tab stop; inside it
// a selected word stands for the cursor:
//
// - Arrow Left/Right move to the previous or next word, Arrow Up/Down to
//   the line above or below; Home/End to the start or end of the line.
// - Shift with those keys extends the selection (by word, line or to the
//   line's edge).
// - Escape clears the selection.
//
// The selection is the browser's own, so everything that reads a mouse
// selection (the selection actions, Mod+Alt+M) reads this one too.
// See docs/internals/accessibility.md.

type Direction = "forward" | "backward";
type Unit = "word" | "line" | "lineboundary";

const keys: Record<string, { direction: Direction; unit: Unit }> = {
  ArrowRight: { direction: "forward", unit: "word" },
  ArrowLeft: { direction: "backward", unit: "word" },
  ArrowDown: { direction: "forward", unit: "line" },
  ArrowUp: { direction: "backward", unit: "line" },
  End: { direction: "forward", unit: "lineboundary" },
  Home: { direction: "backward", unit: "lineboundary" },
};

// Comments on the selected text, in readers and editors alike.
export const commentShortcut =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘⌥M"
    : "Ctrl+Alt+M";

export const keyboardSelectionHint =
  "Arrow keys select a word to start from, Shift with arrow keys extends the selection, Escape clears it.";

// Controls inside the reader (its selection actions) are not text to
// select.
const skipped = "[data-selection-skip]";

const inText = (root: HTMLElement, node: Node | null) =>
  !!node &&
  root.contains(node) &&
  !(node instanceof Element ? node : node.parentElement)?.closest(skipped);

function within(root: HTMLElement, selection: Selection) {
  return (
    selection.rangeCount > 0 &&
    inText(root, selection.anchorNode) &&
    inText(root, selection.focusNode)
  );
}

// The first word of the text inside `root` (skipping controls and anything
// hidden from reading), as the starting point.
function selectFirstWord(root: HTMLElement, selection: Selection) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.textContent?.trim() &&
      !node.parentElement?.closest(
        `button, [aria-hidden=true], [contenteditable=true], ${skipped}`,
      )
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
  });
  const text = walker.nextNode();
  if (!text) return false;
  const offset = text.textContent!.search(/\S/);
  selection.collapse(text, Math.max(0, offset));
  selection.modify("extend", "forward", "word");
  return true;
}

// Handles a key pressed while `root` itself has focus. Returns whether it
// changed the selection (the caller then prevents the default and reads
// the new selection).
export function keyboardSelect(
  root: HTMLElement,
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "target"
  >,
): boolean {
  if (event.target !== root) return false;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  const selection = window.getSelection();
  if (!selection || typeof selection.modify !== "function") return false;
  if (event.key === "Escape") {
    if (!within(root, selection) || selection.isCollapsed) return false;
    selection.removeAllRanges();
    return true;
  }
  const move = keys[event.key];
  if (!move) return false;
  if (!within(root, selection)) return selectFirstWord(root, selection);
  const { direction, unit } = move;
  const before = selection.getRangeAt(0).cloneRange();
  const backwards =
    selection.anchorNode !== before.startContainer ||
    selection.anchorOffset !== before.startOffset;
  // Never leave the reader: at its edges the selection stays as it was.
  const keepInside = () => {
    if (within(root, selection)) return;
    selection.removeAllRanges();
    selection.addRange(before);
    if (backwards) {
      selection.collapseToEnd();
      selection.extend(before.startContainer, before.startOffset);
    }
  };
  if (event.shiftKey) {
    selection.modify("extend", direction, unit);
    keepInside();
    return true;
  }
  // Without Shift the selected word moves: collapse to the side the key
  // points at, move, then select the word reached.
  if (direction === "forward") selection.collapseToEnd();
  else selection.collapseToStart();
  selection.modify("move", direction, unit);
  if (unit === "word" && direction === "forward") {
    selection.modify("move", "backward", "word");
    selection.modify("extend", "forward", "word");
  } else if (unit === "word") {
    selection.modify("extend", "forward", "word");
  } else if (unit === "lineboundary" && direction === "forward") {
    // The end of the line: its last word.
    selection.modify("move", "backward", "word");
    selection.modify("extend", "forward", "word");
  } else {
    // The line above or below, or the start of the line: the word at the
    // new position (to its end and back finds its start, also mid-word).
    selection.modify("move", "forward", "word");
    selection.modify("move", "backward", "word");
    selection.modify("extend", "forward", "word");
  }
  keepInside();
  return true;
}
