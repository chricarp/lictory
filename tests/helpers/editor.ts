import { expect, type Locator, type Page } from "@playwright/test";

// Markdown fields are rich editors (components/editor). Comment composers
// load theirs when focused; until then a plain field stands in. These
// helpers wait for the rich editor and drive it like a person: pasting
// Markdown (which the editor reads as Markdown), typing, and reading the
// stored Markdown back through "Edit as Markdown".

type Scope = Page | Locator;

/** The rich editor named `name`, loaded and ready. */
export async function richEditor(scope: Scope, name: string) {
  const field = scope.getByRole("textbox", { name, exact: true }).first();
  await field.focus();
  const editor = scope.locator(
    `[data-markdown-editor][aria-label="${name}"][contenteditable="true"]`,
  );
  await expect(editor).toBeVisible();
  return editor;
}

/** Replaces the editor's content with `markdown`, as a paste would. */
export async function fillMarkdown(
  scope: Scope,
  name: string,
  markdown: string,
) {
  const editor = await richEditor(scope, name);
  await editor.click();
  await editor.press("ControlOrMeta+a");
  if (!markdown) {
    await editor.press("Backspace");
    return editor;
  }
  await editor.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, markdown);
  return editor;
}

/** The Markdown the editor holds (via "Edit as Markdown" and back). */
export async function markdownOf(scope: Scope, name: string) {
  await richEditor(scope, name);
  const toolbar = scope.getByRole("toolbar", { name: `${name} formatting` });
  await toolbar.getByRole("button", { name: "Edit as Markdown" }).click();
  const source = scope.getByRole("textbox", {
    name: `${name} (Markdown)`,
    exact: true,
  });
  const value = await source.inputValue();
  await toolbar.getByRole("button", { name: "Edit formatted text" }).click();
  return value;
}

/** Waits until the editor holds exactly `markdown`. */
export async function expectMarkdown(
  scope: Scope,
  name: string,
  markdown: string,
) {
  await expect.poll(() => markdownOf(scope, name)).toBe(markdown);
}

/** Selects the first occurrence of `text` inside the editor. */
export async function selectText(editor: Locator, text: string) {
  await editor.click();
  await editor.evaluate((element, wanted) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent?.indexOf(wanted) ?? -1;
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + wanted.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`"${wanted}" is not in the editor.`);
  }, text);
}
