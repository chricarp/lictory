import { Link, useRouter } from "@lictory/platform/lib/navigation";
import { usePathname } from "@lictory/platform/lib/navigation";
import { cn } from "@lictory/core/lib/utils";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
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
// screens and rows of whole tabs above it on narrower ones. A phone has no
// room for a dozen tabs, and a strip that scrolls sideways cuts the words at
// its edges ("abels & milestones"), so there one select names the current
// section and lists every other one in full.
export function SettingsNavigation({
  nav,
  selected,
}: {
  nav: SettingsNavItem[];
  selected: string | undefined;
}) {
  const router = useRouter();
  const groups: { group?: string; items: SettingsNavItem[] }[] = [];
  for (const item of nav) {
    const last = groups.at(-1);
    if (last && last.group === item.group) last.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  return (
    <nav
      aria-label="Settings sections"
      className="mb-6 max-lg:-mx-4 max-lg:border-b max-lg:px-4 max-lg:pb-2 sm:max-lg:-mx-6 sm:max-lg:px-6 lg:sticky lg:top-0 lg:mb-0 lg:self-start"
    >
      <DropdownSelect
        aria-label="Settings section"
        variant="field"
        size="lg"
        className="w-full sm:hidden"
        value={selected ?? ""}
        onValueChange={(id) => {
          const item = nav.find((n) => n.id === id);
          if (item && item.id !== selected)
            router.push(item.href, { scroll: false });
        }}
      >
        {nav.map((n) => (
          <DropdownSelectOption key={n.id} value={n.id}>
            {n.label}
          </DropdownSelectOption>
        ))}
      </DropdownSelect>
      <div className="flex flex-wrap gap-1 max-sm:hidden lg:block lg:space-y-4">
        {groups.map((g, i) => (
          <div key={g.group ?? i} className="contents lg:block">
            {g.group && (
              <p className="hidden px-2.5 pb-1 text-xs font-semibold text-muted-foreground lg:block">
                {g.group}
              </p>
            )}
            <ul className="flex flex-wrap gap-1 lg:block lg:space-y-0.5">
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
