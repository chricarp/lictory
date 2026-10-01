"use client";
import { LoadingState } from "~/components/ui/spinner";
import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FolderSearch } from "lucide-react";
import { Button } from "~/components/ui/button";
import { MissingState } from "~/components/ui/status-page";
import { paths } from "~/lib/paths";
import type { Project } from "~/lib/work-items";
import { useWorkspace } from "./provider";
import { Onboarding } from "./onboarding";
import { SyncIssue, isSyncBlocked } from "./sync-issue";

const ProjectContext = createContext<Project | null>(null);

// Resolves the `[project]` route segment (a project key) against synchronized
// projects. Unknown keys show a calm not-found state instead of a crash.
export function ProjectGate({ children }: { children: ReactNode }) {
  const params = useParams<{ project: string }>();
  const { projects, view, isAdmin, organization } = useWorkspace();
  const key = params.project?.toUpperCase();
  const project = projects.find((p) => p.key === key);
  if (!project) {
    if (view.status === "hydrating" || view.status === "syncing")
      return <LoadingState label="Opening workspace" />;
    if (isSyncBlocked(view.status))
      return <SyncIssue status={view.status} error={view.error} />;
    if (!projects.length)
      return <Onboarding step="project" canCreate={isAdmin} />;
    return (
      <MissingState
        icon={FolderSearch}
        title={key ? `Project ${key} was not found` : "Project was not found"}
        action={
          <Link href={paths.inbox(organization.slug)} className="contents">
            <Button variant="secondary">Go to Inbox</Button>
          </Link>
        }
      >
        It may have been archived, or the key is misspelled. Choose another
        project from the sidebar.
      </MissingState>
    );
  }
  return (
    <ProjectContext.Provider value={project}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const project = useContext(ProjectContext);
  if (!project) throw new Error("useProject requires a project route.");
  return project;
}
export function useOptionalProject() {
  return useContext(ProjectContext);
}
