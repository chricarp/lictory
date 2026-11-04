import { useState } from "react";
import { ListTree, Plus, Trash2 } from "lucide-react";
import {
  isChildChange,
  isNewChild,
  type ChildChange,
  type ProposedChild,
} from "@lictory/core/contracts/decomposition";
import {
  enabledTypes,
  identifier,
  statusOf,
  typeOf,
} from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { SectionLabel } from "@lictory/ui/primitives";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Markdown } from "@lictory/platform/components/items/markdown";

export function BreakdownProposal({
  proposals,
  onChange,
  includeApplied = false,
  accepted = [],
}: {
  proposals: ProposedChild[];
  onChange?: (proposals: ProposedChild[]) => void;
  // Every entry is still pending (already compared with the target).
  includeApplied?: boolean;
  // Main's breakdown: changes it holds were already applied.
  accepted?: ProposedChild[];
}) {
  const { item, type } = useItem();
  const { delivery, items } = useWorkspace();
  const types = enabledTypes(delivery, item.projectId).filter(
    (child) => child.level < type.level,
  );
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const existing = new Set(items.map((child) => child.id));
  const applied = new Set(
    accepted.filter(isChildChange).map((change) => change.changeId),
  );
  const pending = proposals
    .filter(isNewChild)
    .filter((child) => includeApplied || !existing.has(child.workItemId));
  const changes = proposals
    .filter(isChildChange)
    .filter((change) => includeApplied || !applied.has(change.changeId));
  if (!types.length && !pending.length && !changes.length) return null;
  // Nothing proposed and nothing to edit: one quiet line, not a card.
  if (!pending.length && !changes.length && !onChange)
    return (
      <section
        aria-label="Proposed breakdown"
        className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-2.5 text-[13px] text-muted-foreground"
      >
        <ListTree aria-hidden className="size-3.5 shrink-0" />
        No additional children are proposed.
      </section>
    );
  const field =
    "w-full rounded-md border border-input bg-card px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60";
  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-4"
      aria-label="Proposed breakdown"
    >
      <div className="flex items-center gap-2">
        <SectionLabel>Proposed breakdown</SectionLabel>
        <span className="text-xs text-muted-foreground">
          {pending.length} new {pending.length === 1 ? "item" : "items"}
          {changes.length > 0 &&
            `, ${changes.length} ${changes.length === 1 ? "change" : "changes"}`}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        New children and changes to existing children apply only when this pull
        request is approved and merged into main, and only to children nobody
        has changed since. Work already accepted or underway stays unchanged.
      </p>
      {changes.length > 0 && (
        <ul
          className="divide-y rounded-md border"
          aria-label="Changes to existing children"
        >
          {changes.map((change) => (
            <ChangeRow
              key={change.changeId}
              change={change}
              proposals={proposals}
              onRemove={
                onChange &&
                (() =>
                  onChange(
                    proposals.filter(
                      (entry) =>
                        !isChildChange(entry) ||
                        entry.changeId !== change.changeId,
                    ),
                  ))
              }
            />
          ))}
        </ul>
      )}
      {pending.length > 0 && (
        <ul className="divide-y rounded-md border">
          {pending.map((child) => (
            <li key={child.workItemId} className="space-y-2 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {delivery.types.get(child.typeId)?.name ?? "Item"}
                  </p>
                  <p className="text-sm font-medium">{child.title}</p>
                </div>
                {onChange && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove proposed ${child.title}`}
                    onClick={() =>
                      onChange(
                        proposals.filter(
                          (entry) => entry.workItemId !== child.workItemId,
                        ),
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
              {child.description && <Markdown source={child.description} />}
            </li>
          ))}
        </ul>
      )}
      {onChange && types.length > 0 && (
        <div className="space-y-2">
          <label className="block space-y-1 text-xs font-medium">
            Child type
            <select
              aria-label="Proposed child type"
              className={field}
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
            >
              {types.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Title
            <input
              aria-label="Proposed child title"
              className={field}
              value={title}
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="A concrete piece of implementation work"
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Description
            <textarea
              aria-label="Proposed child description"
              className={field}
              value={description}
              maxLength={200_000}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Behavior, scope and acceptance criteria…"
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={
              !title.trim() ||
              !types.some((child) => child.id === typeId) ||
              proposals.filter(isNewChild).length >= 100
            }
            onClick={() => {
              onChange([
                ...proposals,
                {
                  workItemId: crypto.randomUUID(),
                  typeId,
                  title: title.trim(),
                  description,
                },
              ]);
              setTitle("");
              setDescription("");
            }}
          >
            <Plus className="size-3.5" /> Propose child
          </Button>
        </div>
      )}
      {onChange && (
        <ChangeExisting
          proposals={proposals}
          onAdd={(change) => onChange([...proposals, change])}
        />
      )}
    </section>
  );
}

function useChildLabel() {
  const { project } = useItem();
  const { items } = useWorkspace();
  return (id: string | null | undefined, proposals: ProposedChild[]) => {
    const proposed = proposals
      .filter(isNewChild)
      .find((child) => child.workItemId === id);
    if (proposed) return `proposed “${proposed.title}”`;
    const row = items.find((child) => child.id === id);
    return row
      ? `${identifier(project, row.number)} ${row.title}`
      : "an unavailable item";
  };
}

function ChangeRow({
  change,
  proposals,
  onRemove,
}: {
  change: ChildChange;
  proposals: ProposedChild[];
  onRemove?: () => void;
}) {
  const { project } = useItem();
  const { items } = useWorkspace();
  const label = useChildLabel();
  const child = items.find((row) => row.id === change.workItemId);
  const name = child
    ? identifier(project, child.number)
    : change.base.title || "Child";
  const what = [
    change.title !== undefined && `Rename to “${change.title}”`,
    change.description !== undefined && "Replace the description",
    change.parentId === null && "Detach from this parent",
    change.parentId && `Move under ${label(change.parentId, proposals)}`,
    change.archive && "Archive",
  ].filter(Boolean);
  const stale = child && child.revisionId !== change.base.revisionId;
  return (
    <li className="space-y-2 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {name} · {change.base.title}
          </p>
          <p className="text-sm font-medium">{what.join(" · ")}</p>
          {stale && (
            <p className="text-xs text-destructive">
              {name} changed since this was proposed. Merge will refuse this
              change until it is proposed again against the current child.
            </p>
          )}
        </div>
        {onRemove && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Drop the change to ${name}`}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      {change.description !== undefined && (
        <Markdown source={change.description} />
      )}
    </li>
  );
}

type ChangeKind = "rename" | "move" | "detach" | "archive";

function ChangeExisting({
  proposals,
  onAdd,
}: {
  proposals: ProposedChild[];
  onAdd: (change: ChildChange) => void;
}) {
  const { item, project } = useItem();
  const { delivery, items } = useWorkspace();
  const label = useChildLabel();
  const changing = new Set(
    proposals.filter(isChildChange).map((change) => change.workItemId),
  );
  // Children whose delivery has not been accepted or started; the server
  // rechecks this (and hand-off) at merge.
  const children = items.filter(
    (row) =>
      row.parentId === item.id &&
      !row.archivedAt &&
      !row.committedRevisionId &&
      !["started", "done", "canceled"].includes(
        statusOf(delivery, row)?.category ?? "",
      ),
  );
  const [childId, setChildId] = useState("");
  const [kind, setKind] = useState<ChangeKind>("move");
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState("");
  const child = children.find((row) => row.id === childId);
  if (!children.length) return null;
  const plain = child && !typeOf(delivery, child).hasSpecification;
  const level = child ? typeOf(delivery, child).level : 0;
  const parents = [
    ...proposals
      .filter(isNewChild)
      .filter((entry) => (delivery.types.get(entry.typeId)?.level ?? 0) > level)
      .map((entry) => entry.workItemId),
    ...items
      .filter(
        (row) =>
          row.projectId === item.projectId &&
          !row.archivedAt &&
          row.id !== item.id &&
          row.id !== childId &&
          typeOf(delivery, row).level > level,
      )
      .map((row) => row.id),
  ];
  const field =
    "w-full rounded-md border border-input bg-card px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60";
  const ready =
    child &&
    !changing.has(child.id) &&
    (kind === "rename"
      ? plain && title.trim() && title.trim() !== child.title
      : kind === "move"
        ? parents.includes(parentId)
        : true);
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs font-medium">Change an existing child</p>
      <label className="block space-y-1 text-xs font-medium">
        Child
        <select
          aria-label="Existing child"
          className={field}
          value={childId}
          onChange={(event) => setChildId(event.target.value)}
        >
          <option value="">Choose a child…</option>
          {children.map((row) => (
            <option key={row.id} value={row.id} disabled={changing.has(row.id)}>
              {identifier(project, row.number)} {row.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-xs font-medium">
        Change
        <select
          aria-label="Change to the existing child"
          className={field}
          value={kind}
          onChange={(event) => setKind(event.target.value as ChangeKind)}
        >
          <option value="move">Move under another item</option>
          <option value="detach">Detach from this parent</option>
          <option value="archive">Archive</option>
          <option value="rename" disabled={child && !plain}>
            Rename (work without a specification)
          </option>
        </select>
      </label>
      {kind === "rename" && (
        <label className="block space-y-1 text-xs font-medium">
          New title
          <input
            aria-label="New child title"
            className={field}
            value={title}
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      )}
      {kind === "move" && (
        <label className="block space-y-1 text-xs font-medium">
          New parent
          <select
            aria-label="New parent"
            className={field}
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">Choose a parent…</option>
            {parents.map((id) => (
              <option key={id} value={id}>
                {label(id, proposals)}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={!ready}
        onClick={() => {
          if (!child) return;
          onAdd({
            changeId: crypto.randomUUID(),
            workItemId: child.id,
            base: { revisionId: child.revisionId, title: child.title },
            ...(kind === "rename" ? { title: title.trim() } : {}),
            ...(kind === "move" ? { parentId } : {}),
            ...(kind === "detach" ? { parentId: null } : {}),
            ...(kind === "archive" ? { archive: true as const } : {}),
          });
          setChildId("");
          setTitle("");
          setParentId("");
        }}
      >
        <Plus className="size-3.5" /> Propose change
      </Button>
    </div>
  );
}
