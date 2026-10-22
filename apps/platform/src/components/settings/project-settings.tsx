import type { ReactNode } from "react";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import {
  ReadOnlyNotice,
  SettingsLayout,
  type SettingsNavItem,
} from "@lictory/platform/components/workspace/settings-section";
import { LabelsAndMilestones } from "@lictory/platform/components/workspace/labels-settings";
import { IntelligenceContextSection } from "@lictory/platform/components/intelligence/context-settings";
import { paths } from "@lictory/core/lib/paths";
import { ProjectGeneral } from "@lictory/platform/components/settings/project-general";
import { ProjectMembers } from "@lictory/platform/components/settings/project-members";
import { ProjectDisciplines } from "@lictory/platform/components/settings/project-disciplines";
import { ProjectTeams } from "@lictory/platform/components/settings/project-teams";
import { ProjectWorkflow } from "@lictory/platform/components/settings/project-workflow";
import { ProjectReadiness } from "@lictory/platform/components/settings/project-readiness";
import { ProjectPlanning } from "@lictory/platform/components/settings/project-planning";
import { ProjectDelivery } from "@lictory/platform/components/settings/project-delivery";
import { plural } from "@lictory/platform/components/settings/project-shared";

const sections = [
  { id: "general", label: "General", group: "Project" },
  { id: "members", label: "Members", group: "People" },
  { id: "disciplines", label: "Disciplines", group: "People" },
  { id: "teams", label: "Teams", group: "People" },
  { id: "workflow", label: "Workflow & types", group: "Work" },
  { id: "readiness", label: "Readiness", group: "Work" },
  { id: "planning", label: "Planning", group: "Work" },
  { id: "delivery", label: "Delivery", group: "Work" },
  { id: "labels", label: "Labels & milestones", group: "Work" },
  {
    id: "context",
    label: "Intelligence context",
    group: "Lictory Intelligence",
  },
] as const;
type SectionId = (typeof sections)[number]["id"];

// The header and section navigation live in the settings layout so they stay
// mounted while people move between sections; only the section re-renders.
export function ProjectSettingsLayout({ children }: { children: ReactNode }) {
  const project = useProject();
  const { organization, directory } = useWorkspace();
  const members = directory.projectMembers.filter(
    (m) => m.projectId === project.id,
  ).length;
  const nav: SettingsNavItem[] = sections.map((s) => ({
    id: s.id,
    label: s.label,
    group: s.group,
    href: paths.projectSettings(organization.slug, project.key, s.id),
  }));
  return (
    <SettingsLayout
      icon={
        <span className="grid h-9 min-w-9 place-items-center rounded-lg bg-muted px-1.5 font-mono text-[11px] font-semibold tracking-wide">
          {project.key}
        </span>
      }
      title={project.name}
      subtitle={`Project settings · ${plural(members, "member")}`}
      nav={nav}
    >
      {children}
    </SettingsLayout>
  );
}

export function ProjectSettingsSection({ section }: { section: string }) {
  const project = useProject();
  const { canManage, capabilitiesIn } = useWorkspace();
  const active: SectionId = sections.some((s) => s.id === section)
    ? (section as SectionId)
    : "general";
  const canEdit = canManage(project.id);
  const canEditLabels =
    canEdit ||
    (!project.archivedAt && capabilitiesIn(project.id).changeProperties);
  const readOnly =
    active === "labels" ? !canEditLabels : active !== "context" && !canEdit;
  return (
    <>
      {readOnly && (
        <ReadOnlyNotice>
          {active === "labels"
            ? "You can view this project's labels and milestones. Project administrators and people whose discipline changes properties can edit them."
            : "You can view this project's settings. Project administrators and organization administrators can change them."}
        </ReadOnlyNotice>
      )}
      {active === "general" && (
        <ProjectGeneral project={project} canEdit={canEdit} />
      )}
      {active === "members" && (
        <ProjectMembers project={project} canEdit={canEdit} />
      )}
      {active === "disciplines" && (
        <ProjectDisciplines project={project} canEdit={canEdit} />
      )}
      {active === "teams" && (
        <ProjectTeams project={project} canEdit={canEdit} />
      )}
      {active === "workflow" && (
        <ProjectWorkflow project={project} canEdit={canEdit} />
      )}
      {active === "readiness" && (
        <ProjectReadiness project={project} canEdit={canEdit} />
      )}
      {active === "planning" && (
        <ProjectPlanning project={project} canEdit={canEdit} />
      )}
      {active === "delivery" && (
        <ProjectDelivery project={project} canEdit={canEdit} />
      )}
      {active === "labels" && (
        <LabelsAndMilestones project={project} canEdit={canEditLabels} />
      )}
      {active === "context" && (
        <IntelligenceContextSection
          pinned={{ scope: "project", projectId: project.id }}
        />
      )}
    </>
  );
}
