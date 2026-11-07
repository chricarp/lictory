import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "@lictory/platform/lib/navigation";
import { X } from "lucide-react";
import { EpicPicker } from "@lictory/platform/components/items/epic-picker";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { Button } from "@lictory/ui/button";
import { MarkdownEditor } from "@lictory/platform/components/editor/markdown-editor";
import { Kbd } from "@lictory/ui/primitives";
import { Popover, Picker } from "@lictory/ui/popover";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  enabledTypes,
  isTopLevel,
  projectTeams,
  typeOf,
} from "@lictory/core/lib/work-items";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useShell } from "@lictory/platform/components/workspace/shell";

export type QuickCreateOptions = {
  // A proposal starts refinement; work defaults to a lightweight delivery type.
  intent?: "proposal" | "work";
  // Legacy list context remains compatible with existing links.
  kind?: "epic" | "story";
  typeId?: string;
  parentId?: string | null;
  projectId?: string;
  // Optional team of the project; null or absent creates without a team.
  teamId?: string | null;
  statusId?: string;
  iterationId?: string | null;
};

// Title-first creation. Everything else is optional and can be refined later;
// the item exists as soon as the title is submitted (optimistically, then
// confirmed by the server which assigns the authoritative number).
export function QuickCreate({
  options,
  onClose,
}: {
  options: QuickCreateOptions;
  onClose: () => void;
}) {
  const { projects, items, mutate, organization, delivery, capabilitiesIn } =
    useWorkspace();
  const { toast } = useShell();
  const router = useRouter();
  const [projectId, setProjectId] = useState(
    options.projectId ?? projects[0]?.id,
  );
  const project = projects.find((p) => p.id === projectId);
  const capabilities = capabilitiesIn(projectId);
  const activeTeams = projectTeams(delivery, projectId)
    .filter((t) => !t.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [teamId, setTeamId] = useState(options.teamId ?? null);
  const team = activeTeams.find((t) => t.id === teamId);
  // Spec-backed types need specification authoring; plain work only needs
  // property changes.
  const availableTypes = enabledTypes(delivery, projectId).filter((t) =>
    t.hasSpecification
      ? capabilities.editSpecifications
      : capabilities.editSpecifications || capabilities.changeProperties,
  );
  const types = availableTypes.filter(
    (t) => options.intent !== "proposal" || t.hasSpecification,
  );
  const [typeId, setTypeId] = useState(options.typeId);
  const type =
    types.find((t) => t.id === typeId) ??
    (options.intent === "work"
      ? (types.find((t) => !t.hasSpecification && t.level === 1) ??
        types.find((t) => !t.hasSpecification) ??
        // Without plain types, create work the board and backlog show.
        types.find((t) => !isTopLevel(t)))
      : options.kind === "epic"
        ? types.find(isTopLevel)
        : (types.find((t) => t.level === 1 && t.hasSpecification) ??
          types.find((t) => t.level === 1))) ??
    types.find((t) => !isTopLevel(t)) ??
    types[0];
  const [parentId, setParentId] = useState<string | null>(
    options.parentId ?? null,
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const parent = items.find(
    (item) =>
      item.id === parentId &&
      type !== undefined &&
      typeOf(delivery, item).level > type.level &&
      item.projectId === projectId &&
      !item.archivedAt,
  );
  const name = type?.name ?? "item";
  const hasParentTypes = Boolean(
    type && enabledTypes(delivery, projectId).some((t) => t.level > type.level),
  );
  const submit = async (open: boolean) => {
    const trimmed = title.trim();
    if (!trimmed || !project || !type || pending) return;
    const workItemId = crypto.randomUUID();
    const submittedDescription = description.trim();
    setError(undefined);
    setPending(true);
    try {
      await mutate({
        type: "createWorkItem",
        projectId: project.id,
        workItemId,
        typeId: type.id,
        teamId: team?.id ?? null,
        // The parent may have been found in a paginated server search rather
        // than the local list. The server validates its project and hierarchy.
        parentId,
        title: trimmed,
        description: submittedDescription || undefined,
        // Status and iteration only apply in the project they came from.
        ...(options.statusId && project.id === options.projectId
          ? { statusId: options.statusId }
          : {}),
        ...(options.iterationId !== undefined &&
        project.id === options.projectId
          ? { iterationId: options.iterationId }
          : {}),
      });
    } catch (e) {
      setTitle(trimmed);
      setDescription(submittedDescription);
      setError(e instanceof Error ? e.message : "Could not create the item.");
      return;
    } finally {
      setPending(false);
    }
    // A new proposal is a draft: it opens beside the Proposals queue it joins,
    // not beside every item in the project.
    const href = paths.item(
      organization.slug,
      project.key,
      workItemId,
      options.intent === "proposal" && type.hasSpecification
        ? new URLSearchParams({ from: "proposals" })
        : undefined,
    );
    if (open) {
      router.push(href);
      onClose();
      return;
    }
    toast(`${name} “${trimmed}” created`, {
      label: "Open",
      href,
    });
    setCreated((c) => c + 1);
    setTitle("");
    setDescription("");
    inputRef.current?.focus();
  };
  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape bubbles from the dialog's controls; the backdrop is not a control.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[12vh] pb-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button
        aria-label="Close"
        className="absolute inset-0"
        onClick={onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={`Create ${name.toLowerCase()}`}
        className="relative flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-popover shadow-(--shadow-panel)"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(true);
        }}
      >
        <div className="flex shrink-0 items-start gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              {options.intent === "proposal" ? "New proposal" : "New work item"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {options.intent === "proposal"
                ? "Capture the idea. Refine and review it with your team next."
                : "Start with a title. Add the details as you go."}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-4 pb-3">
          {type && (
            <Popover
              width={220}
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  aria-label={`Type: ${type.name}`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium hover:bg-muted/70"
                >
                  <TypeIcon type={type} />
                  {type.name}
                </button>
              )}
            >
              <Picker
                title="Type"
                options={types.map((t) => ({
                  value: t.id,
                  label: t.name,
                  icon: <TypeIcon type={t} />,
                  hint: t.hasSpecification ? "Specification" : undefined,
                }))}
                value={type.id}
                onSelect={(id) => {
                  setTypeId(id);
                  setParentId(null);
                }}
              />
            </Popover>
          )}
          {projects.length > 1 && (
            <Popover
              width={220}
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  aria-label={`Project: ${project?.name ?? "Choose project"}`}
                  className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted"
                >
                  {project?.name ?? "Project"}
                </button>
              )}
            >
              <Picker
                title="Project"
                options={projects.map((p) => ({
                  value: p.id,
                  label: p.name,
                  hint: p.key,
                }))}
                value={projectId}
                onSelect={(id) => {
                  setProjectId(id);
                  setTeamId(null);
                  setTypeId(undefined);
                  setParentId(null);
                }}
              />
            </Popover>
          )}
          {activeTeams.length > 0 && (
            <Popover
              width={220}
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  aria-label={`Team: ${team?.name ?? "No team"}`}
                  className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted"
                >
                  {team?.name ?? "No team"}
                </button>
              )}
            >
              <Picker
                title="Team"
                options={[
                  { value: "none", label: "No team" },
                  ...activeTeams.map((t) => ({ value: t.id, label: t.name })),
                ]}
                value={team?.id ?? "none"}
                onSelect={(v) => setTeamId(v === "none" ? null : v)}
              />
            </Popover>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`${name} title`}
            aria-label="Title"
            className="w-full bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground/60"
          />
          {type && hasParentTypes && projectId && (
            <div className="space-y-1.5 pt-1">
              <p className="text-xs font-medium">
                Parent{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </p>
              <EpicPicker
                key={`${projectId}:${type.id}`}
                parentId={parentId}
                projectId={projectId}
                childTypeId={type.id}
                projectKey={project?.key}
                selected={
                  parent
                    ? {
                        id: parent.id,
                        projectId: parent.projectId,
                        typeId: parent.typeId,
                        number: parent.number,
                        title: parent.title,
                      }
                    : undefined
                }
                onChange={setParentId}
              />
              <p className="text-[11px] text-muted-foreground">
                Link this {name.toLowerCase()} to the larger piece of work it
                contributes to.
              </p>
            </div>
          )}
          <div className="space-y-1.5 pt-1">
            <p className="text-xs font-medium">
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </p>
            <MarkdownEditor
              value={description}
              onValueChange={setDescription}
              placeholder={
                type?.hasSpecification
                  ? "What problem should this solve? Describe expected behavior, acceptance criteria and important failure cases… (Markdown)"
                  : "What needs to be done… (Markdown)"
              }
              aria-label="Description"
              compact
              minHeight="6rem"
              maxHeight="20rem"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {type?.hasSpecification
              ? "Capture a proposal now and refine it with the team. Creating it does not commit it to delivery."
              : "This item goes to delivery. If it has a parent specification, that specification’s readiness still applies."}
          </p>
          {!type && project && (
            <p className="text-xs text-muted-foreground">
              {options.intent === "proposal" && availableTypes.length
                ? "No specification types are enabled for your disciplines in this project. Choose a project with a specification type to create a proposal."
                : `Your disciplines in ${project.name} cannot create work items. Ask a project administrator for a discipline that edits specifications or changes properties.`}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          {created > 0 && <span>{created} created</span>}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={!title.trim() || !type || pending}
            onClick={() => void submit(false)}
          >
            Create another
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!title.trim() || !type || pending}
          >
            {pending ? "Creating…" : "Create & open"}{" "}
            <span aria-hidden="true">
              <Kbd>↵</Kbd>
            </span>
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex h-7 items-center rounded-md bg-muted p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium",
            value === o.value
              ? "bg-card text-foreground shadow-(--shadow-border)"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
