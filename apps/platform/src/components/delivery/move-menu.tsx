import { ArrowDownUp } from "lucide-react";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  MenuGroup,
} from "@lictory/ui/menu";
import { cn } from "@lictory/core/lib/utils";
import type { RankMove } from "@lictory/platform/components/delivery/move";

const rankItems: { to: RankMove; label: string }[] = [
  { to: "top", label: "Move to top" },
  { to: "up", label: "Move up" },
  { to: "down", label: "Move down" },
  { to: "bottom", label: "Move to bottom" },
];

// The trigger of the card or row that moved, found again after it moved to
// another column (a new element): focus stays on what the person moved.
export const moveTrigger = (itemId: string) =>
  document.querySelector<HTMLElement>(`[data-move-trigger="${itemId}"]`);

export function refocusMoved(itemId: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const trigger = moveTrigger(itemId);
      if (trigger && document.activeElement !== trigger) trigger.focus();
    }),
  );
}

// "Move" on a board card or backlog row: every drag has a single-pointer and
// keyboard alternative (WCAG 2.5.7). Ranks within the list the item is shown
// in and, on the board, moves it to another column.
export function MoveMenu({
  itemId,
  label,
  index,
  count,
  where,
  columns,
  column,
  onColumn,
  onRank,
  className,
}: {
  itemId: string;
  // The item's key ("PAY-6").
  label: string;
  // Its place in the list it is shown in.
  index: number;
  count: number;
  // The list's name ("In progress", "Backlog"), read with the place.
  where: string;
  columns?: readonly { id: string; name: string }[];
  column?: string;
  onColumn?: (statusId: string) => void;
  onRank: (to: RankMove) => void;
  className?: string;
}) {
  const first = index === 0;
  const last = index === count - 1;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            data-move-trigger={itemId}
            // The place is read with the name, so moving says where the
            // item went when focus comes back to this button.
            aria-label={`Move ${label}, ${index + 1} of ${count} in ${where}`}
            title={`Move ${label}`}
            className={cn(
              "relative z-[1] grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground pointer-coarse:size-8",
              className,
            )}
          />
        }
      >
        <ArrowDownUp className="size-3.5" aria-hidden />
      </MenuTrigger>
      <MenuContent
        align="end"
        width={208}
        aria-label={`Move ${label}`}
        finalFocus={() => moveTrigger(itemId)}
      >
        {columns && onColumn && (
          <>
            <MenuGroup>
              <MenuLabel>Column</MenuLabel>
              <MenuRadioGroup
                value={column}
                onValueChange={(next) => {
                  if (String(next) !== column) onColumn(String(next));
                }}
              >
                {columns.map((c) => (
                  <MenuRadioItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
          </>
        )}
        {rankItems.map(({ to, label: text }) => (
          <MenuItem
            key={to}
            disabled={to === "top" || to === "up" ? first : last}
            onSelect={() => onRank(to)}
          >
            {text}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
