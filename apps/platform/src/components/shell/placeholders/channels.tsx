import { Hash } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  SidebarGroup,
  SidebarLink,
  useNavActive,
} from "@lictory/platform/components/shell/sidebar-parts";
import type {
  NavSection,
  NavSectionProps,
} from "@lictory/platform/components/shell/nav-registry";

// Placeholder until the Channels module ships its own section and pages.

function ChannelsSection({ badge }: NavSectionProps) {
  const { organization } = useWorkspace();
  const active = useNavActive();
  const href = paths.channels(organization.slug);
  return (
    <SidebarGroup id="channels" label="Channels" badge={badge}>
      <SidebarLink
        href={href}
        active={active(href, true)}
        icon={<Hash />}
        badge={badge}
      >
        Browse channels
      </SidebarLink>
    </SidebarGroup>
  );
}

export const channelsSection: NavSection = {
  id: "channels",
  label: "Channels",
  icon: Hash,
  href: paths.channels,
  Section: ChannelsSection,
};
