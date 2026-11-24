import { Bot } from "lucide-react";
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

// Placeholder until the Factory module ships its own section and pages.

function FactorySection({ badge }: NavSectionProps) {
  const { organization } = useWorkspace();
  const active = useNavActive();
  const href = paths.factory(organization.slug);
  return (
    <SidebarGroup id="factory" label="Factory" badge={badge}>
      <SidebarLink
        href={href}
        active={active(href)}
        icon={<Bot />}
        badge={badge}
      >
        Agents
      </SidebarLink>
    </SidebarGroup>
  );
}

export const factorySection: NavSection = {
  id: "factory",
  label: "Factory",
  icon: Bot,
  href: paths.factory,
  Section: FactorySection,
};
