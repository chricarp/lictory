import { useMemo } from "react";
import { Inbox } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { needsMyReview } from "@lictory/core/lib/work-items";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useUnread } from "@lictory/platform/components/shell/unread";
import {
  SidebarLink,
  useNavActive,
} from "@lictory/platform/components/shell/sidebar-parts";
import type {
  NavBadge,
  NavSection,
  NavSectionProps,
} from "@lictory/platform/components/shell/nav-registry";

// Unread notifications take the badge; otherwise the count of open reviews
// waiting on me.
function useInboxBadge(): NavBadge | null {
  const { organization, items, userId, disciplineIds } = useWorkspace();
  const unread = useUnread()[organization.id] ?? 0;
  const todo = useMemo(
    () => items.filter((i) => needsMyReview(i, userId, disciplineIds)).length,
    [items, userId, disciplineIds],
  );
  if (unread > 0) return { count: unread, label: "unread", tone: "strong" };
  if (todo > 0) return { count: todo, label: "to do", tone: "quiet" };
  return null;
}

// What is addressed to me, and my assistant.
function InboxSection({ badge }: NavSectionProps) {
  const { organization } = useWorkspace();
  const active = useNavActive();
  const org = organization.slug;
  return (
    <>
      <SidebarLink
        href={paths.inbox(org)}
        active={active(paths.inbox(org))}
        icon={<Inbox />}
        badge={badge}
      >
        Inbox
      </SidebarLink>
      <SidebarLink
        href={paths.intelligence(org)}
        active={active(paths.intelligence(org))}
        icon={<IntelligenceMark className="size-4" />}
      >
        Litto
      </SidebarLink>
    </>
  );
}

export const inboxSection: NavSection = {
  id: "inbox",
  label: "Inbox",
  icon: Inbox,
  href: paths.inbox,
  useBadge: useInboxBadge,
  Section: InboxSection,
};
