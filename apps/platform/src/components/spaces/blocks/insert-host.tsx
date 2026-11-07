import { useId, useState, useSyncExternalStore } from "react";
import { iterationLabel } from "@lictory/core/contracts/protocol";
import { identifier, isTopLevel, typeOf } from "@lictory/core/lib/work-items";
import type { WorkListFilter } from "@lictory/core/spaces/document/schema";
import type { WorkListAttrs } from "@lictory/core/spaces/document/blocks";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { toast } from "@lictory/ui/toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lictory/ui/select";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  Dialog,
  Field,
  RadioCards,
} from "@lictory/platform/components/spaces/dialog";
import {
  blockRequests,
  insertBlockAt,
  type BlockRequest,
} from "@lictory/platform/components/spaces/blocks/insert-store";
import { findBlock } from "@lictory/platform/components/spaces/blocks/anchor";

// The dialog behind "/" → Work list. Mounted once beside
// the page; they insert into the editor that asked, as an ordinary edit of
// its draft (undo removes it).

export function BlockInsertHost({
  defaultProjectId,
}: {
  defaultProjectId: string | null;
}) {
  const request = useSyncExternalStore(
    blockRequests.subscribe,
    blockRequests.get,
    () => null,
  );
  if (!request) return null;
  const close = () => {
    blockRequests.close();
    if (!request.editor.isDestroyed) request.editor.commands.focus();
  };
  return (
    <WorkListDialog
      request={request}
      defaultProjectId={defaultProjectId}
      onClose={close}
    />
  );
}

const filterOptions: {
  value: WorkListFilter;
  label: string;
  description: string;
}[] = [
  {
    value: "epic-children",
    label: "An epic’s work",
    description: "The children of one epic.",
  },
  {
    value: "iteration",
    label: "An iteration",
    description: "Everything planned in a sprint or cycle.",
  },
  {
    value: "label",
    label: "A label",
    description: "Work with one label in a project.",
  },
  {
    value: "referenced",
    label: "Work this page mentions",
    description: "The items this page mentions.",
  },
];

function WorkListDialog({
  request,
  defaultProjectId,
  onClose,
}: {
  request: BlockRequest;
  defaultProjectId: string | null;
  onClose: () => void;
}) {
  const { projects, items, delivery, labels } = useWorkspace();
  const existing = request.existing?.attrs;
  const active = projects.filter((p) => !p.archivedAt);
  const [filter, setFilter] = useState<WorkListFilter>(
    existing?.filter ?? "epic-children",
  );
  const [projectId, setProjectId] = useState<string>(
    existing?.projectId ??
      (active.some((p) => p.id === defaultProjectId)
        ? defaultProjectId!
        : (active[0]?.id ?? "")),
  );
  const [filterId, setFilterId] = useState<string>(existing?.filterId ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const titleId = useId();
  const project = active.find((p) => p.id === projectId);
  const choices = (() => {
    if (filter === "epic-children")
      return items
        .filter(
          (i) =>
            i.projectId === projectId &&
            !i.archivedAt &&
            isTopLevel(typeOf(delivery, i)),
        )
        .map((i) => ({
          value: i.id,
          label: `${identifier(project, i.number)} ${i.title}`,
        }));
    if (filter === "iteration")
      return [...delivery.iterations.values()]
        .filter((i) => i.projectId === projectId)
        .sort((a, b) => b.number - a.number)
        .map((i) => ({
          value: i.id,
          label: `${iterationLabel(i, project?.iterationMode)}${i.state === "active" ? " · active" : i.state === "completed" ? " · completed" : ""}`,
        }));
    if (filter === "label")
      return labels
        .filter((l) => l.projectId === projectId && !l.archivedAt)
        .map((l) => ({ value: l.id, label: l.name }));
    return [];
  })();
  const needsTarget = filter !== "referenced";
  const ready =
    !needsTarget || (projectId && choices.some((c) => c.value === filterId));
  const submit = () => {
    if (!ready) return;
    const attrs: WorkListAttrs = {
      projectId: needsTarget ? projectId : null,
      filter,
      filterId: needsTarget ? filterId : null,
      title: title.trim() || null,
    };
    const { editor } = request;
    blockRequests.close();
    if (editor.isDestroyed) return;
    const { existing } = request;
    if (existing) {
      const changed = editor
        .chain()
        .focus()
        .command(({ tr }) => {
          // The list as it is now: by its id, since others may have moved
          // it (or deleted it) while the dialog was open.
          const pos = existing.id
            ? findBlock(tr.doc, existing.id, "workList")
            : existing.pos;
          const node = pos === undefined ? null : tr.doc.nodeAt(pos);
          if (pos === undefined || node?.type.name !== "workList") return false;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
          return true;
        })
        .run();
      if (!changed)
        toast.add({
          title: "The work list was not changed",
          description:
            "Someone removed it from the draft while you were changing it.",
          type: "error",
        });
    } else insertBlockAt(editor, request.anchor, { type: "workList", attrs });
  };
  const targetLabel =
    filter === "epic-children"
      ? "Epic"
      : filter === "iteration"
        ? "Iteration"
        : "Label";
  return (
    <Dialog
      title={existing ? "Change work list" : "Insert a work list"}
      description="A live, read-only list. Readers see the items as they are now, and only the items they can see."
      onClose={onClose}
      onSubmit={submit}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            {existing ? "Save" : "Insert list"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <RadioCards
          legend="Show"
          name="work-list-filter"
          value={filter}
          options={filterOptions}
          onChange={(value) => {
            setFilter(value);
            setFilterId("");
          }}
        />
        {needsTarget && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project">
              <Select
                value={projectId}
                onValueChange={(value) => {
                  setProjectId(value);
                  setFilterId("");
                }}
              >
                <SelectTrigger aria-label="Project" className="w-full">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={targetLabel}>
              <Select value={filterId} onValueChange={setFilterId}>
                <SelectTrigger
                  aria-label={targetLabel}
                  className="w-full"
                  disabled={!choices.length}
                >
                  <SelectValue
                    placeholder={
                      choices.length
                        ? `Choose ${targetLabel.toLowerCase()}`
                        : `No ${filter === "epic-children" ? "epics" : filter === "iteration" ? "iterations" : "labels"} in this project`
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
        <Field label="Title" htmlFor={titleId} optional>
          <Input
            id={titleId}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Named after what it lists"
            autoComplete="off"
          />
        </Field>
        {project?.deliveryMode === "external" && needsTarget && (
          <p className="text-xs text-muted-foreground">
            {project.name} delivers in its delivery tool: the list shows the
            status read back from there.
          </p>
        )}
      </div>
    </Dialog>
  );
}
