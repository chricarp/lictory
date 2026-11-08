// Keys whose meaning depends on the platform the browser runs on, which is
// the test runner's (Playwright drives a local browser). "ControlOrMeta"
// covers shortcuts such as ⌘K / Ctrl+K, but not caret movement: on macOS,
// End scrolls the page and ⌘End does nothing; ⌘→ ends the line and ⌘↓ the
// document. Linux and Windows use End and Ctrl+End.
const mac = process.platform === "darwin";

/** Moves the caret to the end of its line. */
export const lineEnd = mac ? "Meta+ArrowRight" : "End";

/** Moves the caret to the end of the field or editor. */
export const documentEnd = mac ? "Meta+ArrowDown" : "Control+End";
