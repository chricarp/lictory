"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useWorkspace } from "./provider";
import { Onboarding } from "./onboarding";
import type { Project } from "~/lib/work-items";

const ProjectContext = createContext<Project | null>(null);

// Resolves the `[project]` route segment (a project key) against synchronized
// projects. Unknown keys show a calm not-found state instead of a crash.
export function ProjectGate({ children }: { children: ReactNode }) {
  const params = useParams<{ project: string }>();
  const { projects, view, isAdmin } = useWorkspace();
  const key = params.project?.toUpperCase();
  const project = projects.find((p) => p.key === key);
  if (!project) {
    if (view.status === "hydrating" || view.status === "syncing")
      return (
        <div className="p-8 text-sm text-muted-foreground" role="status">
          Opening workspace…
        </div>
      );
    if (!projects.length)
      return <Onboarding step="project" canCreate={isAdmin} />;
    return (
      <div className="p-8">
        <h1 className="text-sm font-medium">Project {key} was not found</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Choose another project from the sidebar.
        </p>
      </div>
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
