import { useId, useRef } from "react";
import { BookOpen } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Popover, usePopover } from "@lictory/ui/popover";
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
  legend = "Icon",
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
  disabled?: boolean;
  legend?: string;
}) {
  const name = useId();
  const choices: { value: string | null; label: string }[] = [
    { value: null, label: "None" },
    ...spaceIcons.map((icon) => ({ value: icon, label: icon })),
  ];
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1.5 text-xs font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((choice) => (
          <label
            key={choice.label}
            className={cn(
              "relative grid h-9 min-w-9 cursor-pointer place-items-center rounded-full border border-transparent px-2 text-[17px] transition-[background-color,box-shadow] duration-150 ease-out has-focus-visible:ring-2 has-focus-visible:ring-ring/60 has-disabled:cursor-default",
              choice.value === null && "px-3 text-xs text-muted-foreground",
              value === choice.value
                ? "bg-card text-foreground shadow-[0_0_0_2px_var(--foreground)]"
                : "shadow-(--shadow-border) hover:bg-muted",
            )}
          >
            <input
              type="radio"
              name={name}
              className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-full opacity-0"
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

// The icon as one compact control beside the name: the current icon opens
// the choices.
export function IconPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
}) {
  return (
    <Popover
      width={300}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={value ? `Icon: ${value}` : "Icon: none"}
          title="Choose an icon"
          className="grid size-10 shrink-0 place-items-center rounded-xl border border-input bg-card text-xl shadow-xs transition-[background-color,scale] duration-150 ease-out outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.96]"
        >
          {value ?? (
            <BookOpen className="size-4 text-muted-foreground" aria-hidden />
          )}
        </button>
      )}
    >
      {(close) => (
        <IconPickerBody value={value} onChange={onChange} onPicked={close} />
      )}
    </Popover>
  );
}

// A pointer pick closes the choices; arrow keys only move the choice, so
// a keyboard closes them with Escape or Tab.
function IconPickerBody({
  value,
  onChange,
  onPicked,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
  onPicked: () => void;
}) {
  const labelId = usePopover()?.labelId;
  const pointer = useRef(false);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- only records whether the pick came from a pointer; the radios are the controls.
    <div
      className="p-3"
      onPointerDown={() => (pointer.current = true)}
      onKeyDown={() => (pointer.current = false)}
    >
      <h2 id={labelId} className="sr-only">
        Choose an icon
      </h2>
      <IconField
        value={value}
        legend="Space icon"
        onChange={(icon) => {
          onChange(icon);
          if (pointer.current) onPicked();
        }}
      />
    </div>
  );
}
