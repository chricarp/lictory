"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "~/components/workspace/provider";
import { Onboarding } from "~/components/workspace/onboarding";
import { SyncIssue, isSyncBlocked } from "~/components/workspace/sync-issue";
import { paths } from "~/lib/paths";

// Organization root: Lictory Intelligence is the home page. A brand-new
// organization without projects first creates its first project.
export default function OrganizationIndex() {
  const { organization, projects, view, isAdmin } = useWorkspace();
  const router = useRouter();
  const ready = projects.length > 0;
  useEffect(() => {
    if (ready) router.replace(paths.intelligence(organization.slug));
  }, [ready, organization.slug, router]);
  if (ready || view.status === "hydrating") return null;
  if (isSyncBlocked(view.status))
    return <SyncIssue status={view.status} error={view.error} />;
  return <Onboarding canCreate={isAdmin} />;
}
