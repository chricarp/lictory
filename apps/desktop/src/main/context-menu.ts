import {
  clipboard,
  Menu,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { isSafeExternalUrl } from "../shared/urls";

// Electron shows no context menu by itself. This one offers what a browser
// would: spelling suggestions, the edit commands that apply, and for links
// opening them in the browser or copying them.
export function attachContextMenu(
  contents: WebContents,
  options: { isDev: boolean; openExternal(url: string): void },
) {
  contents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5))
        items.push({
          label: suggestion,
          click: () => contents.replaceMisspelling(suggestion),
        });
      if (!params.dictionarySuggestions.length)
        items.push({ label: "No suggestions", enabled: false });
      items.push(
        {
          label: "Add to dictionary",
          click: () =>
            contents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord,
            ),
        },
        { type: "separator" },
      );
    }
    if (params.linkURL && isSafeExternalUrl(params.linkURL)) {
      items.push(
        {
          label: "Open link in browser",
          click: () => options.openExternal(params.linkURL),
        },
        {
          label: "Copy link",
          click: () => void clipboard.writeText(params.linkURL),
        },
        { type: "separator" },
      );
    }
    const flags = params.editFlags;
    if (params.isEditable)
      items.push(
        { role: "undo", enabled: flags.canUndo },
        { role: "redo", enabled: flags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: flags.canCut },
        { role: "copy", enabled: flags.canCopy },
        { role: "paste", enabled: flags.canPaste },
        { role: "pasteAndMatchStyle", enabled: flags.canPaste },
        { role: "selectAll", enabled: flags.canSelectAll },
      );
    else if (params.selectionText.trim())
      items.push({ role: "copy", enabled: flags.canCopy });
    if (params.mediaType === "image" && params.hasImageContents)
      items.push({
        label: "Copy image",
        click: () => contents.copyImageAt(params.x, params.y),
      });
    if (options.isDev)
      items.push(
        { type: "separator" },
        {
          label: "Inspect element",
          click: () => contents.inspectElement(params.x, params.y),
        },
      );
    // Drop leading, trailing and doubled separators.
    const cleaned = items.filter(
      (item, i, all) =>
        item.type !== "separator" ||
        (i > 0 && i < all.length - 1 && all[i - 1]?.type !== "separator"),
    );
    if (cleaned.length) Menu.buildFromTemplate(cleaned).popup();
  });
}
