// ui-sdk names some parts from another part (a menu from its trigger, a list
// from its search field, whose name is then the text typed in it) and keeps
// that reference when the part is given an `aria-label`. Passed as `render`,
// this drops the reference so the label is the part's name.
export const ownName = (props: Record<string, unknown>) => (
  <div {...props} aria-labelledby={undefined} />
);
