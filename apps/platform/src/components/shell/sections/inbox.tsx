import { Inbox } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useUnread } from "@lictory/platform/components/shell/unread";
import { useWaitingOnYou } from "@lictory/platform/components/workspace/inbox";
import {
  SidebarLink,
  useNavActive,
} from "@lictory/platform/components/shell/sidebar-parts";
import type {
  NavBadge,
  NavSection,
  NavSectionProps,
} from "@lictory/platform/components/shell/nav-registry";

// The Inbox's badge counts what waits on me (To do: the same queue as
// Home's "Waiting on you"), strongly; unread updates are news, not asks, and
// show as a quiet dot beside it.
function useInboxBadge(): NavBadge | null {
  const { organization } = useWorkspace();
  const unread = useUnread()[organization.id] ?? 0;
  const todo = useWaitingOnYou().length;
  if (todo === 0 && unread === 0) return null;
  return {
    count: todo,
    label: "to do",
    // Unread updates alone wait on nobody (the phone's menu button marks
    // strong badges only).
    tone: todo > 0 ? "strong" : "quiet",
    ...(unread > 0 ? { dot: "unread updates" } : {}),
  };
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
