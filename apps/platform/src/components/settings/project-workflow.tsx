import { useState } from "react";
import { Link } from "@lictory/platform/lib/navigation";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Plus,
  Shapes,
  Workflow,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import {
  activeStatuses,
  categoryMeta,
  categoryOrder,
  type Project,
} from "@lictory/core/lib/work-items";
import {
  labelColors,
  type LabelColor,
  type StatusCategory,
  type WorkflowStatus,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Popover, Picker } from "@lictory/ui/popover";
import { Tooltip } from "@lictory/ui/tooltip";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import { StatusIcon } from "@lictory/platform/components/items/status";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { ColorDot } from "@lictory/platform/components/items/labels";
import {
  SectionError,
  useCommand,
} from "@lictory/platform/components/settings/project-shared";

type Run = ReturnType<typeof useCommand>["run"];

export function ProjectWorkflow({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  return (
    <>
      <StatusesSection project={project} canEdit={canEdit} />
      <TypesSection project={project} canEdit={canEdit} />
    </>
  );
}

function StatusesSection({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { delivery } = useWorkspace();
  const { run, error } = useCommand();
  const statuses = activeStatuses(delivery, project.id);
  const [adding, setAdding] = useState<StatusCategory>();
  const [name, setName] = useState("");
  return (
    <SettingsSection
      id="workflow"
      icon={<Workflow />}
      title="Workflow"
      description="Every item in this project moves through these statuses, whichever team works on it. Statuses belong to fixed categories so boards, reports and readiness mean the same thing everywhere. Any transition is allowed."
    >
      <div className="divide-y">
        {categoryOrder.map((category) => {
          const rows = statuses.filter((s) => s.category === category);
          return (
            <div key={category} className="px-5 py-3">
              <div className="mb-1.5 flex items-center gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {categoryMeta[category].label}
                </p>
                {canEdit && (
                  <button
                    type="button"
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setAdding(category);
                      setName("");
                    }}
                  >
                    <Plus className="inline size-3" /> Add
                  </button>
                )}
              </div>
              {rows.length === 0 && adding !== category && (
                <p className="text-xs text-muted-foreground/70">
                  No statuses in this category.
                </p>
              )}
              <ul className="space-y-1">
                {rows.map((s) => (
                  <StatusRow
                    key={s.id}
                    projectId={project.id}
                    status={s}
                    canEdit={canEdit}
                    run={run}
                    index={statuses.indexOf(s)}
                    statuses={statuses}
                  />
                ))}
              </ul>
              {adding === category && (
                <form
                  className="mt-2 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!name.trim()) return;
                    void run({
                      type: "createStatus",
                      projectId: project.id,
                      statusId: crypto.randomUUID(),
                      name: name.trim(),
                      color: category === "done" ? "green" : "gray",
                      category,
                    });
                    setAdding(undefined);
                  }}
                >
                  <Input
                    autoFocus
                    className="h-8 max-w-xs text-sm"
                    placeholder="Status name"
                    maxLength={40}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-label="New status name"
                  />
                  <Button size="sm" type="submit" disabled={!name.trim()}>
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => setAdding(undefined)}
                  >
                    Cancel
                  </Button>
                </form>
              )}
            </div>
          );
        })}
      </div>
      <SectionError error={error} />
    </SettingsSection>
  );
}

const iconButton =
  "grid size-7 place-items-center rounded hover:bg-muted disabled:opacity-30";

function StatusRow({
  projectId,
  status,
  statuses,
  index,
  canEdit,
  run,
}: {
  projectId: string;
  status: WorkflowStatus;
  statuses: WorkflowStatus[];
  index: number;
  canEdit: boolean;
  run: Run;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(status.name);
  const others = statuses.filter((s) => s.id !== status.id);
  const update = (
    patch: Partial<Pick<WorkflowStatus, "name" | "color" | "category">> & {
      beforeId?: string | null;
    },
  ) =>
    void run({
      type: "updateStatus",
      projectId,
      statusId: status.id,
      ...patch,
    });
  return (
    <li className="group flex h-8 items-center gap-2 text-[13px]">
      <StatusIcon category={status.category} color={status.color} />
      {editing ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== status.name)
              update({ name: name.trim() });
            setEditing(false);
          }}
        >
          <Input
            autoFocus
            className="h-7 max-w-xs text-sm"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Status name"
          />
          <Button size="sm" type="submit">
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => {
              setName(status.name);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <span className="flex-1 truncate">{status.name}</span>
      )}
      {canEdit && !editing && (
        <>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <Popover
              width={180}
              align="end"
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  aria-label={`Color of ${status.name}`}
                  className={iconButton}
                >
                  <ColorDot color={status.color} />
                </button>
              )}
            >
              <Picker
                title="Color"
                hideSearch
                options={labelColors.map((c) => ({
                  value: c,
                  label: c[0]!.toUpperCase() + c.slice(1),
                  icon: <ColorDot color={c} />,
                }))}
                value={status.color}
                onSelect={(color: LabelColor) => update({ color })}
              />
            </Popover>
            <Popover
              width={200}
              align="end"
              trigger={(props) => (
                <Button {...props} size="sm" variant="ghost">
                  {categoryMeta[status.category].label}
                </Button>
              )}
            >
              <Picker
                title="Category"
                hideSearch
                options={categoryOrder.map((c) => ({
                  value: c,
                  label: categoryMeta[c].label,
                }))}
                value={status.category}
                onSelect={(category: StatusCategory) =>
                  category !== status.category && update({ category })
                }
              />
            </Popover>
            <button
              type="button"
              aria-label={`Move ${status.name} up`}
              disabled={index === 0}
              className={iconButton}
              onClick={() => update({ beforeId: statuses[index - 1]!.id })}
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Move ${status.name} down`}
              disabled={index === statuses.length - 1}
              className={iconButton}
              onClick={() =>
                update({ beforeId: statuses[index + 2]?.id ?? null })
              }
            >
              <ArrowDown className="size-3.5" />
            </button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setName(status.name);
                setEditing(true);
              }}
            >
              Rename
            </Button>
          </div>
          <Popover
            width={260}
            align="end"
            disabled={others.length === 0}
            trigger={(props) => (
              <Tooltip label="Archive">
                <Button
                  {...props}
                  size="icon"
                  variant="ghost"
                  aria-label={`Archive status ${status.name}`}
                >
                  <Archive className="size-3.5" />
                </Button>
              </Tooltip>
            )}
          >
            {(close) => (
              <Picker
                title={`Move ${status.name} items to`}
                hideSearch
                options={others.map((s) => ({
                  value: s.id,
                  label: s.name,
                  icon: <StatusIcon category={s.category} color={s.color} />,
                  hint: categoryMeta[s.category].label,
                }))}
                onSelect={(replacementId) => {
                  void run({
                    type: "archiveStatus",
                    projectId,
                    statusId: status.id,
                    replacementId,
                  });
                  close();
                }}
                footer={
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    Items move explicitly and the change is recorded in their
                    activity.
                  </p>
                }
              />
            )}
          </Popover>
        </>
      )}
    </li>
  );
}

function TypesSection({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { delivery, isAdmin, organization } = useWorkspace();
  const { run, error } = useCommand();
  const enabled = delivery.projectTypes.get(project.id) ?? new Set<string>();
  const types = [...delivery.types.values()]
    .filter((t) => !t.archivedAt)
    .sort((a, b) => b.level - a.level || a.position - b.position);
  return (
    <SettingsSection
      id="types"
      icon={<Shapes />}
      title="Work item types"
      description={
        <>
          The kinds of work this project uses. Types with a specification are
          refined, reviewed and checked for readiness; the others are plain
          work. The type list is shared by the organization
          {isAdmin ? (
            <>
              {" "}
              and managed in{" "}
              <Link
                href={paths.settings(organization.slug, "types")}
                className="underline underline-offset-2 hover:text-foreground"
              >
                organization settings
              </Link>
            </>
          ) : (
            " and managed by organization administrators"
          )}
          .
        </>
      }
    >
      <SettingsList isEmpty={types.length === 0} empty="No types.">
        {types.map((t) => (
          <label
            key={t.id}
            className="flex items-center gap-3 px-5 py-2.5 text-[13px]"
          >
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={enabled.has(t.id)}
              onChange={(e) =>
                void run({
                  type: "setProjectType",
                  projectId: project.id,
                  typeId: t.id,
                  enabled: e.target.checked,
                })
              }
            />
            <TypeIcon type={t} />
            <span className="flex-1 font-medium">{t.name}</span>
            <span className="text-xs text-muted-foreground">
              {t.hasSpecification ? "Specification" : "Plain work"}
            </span>
          </label>
        ))}
      </SettingsList>
      <SectionError error={error} />
    </SettingsSection>
  );
}
