import { GitPullRequest } from "lucide-react";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useCodeHosts,
  useCodeList,
} from "@lictory/platform/components/code/store";
import { codePaths } from "@lictory/platform/components/code/parts";
import {
  SidebarGroup,
  SidebarLink,
  useNavActive,
} from "@lictory/platform/components/shell/sidebar-parts";
import type {
  NavBadge,
  NavSection,
  NavSectionProps,
} from "@lictory/platform/components/shell/nav-registry";

// The Code module's entry in the shell's nav registry: pull requests, issues
// and repositories of the connected code hosts. Its badge counts the open
// pull requests that ask the signed-in person for a review (by their code
// host login). Before any host is connected the section still links to the
// Code page, which explains how to connect one.

function useCodeBadge(): NavBadge | null {
  const { myLogins } = useCodeHosts();
  const { rows } = useCodeList("codePullRequest", "open");
  const count = rows.filter((p) =>
    p.requestedReviewers.some((r) => myLogins.has(r.toLowerCase())),
  ).length;
  return count ? { count, label: "reviews requested", tone: "strong" } : null;
}

function CodeSection({ badge }: NavSectionProps) {
  const { organization } = useWorkspace();
  const active = useNavActive();
  const href = codePaths.index(organization.slug);
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
  href: (org) => codePaths.index(org),
  useBadge: useCodeBadge,
  Section: CodeSection,
};
