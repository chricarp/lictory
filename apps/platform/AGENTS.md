# Platform app

## ui-sdk

Before using ui-sdk (`@ui-sdk/react`, `@ui-sdk/core`), follow the `ui-sdk` skill
if it is installed, and read `node_modules/@ui-sdk/react/docs/llms.txt`. To build
a new component, also search `node_modules/@ui-sdk/react/docs/core.md` by
heading, and read `rendering.md` next to it.

The workspace hoists dependencies, so these paths resolve from the repository
root. The default styles are imported once in `src/main.tsx`, before the app's
own CSS.

## Widgets

Every interactive widget is a ui-sdk component. Do not write `role=`,
`aria-checked`, `aria-selected`, roving `tabIndex` or arrow-key handlers for a
dialog, menu, tabs, radio group, switch, checkbox, listbox, combobox, tree,
toolbar or disclosure: use the component.

- Reach for `@lictory/ui/*` first (`button`, `input`, `dropdown-select`,
  `select`, `popover`, `menu`, `dialog`, `switch`, `checkbox`, `radio`,
  `segmented`, `tooltip`, `toast`). These carry Lictory's look and are shared
  with the website and the documentation.
- For anything else, compose `@ui-sdk/react/<component>` parts in place and
  style them with classes and state attributes (`data-checked:`, `data-open:`,
  `data-highlighted:`, `data-disabled:`).
- Popups mount under the body: pass `container={popupContainer()}` from
  `@lictory/ui/popup` to a popover, menu, select, combobox, dialog, tooltip or
  hover card root you compose yourself.
- ui-sdk's default stylesheet is themed, not fought: `packages/ui/src/ui-sdk.css`
  (imported by `src/app.css`) points its `--ui-*` tokens at the theme and
  resets the sizes it sets, as its styling guide asks. Parts that render
  `div`, `span` or `li` take any visible property their classes leave out from
  that themed default, so give them their background, border, radius and
  shadow explicitly when the design differs. No `!important`.
- A link that looks like a button is `<Button render={<Link href="…" />}>`,
  never a button inside a link.
- A plain native `<button>` with a click handler stays a native button.

Left hand-rolled on purpose: the Tiptap suggestion list at the caret (the
editor owns its keys), the pane resizer (pixel widths across components), the
Litto dock's phone sheet, and the row preview card in lists.
