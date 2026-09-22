"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "~/components/workspace/provider";
import { Onboarding } from "~/components/workspace/onboarding";
import { SyncIssue, isSyncBlocked } from "~/components/workspace/sync-issue";
import { paths } from "~/lib/paths";
import { useLastProjectKey } from "~/lib/last-project";

// Organization root: reopen the project this person last worked in (or the
// first project), or create the first project.
export default function OrganizationIndex() {
  const { organization, projects, view, isAdmin } = useWorkspace();
  const router = useRouter();
  const lastKey = useLastProjectKey(organization.id);
  const target = projects.find((p) => p.key === lastKey) ?? projects[0];
  useEffect(() => {
    if (target)
      router.replace(paths.list(organization.slug, target.key, "epics"));
  }, [target, organization.slug, router]);
  if (target || view.status === "hydrating") return null;
  if (isSyncBlocked(view.status))
    return <SyncIssue status={view.status} error={view.error} />;
  return <Onboarding step="project" canCreate={isAdmin} />;
}
