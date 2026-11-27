// Moving a card or row without dragging it (WCAG 2.5.7): the neighbours a
// rank move places an item between, in the list it is shown in. The same
// command a drop sends (`rankWorkItem`), so both ways rank alike.

export type RankMove = "top" | "up" | "down" | "bottom";

export function rankNeighbours(
  ids: readonly string[],
  id: string,
  to: RankMove,
): { afterId: string | null; beforeId: string | null } | null {
  const at = ids.indexOf(id);
  if (at === -1) return null;
  const others = ids.filter((other) => other !== id);
  const index =
    to === "top"
      ? 0
      : to === "bottom"
        ? others.length
        : to === "up"
          ? at - 1
          : at + 1;
  // Already there (or nowhere to go): nothing to send.
  if (index < 0 || index > others.length || index === at) return null;
  return {
    afterId: others[index - 1] ?? null,
    beforeId: others[index] ?? null,
  };
}
