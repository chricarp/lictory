// A search result opens a page at the block that matched: `#block-<id>` in
// the address names the block (its `data-id` in the rendered document). The
// reader scrolls it into view and marks it briefly, once per navigation, so
// a later re-render (a new version arriving) never yanks the reader back.

const revealed = new Set<string>();

export function revealBlockFromHash(root: HTMLElement | null) {
  if (!root || typeof window === "undefined") return;
  const match = /^#block-([A-Za-z0-9_-]{1,160})$/.exec(window.location.hash);
  if (!match) return;
  const state = window.history.state as Record<string, unknown> | null;
  const key = state?.__TSR_key ?? state?.key;
  const visit = `${typeof key === "string" ? key : ""}${window.location.pathname}${window.location.hash}`;
  if (revealed.has(visit)) return;
  const block = root.querySelector<HTMLElement>(`[data-id="${match[1]}"]`);
  if (!block) return;
  revealed.add(visit);
  block.scrollIntoView({ block: "center" });
  block.animate?.(
    [
      {
        backgroundColor: "color-mix(in oklab, var(--primary) 16%, transparent)",
      },
      { backgroundColor: "transparent" },
    ],
    { duration: 2400, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
}
