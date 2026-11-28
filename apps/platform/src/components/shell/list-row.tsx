import type { ReactNode } from "react";
import { cn } from "@lictory/core/lib/utils";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { Link } from "@lictory/platform/lib/navigation";
import {
  MetaLine,
  MetaPart,
} from "@lictory/platform/components/shell/meta-line";

// One row of a list, everywhere: a leading icon or actor, the title with an
// optional identifier before it, one line of meta, trailing chips, actions
// that appear on hover or focus, and the time. The row is one link (its title
// stretches over the row), and the actions are separate buttons above it,
// so every part stays reachable by keyboard and nothing nests in a link.
export function ListRow({
  href,
  onClick,
  expanded,
  leading,
  identifier,
  title,
  meta,
  chips,
  time,
  actions,
  current = false,
  className,
}: {
  // Where the row leads. Without it (and without `onClick`) the row is text.
  href?: string;
  // Or what pressing it does.
  onClick?: () => void;
  // With `onClick`: the row discloses details below it, open or closed.
  expanded?: boolean;
  // An icon (16px) or an avatar (20px, `Actor` / `AgentAvatar`).
  leading?: ReactNode;
  // A key or number before the title, in mono: "PAY-6", "#3".
  identifier?: ReactNode;
  title: ReactNode;
  // One line under the title: why it is here, where it belongs. Its parts
  // (children, fragments flattened) are separated by dots (`MetaLine`).
  meta?: ReactNode;
  // `StatusChip`s, at the end of the row.
  chips?: ReactNode;
  // An ISO time, shown relative ("2m ago"), or a label of your own.
  time?: string | { iso: string; label: string };
  // Buttons for the row, revealed on hover or when focus is in the row.
  actions?: ReactNode;
  // The row is the page or selection shown beside the list.
  current?: boolean;
  className?: string;
}) {
  // On phones the key and the title read as one sentence of up to two lines
  // (the line, not the title, is clamped), so a wrapped title starts its
  // second line under the key instead of hanging in a narrow column beside
  // it, and rows that start alike ("Run the database migration on…") stay
  // tell-apart-able.
  const clamp = "min-w-0 sm:truncate";
  const target =
    "text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring";
  const titleNode = href ? (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(clamp, target)}
    >
      {title}
    </Link>
  ) : onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={cn(clamp, target, "cursor-default")}
    >
      {title}
    </button>
  ) : (
    <span className={clamp}>{title}</span>
  );
  const iso = typeof time === "string" ? time : time?.iso;
  const timeLabel = typeof time === "string" ? relativeTime(time) : time?.label;
  const timeProps = iso && {
    dateTime: iso,
    title: absoluteTime(iso),
  };
  return (
    <li
      data-list-row
      className={cn(
        "group/row relative flex min-h-12 items-center gap-3 px-3.5 py-2 [--actor-ring:var(--card)]",
        (href ?? onClick) && "hover:bg-muted/60 has-focus-visible:bg-muted/60",
        current && "bg-muted/60",
        className,
      )}
    >
      {leading && (
        // One leading slot for every row: a 16px icon and a 20px avatar take
        // the same width, so titles share one edge down the list.
        <span className="grid w-5 shrink-0 place-items-center [&>svg]:size-4">
          {leading}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2 text-[13px] leading-5 max-sm:line-clamp-2 max-sm:break-words">
          {identifier && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground max-sm:mr-1.5">
              {identifier}
            </span>
          )}
          {titleNode}
        </span>
        {(meta ?? timeProps) && (
          // On phones the time leads this line, so the title above keeps the
          // row's full width. Its parts wrap rather than clip: a flex line
          // cut by overflow ends mid-word with no ellipsis ("started b").
          // A long sentence part truncates on its own line.
          <MetaLine className={cn("mt-0.5", !meta && "sm:hidden")}>
            {timeProps && (
              <MetaPart className="shrink-0 sm:hidden">
                <time {...timeProps} className="tabular-nums">
                  {timeLabel}
                </time>
              </MetaPart>
            )}
            {meta}
          </MetaLine>
        )}
      </span>
      {chips && (
        <span className="flex shrink-0 items-center gap-1.5">{chips}</span>
      )}
      {actions && (
        <span className="relative z-10 flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none touch:opacity-100">
          {actions}
        </span>
      )}
      {timeProps && (
        // The time is the row's last column, right-aligned at a shared
        // minimum width, so times line up down a list whether or not a row
        // has actions (ApprovalRequest rows keep the same column).
        <time
          {...timeProps}
          className="min-w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums max-sm:hidden"
        >
          {timeLabel}
        </time>
      )}
    </li>
  );
}
