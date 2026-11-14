// Popups mount under the document body, not beside their trigger: rows hide
// their actions with `visibility`, lists space children with margins, and a
// popup left in place would inherit both.
export const popupContainer = () =>
  typeof document === "undefined" ? undefined : document.body;
