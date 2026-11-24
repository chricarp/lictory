import { Fragment, type ReactNode } from "react";
import { TabsList, TabsTab } from "@ui-sdk/react/tabs";
import { ChevronRight } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Link } from "@lictory/platform/lib/navigation";

type Crumb = { label: string; href: string };

// The one header every module page starts with: where I am (breadcrumbs, then
// the page's title), the page's views (tabs) and its actions, in a single
// 44px bar on the page's surface. In the desktop app the bar also moves the
// window; its controls stay clickable.
export function PageHeader({
  title,
  icon,
  breadcrumbs,
  tabs,
  actions,
  className,
}: {
  // The page's heading (h1).
  title: ReactNode;
  // A small decorative mark before the title.
  icon?: ReactNode;
  // Pages above this one, outermost first.
  breadcrumbs?: readonly Crumb[];
  // `PageTabs` inside the caller's `Tabs` root, or links.
  tabs?: ReactNode;
  // Trailing buttons; the most important one last.
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      data-page-header
      data-drag-region
      className={cn(
        "flex h-11 shrink-0 items-center gap-3 border-b px-4 max-sm:px-3",
        className,
      )}
    >
      <div className="flex min-w-0 shrink items-center gap-1.5">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="min-w-0 shrink">
            <ol className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
              {breadcrumbs.map((crumb) => (
                <Fragment key={crumb.href}>
                  <li className="min-w-0">
                    <Link
                      href={crumb.href}
                      className="block truncate rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      {crumb.label}
                    </Link>
                  </li>
                  <li aria-hidden className="shrink-0">
                    <ChevronRight className="size-3.5 opacity-60" />
                  </li>
                </Fragment>
              ))}
            </ol>
          </nav>
        )}
        {icon && (
          <span
            aria-hidden
            className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4"
          >
            {icon}
          </span>
        )}
        <h1 className="min-w-0 truncate text-sm font-semibold">{title}</h1>
      </div>
      {tabs && <div className="flex min-w-0 items-center">{tabs}</div>}
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {actions}
        </div>
      )}
    </header>
  );
}

// The views of a page as tabs in its header. Wrap the header in ui-sdk's
// `Tabs` root (with `TabsPanel`s below it) and pass these as `tabs`.
export function PageTabs({
  label,
  tabs,
}: {
  // Names the tab list: "Inbox view".
  label: string;
  tabs: readonly { value: string; label: string; count?: number }[];
}) {
  return (
    <TabsList aria-label={label} className="flex items-center gap-0.5">
      {tabs.map((t) => (
        <TabsTab
          key={t.value}
          value={t.value}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-selected:bg-muted data-selected:font-medium data-selected:text-foreground"
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t.count}
            </span>
          )}
        </TabsTab>
      ))}
    </TabsList>
  );
}
