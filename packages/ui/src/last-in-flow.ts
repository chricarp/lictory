// ui-sdk form controls render a hidden native input right after themselves.
// A container that spaces its children with margins (`space-y-*`,
// `space-x-*`) then no longer sees the control as its last child and adds a
// trailing margin; this drops it when only that hidden input follows.
export const lastInFlow =
  "[&:has(+input[aria-hidden=true]:last-child)]:mb-0 [&:has(+input[aria-hidden=true]:last-child)]:me-0";
