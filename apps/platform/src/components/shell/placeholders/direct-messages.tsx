import { MessagesSquare } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  SidebarGroup,
  SidebarLink,
} from "@lictory/platform/components/shell/sidebar-parts";
import type {
  NavSection,
  NavSectionProps,
} from "@lictory/platform/components/shell/nav-registry";

// Placeholder until the Channels module lists direct conversations here.

function DirectMessagesSection({ badge }: NavSectionProps) {
  const { organization } = useWorkspace();
  return (
    <SidebarGroup id="direct-messages" label="Direct messages" badge={badge}>
      <SidebarLink
        href={paths.channels(organization.slug)}
        active={false}
        icon={<MessagesSquare />}
        badge={badge}
      >
        All conversations
      </SidebarLink>
    </SidebarGroup>
  );
}

export const directMessagesSection: NavSection = {
  id: "direct-messages",
  label: "Direct messages",
  icon: MessagesSquare,
  href: paths.channels,
  Section: DirectMessagesSection,
};
