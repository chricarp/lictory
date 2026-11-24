import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  navSections,
  type NavBadge,
} from "@lictory/platform/components/shell/nav-registry";
import { useDesktopBadgeSource } from "@lictory/platform/lib/desktop-bridge";

type Badges = ReadonlyMap<string, NavBadge>;
const NavBadgesContext = createContext<Badges>(new Map());

// Reads every section's badge once for the whole shell: the sidebar (full,
// compact or in the phone drawer), the phone's menu button and the desktop
// dock all show the same counts.
export function NavBadgesProvider({ children }: { children: ReactNode }) {
  const read: (NavBadge | null)[] = [];
  // `navSections` is a module constant, so these hooks run in the same order
  // on every render.
  for (const section of navSections)
    read.push(section.useBadge ? section.useBadge() : null);
  const key = read
    .map((b) =>
      b
        ? `${b.count}:${b.tone}:${b.dock ? 1 : 0}:${b.label}:${b.dot ?? ""}`
        : "",
    )
    .join("|");
  const badges = useMemo<Badges>(() => {
    const map = new Map<string, NavBadge>();
    navSections.forEach((section, index) => {
      const badge = read[index];
      if (badge && (badge.count > 0 || badge.dot)) map.set(section.id, badge);
    });
    return map;
    // The key captures every badge's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Mentions and direct messages of this organization, one source of the
  // desktop badge (the bridge sums sources and alone calls `setBadge`).
  let dock = 0;
  for (const badge of badges.values()) if (badge.dock) dock += badge.count;
  useDesktopBadgeSource("sidebar", dock);
  return <NavBadgesContext value={badges}>{children}</NavBadgesContext>;
}

export function useNavBadges() {
  return useContext(NavBadgesContext);
}
