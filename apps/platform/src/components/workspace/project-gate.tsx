import { LoadingState } from "@lictory/ui/spinner";
import { createContext, useContext, type ReactNode } from "react";
import { Link } from "@lictory/platform/lib/navigation";
import { useParams } from "@lictory/platform/lib/navigation";
import { FolderSearch } from "lucide-react";
import { Button } from "@lictory/ui/button";
import { MissingState } from "@lictory/ui/status-page";
import { paths } from "@lictory/core/lib/paths";
import type { Project } from "@lictory/core/lib/work-items";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Onboarding } from "@lictory/platform/components/workspace/onboarding";
import { SampleProjectBanner } from "@lictory/platform/components/workspace/sample-project";
import {
  SyncIssue,
  isSyncBlocked,
} from "@lictory/platform/components/workspace/sync-issue";

const ProjectContext = createContext<Project | null>(null);

// Resolves the `[project]` route segment (a project key) against synchronized
// projects. Unknown keys show a calm not-found state instead of a crash.
export function ProjectGate({ children }: { children: ReactNode }) {
  const params = useParams<{ project: string }>();
  const { projects, view, isAdmin, organization } = useWorkspace();
  const key = params.project?.toUpperCase();
  const project = projects.find((p) => p.key === key);
  if (!project) {
    if (view.status === "hydrating")
      return <LoadingState label="Opening workspace" />;
    if (isSyncBlocked(view.status))
      return <SyncIssue status={view.status} error={view.error} />;
    if (!projects.length) return <Onboarding canCreate={isAdmin} />;
    return (
      <MissingState
        illustration="search"
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
      {project.sample ? (
        <div className="flex h-full min-h-0 flex-col">
          <SampleProjectBanner project={project} />
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
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
