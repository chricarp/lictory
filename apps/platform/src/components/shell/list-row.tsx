import type { ReactNode } from "react";
import { cn } from "@lictory/core/lib/utils";
import { relativeTime } from "@lictory/core/lib/work-items";
import { Link } from "@lictory/platform/lib/navigation";

// One row of a list, everywhere: a leading icon or actor, the title with an
// optional identifier before it, one line of meta, trailing chips, the time,
// and actions that appear on hover or focus. The row is one link (its title
// stretches over the row), and the actions are separate buttons above it,
// so every part stays reachable by keyboard and nothing nests in a link.
export function ListRow({
  href,
  onClick,
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
  // An icon (16px) or an avatar (20px, `Actor` / `AgentAvatar`).
  leading?: ReactNode;
  // A key or number before the title, in mono: "PAY-6", "#3".
  identifier?: ReactNode;
  title: ReactNode;
  // One line under the title: why it is here, where it belongs.
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
  const target =
    "min-w-0 truncate text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring";
  const titleNode = href ? (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={target}
    >
      {title}
    </Link>
  ) : onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(target, "cursor-default")}
    >
      {title}
    </button>
  ) : (
    <span className="min-w-0 truncate">{title}</span>
  );
  const iso = typeof time === "string" ? time : time?.iso;
  const timeLabel = typeof time === "string" ? relativeTime(time) : time?.label;
  const timeProps = iso && {
    dateTime: iso,
    title: new Date(iso).toLocaleString(),
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
        <span className="grid min-w-4 shrink-0 place-items-center [&>svg]:size-4">
          {leading}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2 text-[13px] leading-5">
          {identifier && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {identifier}
            </span>
          )}
          {titleNode}
        </span>
        {(meta ?? timeProps) && (
          // On phones the time leads this line, so the title above keeps the
          // row's full width.
          <span
            className={cn(
              "mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs leading-4 text-muted-foreground",
              !meta && "sm:hidden",
            )}
          >
            {timeProps && (
              <>
                <time
                  {...timeProps}
                  className="shrink-0 tabular-nums sm:hidden"
                >
                  {timeLabel}
                </time>
                {meta && (
                  <span aria-hidden className="sm:hidden">
                    ·
                  </span>
                )}
              </>
            )}
            {meta}
          </span>
        )}
      </span>
      {chips && (
        <span className="flex shrink-0 items-center gap-1.5">{chips}</span>
      )}
      {timeProps && (
        <time
          {...timeProps}
          className="shrink-0 text-xs text-muted-foreground tabular-nums max-sm:hidden"
        >
          {timeLabel}
        </time>
      )}
      {actions && (
        <span className="relative z-10 flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none touch:opacity-100">
          {actions}
        </span>
      )}
    </li>
  );
}
