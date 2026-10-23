import { useState } from "react";
import { Link } from "@lictory/platform/lib/navigation";
import { Archive, ArchiveRestore, Plus, ShieldCheck } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import type { Project } from "@lictory/core/lib/work-items";
import {
  capabilityKeys,
  noCapabilities,
  type Capabilities,
  type Discipline,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Badge } from "@lictory/ui/primitives";
import { Tooltip } from "@lictory/ui/tooltip";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import {
  SectionError,
  plural,
  useCommand,
} from "@lictory/platform/components/settings/project-shared";

export const capabilityMeta: Record<
  keyof Capabilities,
  { label: string; description: string }
> = {
  editSpecifications: {
    label: "Edit specifications",
    description:
      "Create spec-backed items, revise the main specification, restore revisions and merge suggestions.",
  },
  changeProperties: {
    label: "Change properties",
    description:
      "Status, priority, owner, parent, labels, milestones, iterations, ordering and archiving.",
  },
  requestReviews: {
    label: "Request reviews",
    description: "Ask a discipline to review a revision, or cancel a request.",
  },
  review: {
    label: "Can be asked to review",
    description:
      "Reviews can be requested from this discipline; its members decide them.",
  },
  publishDelivery: {
    label: "Hand off to delivery tools",
    description:
      "Export ready work to this project's Jira project and link existing issues.",
  },
};

export function ProjectDisciplines({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { directory, organization } = useWorkspace();
  const { run, error } = useCommand();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const all = directory.disciplines.filter((d) => d.projectId === project.id);
  const archived = all.filter((d) => d.archivedAt);
  const shown = all.filter((d) => showArchived || !d.archivedAt);
  return (
    <SettingsSection
      id="disciplines"
      icon={<ShieldCheck />}
      title="Disciplines"
      description={
        <>
          The kinds of work people do in this project. Each discipline decides
          what its members may do with work items, and reviews are requested
          from disciplines. People get the combined abilities of their
          disciplines.{" "}
          <Link
            href={paths.projectSettings(
              organization.slug,
              project.key,
              "members",
            )}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Assign people
          </Link>
        </>
      }
      action={
        canEdit && !creating ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-3.5" /> Add discipline
          </Button>
        ) : undefined
      }
      footer="Renaming or archiving a discipline never rewrites past reviews: they keep the name they were requested under."
    >
      {creating && (
        <NewDiscipline
          onCancel={() => setCreating(false)}
          onCreate={async (draft) => {
            const ok = await run({
              type: "createDiscipline",
              projectId: project.id,
              disciplineId: crypto.randomUUID(),
              ...draft,
            });
            if (ok) setCreating(false);
          }}
        />
      )}
      <SettingsList isEmpty={shown.length === 0} empty="No disciplines yet.">
        {shown.map((d) => (
          <DisciplineRow
            key={d.id}
            discipline={d}
            canEdit={canEdit}
            update={(patch) =>
              void run({
                type: "updateDiscipline",
                projectId: project.id,
                disciplineId: d.id,
                ...patch,
              })
            }
          />
        ))}
      </SettingsList>
      {archived.length > 0 && (
        <div className="border-t px-5 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </Button>
        </div>
      )}
      <SectionError error={error} />
    </SettingsSection>
  );
}

function CapabilityToggles({
  value,
  disabled,
  onChange,
  name,
}: {
  value: Capabilities;
  disabled: boolean;
  onChange: (next: Capabilities) => void;
  name: string;
}) {
  return (
    <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
      {capabilityKeys.map((key) => (
        <label
          key={key}
          title={capabilityMeta[key].description}
          className={cn(
            "flex items-start gap-2 text-[13px]",
            disabled && "cursor-default",
          )}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={disabled}
            checked={value[key]}
            aria-label={`${name}: ${capabilityMeta[key].label}`}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />
          <span>
            {capabilityMeta[key].label}
            <span className="block text-xs text-muted-foreground">
              {capabilityMeta[key].description}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

function DisciplineRow({
  discipline: d,
  canEdit,
  update,
}: {
  discipline: Discipline;
  canEdit: boolean;
  update: (patch: {
    name?: string;
    description?: string | null;
    capabilities?: Capabilities;
    archived?: boolean;
  }) => void;
}) {
  const editable = canEdit && !d.archivedAt;
  return (
    <div className={cn("space-y-3 px-5 py-4", d.archivedAt && "opacity-70")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <input
              key={d.name}
              defaultValue={d.name}
              disabled={!editable}
              maxLength={60}
              aria-label={`Discipline name ${d.name}`}
              className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 text-[13px] font-semibold outline-none focus:bg-muted enabled:hover:bg-muted touch:text-base"
              onBlur={(e) => {
                const name = e.currentTarget.value.trim();
                if (name && name !== d.name) update({ name });
                else e.currentTarget.value = d.name;
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            {d.archivedAt && <Badge>Archived</Badge>}
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {plural(d.userIds.length, "member")}
            </span>
          </div>
          <input
            key={d.description ?? ""}
            defaultValue={d.description ?? ""}
            disabled={!editable}
            maxLength={500}
            placeholder={editable ? "Add a description" : "No description"}
            aria-label={`Description of ${d.name}`}
            className="h-7 w-full rounded-md bg-transparent px-1 text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-muted enabled:hover:bg-muted touch:text-base"
            onBlur={(e) => {
              const description = e.currentTarget.value.trim() || null;
              if (description !== (d.description ?? null))
                update({ description });
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
        {canEdit && (
          <Tooltip label={d.archivedAt ? "Restore" : "Archive"}>
            <Button
              size="icon"
              variant="ghost"
              aria-label={
                d.archivedAt
                  ? `Restore discipline ${d.name}`
                  : `Archive discipline ${d.name}`
              }
              onClick={() => update({ archived: !d.archivedAt })}
            >
              {d.archivedAt ? (
                <ArchiveRestore className="size-3.5" />
              ) : (
                <Archive className="size-3.5" />
              )}
            </Button>
          </Tooltip>
        )}
      </div>
      <div className="pl-1">
        <CapabilityToggles
          name={d.name}
          value={d.capabilities}
          disabled={!editable}
          onChange={(capabilities) => update({ capabilities })}
        />
      </div>
    </div>
  );
}

function NewDiscipline({
  onCreate,
  onCancel,
}: {
  onCreate: (draft: {
    name: string;
    description?: string;
    capabilities: Capabilities;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capabilities, setCapabilities] = useState<Capabilities>({
    ...noCapabilities,
    review: true,
  });
  return (
    <form
      className="space-y-3 border-b bg-muted/40 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void onCreate({
          name: name.trim(),
          description: description.trim() || undefined,
          capabilities,
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Input
          autoFocus
          className="h-8 w-48 text-sm"
          placeholder="Name, e.g. Security"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Discipline name"
        />
        <Input
          className="h-8 min-w-0 flex-1 text-sm"
          placeholder="What this discipline looks after (optional)"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Discipline description"
        />
      </div>
      <CapabilityToggles
        name="New discipline"
        value={capabilities}
        disabled={false}
        onChange={setCapabilities}
      />
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={!name.trim()}>
          Create discipline
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
