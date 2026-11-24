import { useEffect, useRef } from "react";
import { Link } from "@lictory/platform/lib/navigation";
import { usePathname } from "@lictory/platform/lib/navigation";
import { cn } from "@lictory/core/lib/utils";
import type { SettingsNavItem } from "@lictory/platform/components/workspace/settings-section";

// The section the address names. The most specific link wins: /admin/people
// is People, not Overview's /admin.
export function useSelectedSetting(nav: SettingsNavItem[]) {
  const pathname = usePathname();
  return (
    nav
      .filter(
        (item) =>
          pathname === item.href || pathname.startsWith(`${item.href}/`),
      )
      .sort((a, b) => b.href.length - a.href.length)[0] ?? nav[0]
  );
}

// The sections of a settings page: a list beside the content on wide
// screens, one row of tabs above it on narrow ones, where the current
// section is always scrolled into view.
export function SettingsNavigation({
  nav,
  selected,
}: {
  nav: SettingsNavItem[];
  selected: string | undefined;
}) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = row.current;
    const current = container?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    // Only the narrow layout scrolls sideways.
    if (!container || !current) return;
    if (container.scrollWidth <= container.clientWidth) return;
    const left =
      current.offsetLeft - (container.clientWidth - current.offsetWidth) / 2;
    container.scrollTo({ left: Math.max(0, left) });
  }, [selected]);
  const groups: { group?: string; items: SettingsNavItem[] }[] = [];
  for (const item of nav) {
    const last = groups.at(-1);
    if (last && last.group === item.group) last.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  return (
    <nav
      aria-label="Settings sections"
      className="mb-6 max-lg:-mx-4 max-lg:border-b max-lg:pb-2 sm:max-lg:-mx-6 lg:sticky lg:top-0 lg:mb-0 lg:self-start"
    >
      <div
        ref={row}
        className="flex [scrollbar-width:none] gap-1 overflow-x-auto max-lg:px-4 sm:max-lg:px-6 lg:block lg:space-y-4"
      >
        {groups.map((g, i) => (
          <div key={g.group ?? i} className="flex gap-1 lg:block">
            {g.group && (
              <p className="hidden px-2.5 pb-1 text-xs font-semibold text-muted-foreground lg:block">
                {g.group}
              </p>
            )}
            <ul className="flex gap-1 lg:block lg:space-y-0.5">
              {g.items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    scroll={false}
                    aria-current={n.id === selected ? "page" : undefined}
                    className={cn(
                      "block rounded-lg px-2.5 py-1.5 text-[13px] whitespace-nowrap text-muted-foreground focus-ring-inset transition-[background-color,color,box-shadow] duration-100 outline-none hover:bg-muted hover:text-foreground",
                      n.id === selected &&
                        "bg-card font-medium text-foreground shadow-(--shadow-border) hover:bg-card",
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
