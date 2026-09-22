"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { EpicPicker } from "~/components/items/epic-picker";
import { KindIcon } from "~/components/items/icons";
import { Button } from "~/components/ui/button";
import { MarkdownEditor } from "~/components/ui/markdown-editor";
import { Kbd } from "~/components/ui/primitives";
import { Popover, Picker } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import type { WorkItemKind } from "~/sync/shared/protocol";
import { useWorkspace } from "./provider";
import { useShell } from "./shell";

export type QuickCreateOptions = {
  kind?: WorkItemKind;
  parentId?: string | null;
  projectId?: string;
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
  const { projects, items, mutate, organization } = useWorkspace();
  const { toast } = useShell();
  const router = useRouter();
  const [kind, setKind] = useState<WorkItemKind>(options.kind ?? "story");
  const [projectId, setProjectId] = useState(
    options.projectId ?? projects[0]?.id,
  );
  const [parentId, setParentId] = useState<string | null>(
    options.parentId ?? null,
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const project = projects.find((p) => p.id === projectId);
  const parent = items.find(
    (item) =>
      item.id === parentId &&
      item.kind === "epic" &&
      item.projectId === projectId &&
      !item.archivedAt,
  );
  const submit = async (open: boolean) => {
    const trimmed = title.trim();
    if (!trimmed || !project) return;
    const workItemId = crypto.randomUUID();
    const submittedDescription = description.trim();
    setError(undefined);
    if (!open) {
      setTitle("");
      setDescription("");
    }
    try {
      await mutate({
        type: "createWorkItem",
        projectId: project.id,
        workItemId,
        kind,
        parentId: kind === "epic" ? null : parentId,
        title: trimmed,
        description: submittedDescription || undefined,
      });
    } catch (e) {
      setTitle(trimmed);
      setDescription(submittedDescription);
      setError(e instanceof Error ? e.message : "Could not create the item.");
      return;
    }
    const href = paths.item(
      organization.slug,
      project.key,
      kind === "epic" ? "epics" : "stories",
      workItemId,
    );
    if (open) {
      router.push(href);
      onClose();
      return;
    }
    toast(`${kind === "epic" ? "Epic" : "Story"} “${trimmed}” created`, {
      label: "Open",
      href,
    });
    setCreated((c) => c + 1);
    inputRef.current?.focus();
  };
  return createPortal(
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
        aria-label={`Create ${kind}`}
        className="relative flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-popover shadow-[var(--shadow-panel)]"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2">
          <Segmented
            value={kind}
            onChange={(next) => {
              setKind(next);
              if (next === "epic") setParentId(null);
            }}
            options={[
              {
                value: "epic",
                label: "Epic",
                icon: <KindIcon kind="epic" />,
              },
              {
                value: "story",
                label: "Story",
                icon: <KindIcon kind="story" />,
              },
            ]}
          />
          {projects.length > 1 && (
            <Popover
              width={220}
              trigger={(props) => (
                <button
                  {...props}
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
                  setParentId(null);
                }}
              />
            </Popover>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "epic" ? "Epic title" : "Story title"}
            aria-label="Title"
            className="w-full bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground/60"
          />
          {kind !== "epic" && projectId && (
            <div className="space-y-1.5 pt-1">
              <p className="text-xs font-medium">Epic</p>
              <EpicPicker
                parentId={parentId}
                projectId={projectId}
                projectKey={project?.key}
                selected={
                  parent
                    ? {
                        id: parent.id,
                        projectId: parent.projectId,
                        number: parent.number,
                        title: parent.title,
                      }
                    : undefined
                }
                onChange={setParentId}
              />
              <p className="text-[11px] text-muted-foreground">
                Optional. Link this story to the epic it contributes to.
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
              placeholder="Intent, problem or first draft of the behavior… (Markdown)"
              aria-label="Description"
              rows={5}
              autoResize
              maxAutoHeight={320}
              containerClassName="bg-muted/30"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          {created > 0 && <span>{created} created</span>}
          <span className="ml-auto flex items-center gap-1">
            <Kbd>↵</Kbd> create
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!title.trim()}
            onClick={() => void submit(true)}
          >
            Create & open
          </Button>
          <Button type="submit" size="sm" disabled={!title.trim()}>
            Create {kind === "epic" ? "Epic" : "Story"}
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
              ? "bg-card text-foreground shadow-[var(--shadow-border)]"
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
