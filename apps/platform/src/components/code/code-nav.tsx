import { useMemo } from "react";
import { GitMerge, GitPullRequest } from "lucide-react";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useCodeHosts,
  useCodeList,
} from "@lictory/platform/components/code/store";
import { codePaths } from "@lictory/platform/components/code/parts";
import {
  SidebarLink,
  useNavActive,
} from "@lictory/platform/components/shell/sidebar-parts";
import type {
  NavBadge,
  NavSection,
  NavSectionProps,
  PaletteEntry,
  PaletteProvider,
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
    <SidebarLink
      href={href}
      active={active(href)}
      icon={<GitPullRequest />}
      badge={badge}
    >
      Code
    </SidebarLink>
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

// Pull requests by title, number or branch, once something is typed: open
// ones first, then merged. The palette subscribes only while it is open.
export const codePalette: PaletteProvider = {
  id: "code",
  group: "Pull requests",
  useEntries: (query) => {
    const { organization } = useWorkspace();
    const open = useCodeList("codePullRequest", "open");
    const merged = useCodeList("codePullRequest", "merged");
    const typed = query.length > 0;
    return useMemo(() => {
      if (!typed) return [];
      const org = organization.slug;
      const byUpdate = <T extends { hostUpdatedAt: string }>(rows: T[]) =>
        [...rows].sort((a, b) =>
          b.hostUpdatedAt.localeCompare(a.hostUpdatedAt),
        );
      return [...byUpdate(open.rows), ...byUpdate(merged.rows)].map(
        (pr): PaletteEntry => ({
          id: `pull-request-${pr.id}`,
          label: pr.title,
          hint: `${pr.repositoryFullName}#${pr.number}`,
          icon:
            pr.state === "merged" ? (
              <GitMerge className="size-4" />
            ) : (
              <GitPullRequest className="size-4" />
            ),
          keywords:
            `pull request code #${pr.number} ${pr.headBranch} ${pr.state}`.toLowerCase(),
          href: codePaths.pullRequest(org, pr.id),
        }),
      );
    }, [open.rows, merged.rows, organization.slug, typed]);
  },
};
