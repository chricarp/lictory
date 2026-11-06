import { BookOpen, Lock } from "lucide-react";
import type {
  Directory,
  SpaceAccessLevel,
} from "@lictory/core/contracts/protocol";
import { cn } from "@lictory/core/lib/utils";
import type { Space } from "@lictory/platform/data/spaces";

// Names and explanations shared by every Spaces surface, so the sidebar, the
// space home, creation and settings describe homes and access the same way.

// A small, recognizable set; a space without one shows a book.
export const spaceIcons = [
  "📘",
  "📚",
  "🧭",
  "🛠️",
  "🧪",
  "💡",
  "📐",
  "🗂️",
  "🧩",
  "🚀",
  "📝",
  "🔐",
] as const;

export function SpaceIcon({
  space,
  className,
}: {
  space: Pick<Space, "icon" | "accessMode">;
  className?: string;
}) {
  // Decorative: the space's name always sits next to it.
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-4 shrink-0 place-items-center text-[13px] leading-none",
        className,
      )}
    >
      {space.icon ? (
        <span>{space.icon}</span>
      ) : (
        <BookOpen className="size-4 text-muted-foreground" />
      )}
      {space.accessMode === "restricted" && (
        <Lock className="absolute -right-1 -bottom-1 size-2.5 rounded-sm bg-background text-muted-foreground" />
      )}
    </span>
  );
}

type Roster = Pick<Directory, "projects" | "teams">;

export type SpaceHome = {
  kind: "organization" | "project" | "team";
  // "Payments", "Checkout team · Payments", or the organization's name.
  label: string;
  projectName?: string;
  teamName?: string;
};

export function homeOf(
  space: Pick<Space, "projectId" | "teamId">,
  roster: Roster,
  organizationName: string,
): SpaceHome {
  const project = roster.projects.find((p) => p.id === space.projectId);
  const team = roster.teams.find((t) => t.id === space.teamId);
  if (space.teamId)
    return {
      kind: "team",
      label: `${team?.name ?? "Team"} · ${project?.name ?? "Project"}`,
      projectName: project?.name ?? "the project",
      teamName: team?.name ?? "the team",
    };
  if (space.projectId)
    return {
      kind: "project",
      label: project?.name ?? "Project",
      projectName: project?.name ?? "the project",
    };
  return { kind: "organization", label: organizationName };
}

// Who gets what from the home while a space is Inherited.
export function inheritedAccess(home: SpaceHome, organizationName: string) {
  switch (home.kind) {
    case "organization":
      return `Everyone in ${organizationName} can edit.`;
    case "project":
      return `Members of ${home.projectName} can edit. Everyone else in ${organizationName} can view.`;
    case "team":
      return `Members of the ${home.teamName} team can edit. Everyone else in ${organizationName} can view.`;
  }
}

export function accessSummary(
  space: Pick<Space, "accessMode" | "projectId" | "teamId">,
  home: SpaceHome,
  organizationName: string,
  grantCount: number,
) {
  const named =
    grantCount === 1
      ? "1 person has named access"
      : `${grantCount} people have named access`;
  if (space.accessMode === "restricted")
    return grantCount
      ? `Restricted: only people with named access can open it. ${named}.`
      : "Restricted: only people with named access can open it.";
  const base = inheritedAccess(home, organizationName);
  return grantCount ? `${base} ${named}.` : base;
}

export const levelLabels: Record<SpaceAccessLevel, string> = {
  view: "Can view",
  comment: "Can comment",
  edit: "Can edit",
};

export const levelDescriptions: Record<SpaceAccessLevel, string> = {
  view: "Read pages and their history.",
  comment: "Read and take part in discussions.",
  edit: "Create, move and publish pages.",
};

export const publishingDescriptions = {
  direct:
    "Editors publish changes straight to the page. Every published version stays in its history.",
  reviewed:
    "Changes are proposed on a branch and published only after a review approves them.",
} as const;

// What open blocking discussions hold back: merging, never a Direct space's
// Publish.
export function blockingEffect(space: Pick<Space, "publishing">) {
  return space.publishing === "reviewed"
    ? "Blocking discussions keep changes to this page from merging until they are resolved."
    : "Blocking discussions keep this page’s pull requests from merging. Publishing is not blocked.";
}

export function blockingSummary(
  space: Pick<Space, "publishing">,
  count: number,
) {
  return space.publishing === "reviewed"
    ? `${count} blocking: blocks merging`
    : `${count} blocking: blocks merging pull requests`;
}
