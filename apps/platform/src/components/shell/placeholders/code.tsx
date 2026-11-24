import { GitPullRequest } from "lucide-react";
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

// Placeholder until the Code module ships its own section and pages.

function CodeSection({ badge }: NavSectionProps) {
  const { organization } = useWorkspace();
  const active = useNavActive();
  const href = paths.code(organization.slug);
  return (
    <SidebarGroup id="code" label="Code" badge={badge}>
      <SidebarLink
        href={href}
        active={active(href)}
        icon={<GitPullRequest />}
        badge={badge}
      >
        Pull requests
      </SidebarLink>
    </SidebarGroup>
  );
}

export const codeSection: NavSection = {
  id: "code",
  label: "Code",
  icon: GitPullRequest,
  href: paths.code,
  Section: CodeSection,
};
