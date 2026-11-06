import { useId } from "react";
import { cn } from "@lictory/core/lib/utils";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Field } from "@lictory/platform/components/spaces/dialog";
import { spaceIcons } from "@lictory/platform/components/spaces/space-meta";

// Form fields shared by space creation and space settings.

export type HomeChoice = {
  kind: "organization" | "project" | "team";
  projectId: string | null;
  teamId: string | null;
};

export function homeChoice(
  projectId: string | null,
  teamId: string | null,
): HomeChoice {
  if (projectId && teamId) return { kind: "team", projectId, teamId };
  if (projectId) return { kind: "project", projectId, teamId: null };
  return { kind: "organization", projectId: null, teamId: null };
}

const encode = (home: HomeChoice) =>
  home.kind === "organization"
    ? "organization"
    : home.kind === "project"
      ? `project:${home.projectId}`
      : `team:${home.projectId}:${home.teamId}`;
function decode(value: string): HomeChoice {
  const [kind, projectId = null, teamId = null] = value.split(":");
  return kind === "team"
    ? { kind: "team", projectId, teamId }
    : kind === "project"
      ? { kind: "project", projectId, teamId: null }
      : { kind: "organization", projectId: null, teamId: null };
}

// One picker for the whole home: the organization, an active project, or an
// active team of a project. A current home that was archived stays listed so
// the control shows the truth.
export function HomeFields({
  value,
  onChange,
  disabled,
  hint,
}: {
  value: HomeChoice;
  onChange: (home: HomeChoice) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const { organization, projects, directory } = useWorkspace();
  const id = useId();
  const listed = directory.projects.filter(
    (p) => !p.archivedAt || p.id === value.projectId,
  );
  const ordered = [...listed].sort((a, b) => a.name.localeCompare(b.name));
  const teamsOf = (projectId: string) =>
    directory.teams
      .filter(
        (t) =>
          t.projectId === projectId && (!t.archivedAt || t.id === value.teamId),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  // Projects only from the synchronized list when the directory is empty.
  const options = ordered.length ? ordered : projects;
  return (
    <Field
      label="Home"
      htmlFor={id}
      hint={
        hint ??
        "Where the space appears in navigation. Members of a project or team home can edit; everyone else can view."
      }
    >
      <DropdownSelect
        id={id}
        className="w-full"
        disabled={disabled}
        value={encode(value)}
        onValueChange={(next) => onChange(decode(next))}
      >
        <DropdownSelectOption value="organization">
          {organization.name} (organization)
        </DropdownSelectOption>
        {options.flatMap((project) => [
          <DropdownSelectOption
            key={project.id}
            value={`project:${project.id}`}
          >
            {project.name}
          </DropdownSelectOption>,
          ...teamsOf(project.id).map((team) => (
            <DropdownSelectOption
              key={team.id}
              value={`team:${project.id}:${team.id}`}
            >
              {`${team.name} team · ${project.name}`}
            </DropdownSelectOption>
          )),
        ])}
      </DropdownSelect>
    </Field>
  );
}

export function IconField({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const choices: { value: string | null; label: string }[] = [
    { value: null, label: "None" },
    ...spaceIcons.map((icon) => ({ value: icon, label: icon })),
  ];
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1.5 text-xs font-medium">Icon</legend>
      <div className="flex flex-wrap gap-1">
        {choices.map((choice) => (
          <label
            key={choice.label}
            className={cn(
              "grid h-8 min-w-8 cursor-pointer place-items-center rounded-full px-2 text-[15px] shadow-(--shadow-border) has-focus-visible:ring-2 has-focus-visible:ring-ring/60",
              choice.value === null && "text-xs text-muted-foreground",
              value === choice.value
                ? "bg-primary/8 ring-1 ring-primary/50"
                : "hover:bg-muted",
            )}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
