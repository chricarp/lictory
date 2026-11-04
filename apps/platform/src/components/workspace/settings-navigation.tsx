import { Link } from "@lictory/platform/lib/navigation";
import { usePathname } from "@lictory/platform/lib/navigation";
import { cn } from "@lictory/core/lib/utils";
import type { SettingsNavItem } from "@lictory/platform/components/workspace/settings-section";

// Subscribe to route changes here so the shared settings header does not need
// to render again just to update the selected navigation link.
export function SettingsNavigation({ nav }: { nav: SettingsNavItem[] }) {
  const pathname = usePathname();
  const selected =
    nav.find(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )?.id ?? nav[0]?.id;
  const groups: { group?: string; items: SettingsNavItem[] }[] = [];
  for (const item of nav) {
    const last = groups.at(-1);
    if (last && last.group === item.group) last.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  return (
    <nav
      aria-label="Settings sections"
      className="mb-6 lg:sticky lg:top-0 lg:mb-0 lg:self-start"
    >
      <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-4">
        {groups.map((g, i) => (
          <div key={g.group ?? i} className="flex gap-1 lg:block">
            {g.group && (
              <p className="hidden px-2 pb-1 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase lg:block">
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
                      "block rounded-lg px-2.5 py-1.5 text-[13px] whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] duration-100 hover:bg-muted hover:text-foreground",
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
