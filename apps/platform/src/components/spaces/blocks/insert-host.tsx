import { useEffect, useId, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/core";
import { BookOpen } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { iterationLabel } from "@lictory/core/contracts/protocol";
import { identifier, isTopLevel, typeOf } from "@lictory/core/lib/work-items";
import { cn } from "@lictory/core/lib/utils";
import type { WorkListFilter } from "@lictory/core/spaces/document/schema";
import type { WorkListAttrs } from "@lictory/core/spaces/document/blocks";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
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
import { rememberDecision } from "@lictory/platform/components/spaces/blocks/decisions";

// The dialogs behind "/" → Decision and "/" → Work list. Mounted once beside
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
  return request.kind === "decision" ? (
    <DecisionPicker request={request} onClose={close} />
  ) : (
    <WorkListDialog
      request={request}
      defaultProjectId={defaultProjectId}
      onClose={close}
    />
  );
}

type DecisionResult = {
  kind: string;
  id: string;
  title: string;
  excerpt: string;
  key: string;
  revisionNumber: number | null;
  href: string;
};

function insertDecision(editor: Editor, at: number, d: DecisionResult) {
  const node = {
    type: "decisionRef",
    attrs: { decisionId: d.id, label: d.title },
  };
  const $at = editor.state.doc.resolve(
    Math.min(at, editor.state.doc.content.size),
  );
  // Alone on its line: a card. Inside a sentence: a chip.
  if ($at.parent.isTextblock && $at.parent.content.size === 0)
    insertBlockAt(editor, at, { type: "paragraph", content: [node] });
  else
    editor
      .chain()
      .focus()
      .insertContentAt(at, [node, { type: "text", text: " " }])
      .run();
}

function DecisionPicker({
  request,
  onClose,
}: {
  request: Extract<BlockRequest, { kind: "decision" }>;
  onClose: () => void;
}) {
  const { organization } = useWorkspace();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DecisionResult[] | null>(null);
  const [error, setError] = useState<string>();
  const [active, setActive] = useState(0);
  const listId = useId();
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      callCapability<{ results: DecisionResult[] }>("searchProductKnowledge", {
        organizationId: organization.id,
        query,
        kinds: ["decision"],
        limit: 20,
      })
        .then((r) => {
          if (!current) return;
          setResults(r.results.filter((x) => x.kind === "decision"));
          setActive(0);
          setError(undefined);
        })
        .catch((e: unknown) => {
          if (current)
            setError(
              e instanceof Error ? e.message : "Decisions could not be found.",
            );
        });
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [organization.id, query]);
  const choose = (d: DecisionResult) => {
    rememberDecision(organization.id, {
      id: d.id,
      title: d.title,
      excerpt: d.excerpt,
      archivedAt: null,
      key: d.key,
      itemTitle: null,
      workItemId: null,
      revisionNumber: d.revisionNumber,
      href: d.href,
    });
    blockRequests.close();
    insertDecision(request.editor, request.at, d);
  };
  const list = results ?? [];
  return (
    <Dialog
      title="Insert a decision"
      description="Show a decision recorded on a work item. Its text stays with the work item; the page shows it as it is now."
      onClose={onClose}
      width="max-w-md"
    >
      <div className="space-y-2">
        <Input
          data-autofocus
          role="combobox"
          aria-label="Find a decision"
          aria-expanded={list.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            list[active] ? `${listId}-${active}` : undefined
          }
          value={query}
          placeholder="Search recorded decisions"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!list.length) return;
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((i) => (i + step + list.length) % list.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (list[active]) choose(list[active]);
            }
          }}
        />
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : results === null ? (
          <p className="px-1 py-3 text-[13px] text-muted-foreground">
            Searching…
          </p>
        ) : list.length ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="Decisions"
            className="max-h-72 space-y-0.5 overflow-y-auto"
          >
            {list.map((d, index) => (
              // Keys are handled by the search field (aria-activedescendant).
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={d.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(d)}
                className={cn(
                  "flex cursor-pointer gap-2.5 rounded-lg px-2 py-2 text-[13px]",
                  index === active && "bg-muted",
                )}
              >
                <BookOpen
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <span className="font-mono">{d.key}</span>
                    {d.revisionNumber !== null &&
                      ` · revision ${d.revisionNumber}`}
                    {d.excerpt && ` · ${d.excerpt}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 py-3 text-[13px] text-muted-foreground">
            {query.trim()
              ? "No recorded decisions match."
              : "No decisions have been recorded yet. Record them in a work item’s Decisions section."}
          </p>
        )}
      </div>
    </Dialog>
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
    label: "Work on this page",
    description: "The items this page mentions.",
  },
];

function WorkListDialog({
  request,
  defaultProjectId,
  onClose,
}: {
  request: Extract<BlockRequest, { kind: "workList" }>;
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
    if (request.existing)
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          const node = tr.doc.nodeAt(request.existing!.pos);
          if (node?.type.name !== "workList") return false;
          tr.setNodeMarkup(request.existing!.pos, undefined, {
            ...node.attrs,
            ...attrs,
          });
          return true;
        })
        .run();
    else insertBlockAt(editor, request.at, { type: "workList", attrs });
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
