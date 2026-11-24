import { Component, useId, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Link } from "@lictory/platform/lib/navigation";

// The frame of a card on Home: a heading with a count, the first few rows
// and a link to the rest. Modules registering Home cards use it so Home reads
// as one page.
export function HomePanel({
  title,
  icon,
  count,
  more,
  empty,
  children,
  className,
}: {
  title: string;
  icon?: ReactNode;
  // How many there are in all (rows shown may be fewer).
  count?: number;
  // Where all of them are.
  more?: { label: string; href: string };
  // Said instead of rows when there are none.
  empty?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hasRows = Boolean(children) && count !== 0;
  return (
    <section
      aria-labelledby={id}
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
        <h2 id={id} className="text-[13px] font-semibold">
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
        {more && hasRows && (
          <Link
            href={more.href}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {more.label}
            <ArrowRight aria-hidden className="size-3" />
          </Link>
        )}
      </div>
      {hasRows ? (
        <ul className="divide-y divide-border/70">{children}</ul>
      ) : (
        <p className="px-3.5 py-5 text-[13px] leading-5 text-muted-foreground">
          {empty}
        </p>
      )}
    </section>
  );
}

// One row of a Home card: what it is, why it is here, and when it changed.
export function HomeRow({
  href,
  icon,
  title,
  reason,
  meta,
  time,
}: {
  href: string;
  icon?: ReactNode;
  title: ReactNode;
  // Why this row is on Home ("Review requested").
  reason?: ReactNode;
  // Where it belongs (an identifier, a space).
  meta?: ReactNode;
  time?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-3.5 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
      >
        {icon && (
          <span aria-hidden className="grid size-4 shrink-0 place-items-center">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 text-[13px]">
            {meta && (
              <span className="shrink-0 text-muted-foreground">{meta}</span>
            )}
            <span className="truncate">{title}</span>
          </span>
          {reason && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {reason}
            </span>
          )}
        </span>
        {time && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {time}
          </span>
        )}
      </Link>
    </li>
  );
}

// A module's card failing never takes Home down with it.
export class HomeCardBoundary extends Component<
  { name: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <HomePanel
          title={this.props.name}
          empty="This card could not be shown. Reload the page to try again."
        />
      );
    return this.props.children;
  }
}
