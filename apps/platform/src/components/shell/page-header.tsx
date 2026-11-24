import {
  createContext,
  Fragment,
  useContext,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { TabsList, TabsTab } from "@ui-sdk/react/tabs";
import { ArrowLeft, ChevronRight, Info } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Tooltip } from "@lictory/ui/tooltip";
import { Link, usePathname } from "@lictory/platform/lib/navigation";

type Crumb = { label: string; href: string };

// What the shell lends the page header on phones, where the two share one
// bar: the navigation button before the title and the shell's own controls
// (search, create) after the page's actions. A header that mounts claims the
// bar, and the shell hides its own top bar while one is claimed.
export type PhoneChrome = {
  claim: () => () => void;
  leading: ReactNode;
  trailing: ReactNode;
};
export const PhoneChromeContext = createContext<PhoneChrome | null>(null);

// The one header every module page starts with: where I am (back, then
// breadcrumbs, then the page's title and a line of meta), the page's views
// (tabs) and its actions, in a single bar on the page's surface: 44px on
// desktop; on phones 48px, merged with the shell's top bar.
export function PageHeader({
  title,
  icon,
  back,
  breadcrumbs,
  meta,
  description,
  tabs,
  actions,
  className,
}: {
  // The page's heading (h1).
  title: ReactNode;
  // A small decorative mark before the title.
  icon?: ReactNode;
  // The page this one belongs to (a session's Factory, a pull request's
  // Code): an arrow before the title, named "Back to …".
  back?: { label: string; href: string };
  // Pages above this one, outermost first.
  breadcrumbs?: readonly Crumb[];
  // One quiet line after the title: a channel's topic, a project chip, a
  // count ("3 running · 1 queued"). Hidden on phones.
  meta?: ReactNode;
  // What the page is for, when the title alone does not say it. Shown from
  // an info button beside the title, never as a paragraph under it.
  description?: string;
  // `PageTabs` inside the caller's `Tabs` root, or `PageLinkTabs`.
  tabs?: ReactNode;
  // Trailing buttons; the most important one last.
  actions?: ReactNode;
  className?: string;
}) {
  const phone = useContext(PhoneChromeContext);
  useLayoutEffect(() => phone?.claim(), [phone]);
  return (
    <header
      data-page-header
      className={cn(
        "flex h-11 shrink-0 items-center gap-3 border-b px-4 max-lg:h-12 max-lg:gap-2 max-sm:px-2",
        className,
      )}
    >
      {phone && <div className="contents lg:hidden">{phone.leading}</div>}
      <div className="flex min-w-0 shrink items-center gap-1.5">
        {back && (
          <Tooltip label={back.label}>
            <Link
              href={back.href}
              aria-label={back.label}
              className="-ml-1.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden />
            </Link>
          </Tooltip>
        )}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="min-w-0 shrink max-sm:hidden">
            <ol className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
              {breadcrumbs.map((crumb) => (
                <Fragment key={crumb.href}>
                  <li className="min-w-0">
                    <Link
                      href={crumb.href}
                      className="block truncate rounded-sm focus-ring outline-none hover:text-foreground"
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
            className={cn(
              "grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4",
              // On phones the navigation button stands where the icon was.
              phone && "max-lg:hidden",
            )}
          >
            {icon}
          </span>
        )}
        <h1 className="min-w-0 truncate text-sm font-semibold">{title}</h1>
        {description && (
          <Tooltip label={description}>
            <button
              type="button"
              aria-label={`About ${typeof title === "string" ? title : "this page"}`}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
            >
              <Info className="size-3.5" aria-hidden />
            </button>
          </Tooltip>
        )}
        {meta && (
          <div
            data-page-meta
            className="flex min-w-0 shrink items-center gap-2 truncate border-l pl-3 text-[13px] text-muted-foreground max-sm:hidden"
          >
            {meta}
          </div>
        )}
      </div>
      {tabs && (
        <div className="flex min-w-0 [scrollbar-width:none] items-center overflow-x-auto">
          {tabs}
        </div>
      )}
      {(actions ?? phone) && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {actions}
          {phone && <div className="contents lg:hidden">{phone.trailing}</div>}
        </div>
      )}
    </header>
  );
}

const tabClass =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-ring";
const selectedClass = "bg-muted font-medium text-foreground";

function TabCount({ count }: { count?: number }) {
  if (count === undefined || count <= 0) return null;
  return (
    <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
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
          className={cn(
            tabClass,
            "data-selected:bg-muted data-selected:font-medium data-selected:text-foreground",
          )}
        >
          {t.label}
          <TabCount count={t.count} />
        </TabsTab>
      ))}
    </TabsList>
  );
}

// Pages of one module as tabs in the header (Factory: Overview, Agents,
// Runners). Each is a link; the current one is marked `aria-current`.
export function PageLinkTabs({
  label,
  tabs,
}: {
  // Names the navigation: "Factory".
  label: string;
  tabs: readonly {
    href: string;
    label: string;
    count?: number;
    // Current only on this exact address, not on its subpages.
    exact?: boolean;
  }[];
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="flex items-center gap-0.5">
        {tabs.map((t) => {
          const current = t.exact
            ? pathname === t.href
            : pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={current ? "page" : undefined}
                className={cn(tabClass, current && selectedClass)}
              >
                {t.label}
                <TabCount count={t.count} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
