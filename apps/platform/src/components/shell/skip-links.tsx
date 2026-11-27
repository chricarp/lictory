import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// The skip links of the shell: hidden until focused, the first Tab stops of
// every page. "Skip to content" is always there; a page adds its own target
// (an item's specification) into the slot right after it, so a keyboard
// reviewer reaches the document without tabbing through the item list and
// the header.
const SLOT_ID = "page-skip-links";

export const skipLinkClass =
  "fixed top-2 left-2 z-[60] -translate-y-16 rounded-md bg-popover px-3 py-2 text-[13px] font-medium text-foreground shadow-(--shadow-panel) focus-ring outline-none focus:translate-y-0";

export function SkipLinkSlot() {
  return <div id={SLOT_ID} className="contents" />;
}

// The slot never moves: nothing to subscribe to.
const noSubscription = () => () => undefined;

export function PageSkipLink({
  label,
  target,
}: {
  label: string;
  // The element to focus, looked up when the link is used.
  target: () => HTMLElement | null | undefined;
}) {
  // The shell's slot, found once it is in the document (React checks the
  // snapshot again after mounting).
  const slot = useSyncExternalStore(
    noSubscription,
    () => document.getElementById(SLOT_ID),
    () => null,
  );
  if (!slot) return null;
  return createPortal(
    <a
      href="#main"
      onClick={(event) => {
        event.preventDefault();
        const element = target();
        if (!element) return;
        element.focus();
        element.scrollIntoView({ block: "start" });
      }}
      className={skipLinkClass}
    >
      {label}
    </a>,
    slot,
  );
}
