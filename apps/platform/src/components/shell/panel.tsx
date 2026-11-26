import { useId, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Link } from "@lictory/platform/lib/navigation";

// A card of rows with a heading: a sans title with its count, an optional
// link to all of them, the rows, or one line saying what will appear. Home's
// cards, the Factory's blocks, queues and settings groups are all Panels.
//
// Rule: a panel with nothing to show and nothing to teach is not rendered at
// all (`empty` omitted and no rows renders null), so pages never show empty
// boxes. Give `empty` only when the line helps the person act.
export function Panel({
  title,
  icon,
  count,
  more,
  actions,
  empty,
  children,
  headingLevel = 2,
  className,
}: {
  title: string;
  icon?: ReactNode;
  // How many there are in all (rows shown may be fewer).
  count?: number;
  // Where all of them are.
  more?: { label: string; href: string };
  // Small controls at the end of the heading (a filter, "New").
  actions?: ReactNode;
  // Said instead of rows when there are none. Omit to hide the panel.
  empty?: ReactNode;
  // `ListRow`s (or other `li`s). Anything falsy counts as no rows.
  children?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const id = useId();
  const rows = Array.isArray(children)
    ? children.flat().some(Boolean)
    : Boolean(children);
  const hasRows = rows && count !== 0;
  if (!hasRows && empty === undefined) return null;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      aria-labelledby={id}
      data-panel
      className={cn(
        "flex min-w-0 flex-col rounded-xl bg-card shadow-(--shadow-border)",
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3.5">
        {icon && (
          <span
            aria-hidden
            className="grid size-4 place-items-center text-muted-foreground [&_svg]:size-4"
          >
            {icon}
          </span>
        )}
        <Heading id={id} className="text-[13px] font-semibold">
          {title}
        </Heading>
        {count !== undefined && count > 0 && (
          // A tint of the text colour, not --muted: on a dark card the muted
          // fill is the card's own colour, and the chip became a bare number.
          <span className="rounded-full bg-foreground/8 px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {actions}
          {more && hasRows && (
            <Link
              href={more.href}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
            >
              {more.label}
              <ArrowRight aria-hidden className="size-3" />
            </Link>
          )}
        </div>
      </div>
      {hasRows ? (
        <ul className="divide-y divide-border/70">{children}</ul>
      ) : (
        <p className="px-3.5 py-4 text-[13px] leading-5 text-muted-foreground">
          {empty}
        </p>
      )}
    </section>
  );
}

// A caption over a group of rows or controls outside a card: sans 12px
// semibold, muted, with an optional count. Mono is for identifiers only.
export function SectionCaption({
  children,
  count,
  action,
  as: Tag = "h2",
  className,
}: {
  children: ReactNode;
  count?: number;
  action?: ReactNode;
  as?: "h2" | "h3" | "p";
  className?: string;
}) {
  return (
    <div className={cn("mb-2 flex h-6 items-center gap-2", className)}>
      <Tag className="text-xs font-semibold text-muted-foreground">
        {children}
      </Tag>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
