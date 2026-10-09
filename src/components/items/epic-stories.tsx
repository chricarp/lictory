"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { GripVertical, Plus } from "lucide-react";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import {
  byPosition,
  enabledTypes,
  identifier,
  isClosedCategory,
  categoryOf,
  segmentOf,
  typeOf,
} from "~/lib/work-items";
import { Popover, Picker } from "~/components/ui/popover";
import { Button } from "~/components/ui/button";
import { SectionLabel } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import { IssueStatus } from "./status";
import { IssueIdentifier } from "./identifier";
import { ReviewSignal } from "./signals";
import { AssigneePicker } from "./properties";
import { TypeIcon } from "./icons";
import { useItem } from "./item-context";

// Children of an item (Stories in an Epic, Subtasks in a Task): compact,
// editable in place, and creatable without leaving the parent. Order is manual:
// drag the handle, or use Alt+↑/↓ on a focused row. Decomposing a
// specification records the revision each child was derived from.
export function EpicStories() {
  const { item, project, canEdit, canChangeProperties } = useItem();
  const { items, organization, mutate, delivery } = useWorkspace();
  const parentType = typeOf(delivery, item);
  const childTypes = enabledTypes(delivery, item.projectId).filter(
    (t) => t.level < parentType.level,
  );
  // Default to the richest child type one level down (Story under Epic).
  const [childTypeId, setChildTypeId] = useState<string>();
  const childType =
    childTypes.find((t) => t.id === childTypeId) ??
    childTypes.find((t) => t.level === parentType.level - 1) ??
    childTypes[0];
  const [title, setTitle] = useState("");
  const [composing, setComposing] = useState(false);
  const stories = useMemo(
    () =>
      items
        .filter((i) => i.parentId === item.id && !i.archivedAt)
        .sort(byPosition),
    [items, item.id],
  );
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<{
    id: string | null;
    edge: "before" | "after";
  }>();
  const move = (storyId: string, beforeId: string | null) => {
    const index = stories.findIndex((s) => s.id === storyId);
    const target = beforeId
      ? stories.findIndex((s) => s.id === beforeId)
      : stories.length;
    if (index === -1 || target === index || target === index + 1) return;
    void mutate({ type: "reorderWorkItem", workItemId: storyId, beforeId });
  };
  const nudge = (storyId: string, direction: -1 | 1) => {
    const index = stories.findIndex((s) => s.id === storyId);
    const swap = stories[index + direction];
    if (!swap) return;
    move(
      storyId,
      direction === -1 ? swap.id : (stories[index + 2]?.id ?? null),
    );
  };
  const done = stories.filter((s) =>
    isClosedCategory(categoryOf(delivery, s)),
  ).length;
  const specs = stories.filter((s) => s.refinementState !== null);
  const ready = specs.filter((s) => s.refinementState === "ready").length;
  const stale = stories.filter(
    (s) =>
      s.sourceRevisionId &&
      item.revisionId &&
      s.sourceRevisionId !== item.revisionId,
  ).length;
  const create = async () => {
    const trimmed = title.trim();
    if (!trimmed || !childType) return;
    // Clear before awaiting so a title typed meanwhile is never wiped.
    setTitle("");
    await mutate({
      type: "createWorkItem",
      projectId: item.projectId,
      workItemId: crypto.randomUUID(),
      typeId: childType.id,
      teamId: item.teamId,
      parentId: item.id,
      title: trimmed,
    });
  };
  if (!childTypes.length && stories.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Children</SectionLabel>
        {stories.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {done}/{stories.length} done
            {specs.length > 0 && ` · ${ready}/${specs.length} ready`}
            {item.childEstimate > 0 && ` · ${item.childEstimate} pts`}
          </span>
        )}
        {stale > 0 && (
          <span
            className="text-xs text-amber-700 dark:text-amber-400"
            title="These children were derived from an earlier revision of this specification. Review whether they still match."
          >
            {stale} from an earlier revision
          </span>
        )}
        {canEdit && !composing && childType && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setComposing(true)}
          >
            <Plus className="size-3.5" /> Add {childType.name.toLowerCase()}
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-md border">
        {stories.length === 0 && !composing && (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">
            Nothing here yet. Break this {parentType.name.toLowerCase()} into
            concrete work the team can implement.
          </p>
        )}
        <ul className="divide-y">
          {stories.map((story) => (
            <li
              key={story.id}
              draggable={canChangeProperties}
              onDragStart={(e) => {
                setDragging(story.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", story.id);
              }}
              onDragEnd={() => {
                setDragging(undefined);
                setOver(undefined);
              }}
              onDragOver={(e) => {
                if (!dragging || dragging === story.id) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setOver({
                  id: story.id,
                  edge:
                    e.clientY < rect.top + rect.height / 2 ? "before" : "after",
                });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!dragging || !over) return;
                const index = stories.findIndex((s) => s.id === story.id);
                move(
                  dragging,
                  over.edge === "before"
                    ? story.id
                    : (stories[index + 1]?.id ?? null),
                );
                setDragging(undefined);
                setOver(undefined);
              }}
              onKeyDown={(e) => {
                if (
                  e.altKey &&
                  (e.key === "ArrowUp" || e.key === "ArrowDown")
                ) {
                  e.preventDefault();
                  nudge(story.id, e.key === "ArrowUp" ? -1 : 1);
                }
              }}
              className={cn(
                "group relative flex h-9 items-center gap-2 px-2 text-[13px] hover:bg-muted/50",
                dragging === story.id && "opacity-40",
                over?.id === story.id &&
                  over.edge === "before" &&
                  "shadow-[inset_0_2px_0_0_var(--color-primary)]",
                over?.id === story.id &&
                  over.edge === "after" &&
                  "shadow-[inset_0_-2px_0_0_var(--color-primary)]",
              )}
            >
              {canChangeProperties && (
                <button
                  type="button"
                  aria-label={`Reorder ${story.title} (Alt+Arrow keys)`}
                  title="Drag to reorder · Alt+↑/↓"
                  className="relative z-10 -ml-1 grid size-5 cursor-grab place-items-center rounded text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 active:cursor-grabbing"
                  onKeyDown={(e) => {
                    if (
                      e.altKey &&
                      (e.key === "ArrowUp" || e.key === "ArrowDown")
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                      nudge(story.id, e.key === "ArrowUp" ? -1 : 1);
                    }
                  }}
                >
                  <GripVertical className="size-3.5" />
                </button>
              )}
              <span className="relative z-10">
                <IssueStatus
                  projectId={story.projectId}
                  statusId={story.statusId}
                  compact
                  onChange={
                    canChangeProperties
                      ? (statusId) =>
                          void mutate({
                            type: "updateWorkItem",
                            workItemId: story.id,
                            statusId,
                          })
                      : undefined
                  }
                />
              </span>
              <TypeIcon type={typeOf(delivery, story)} />
              <IssueIdentifier
                project={project}
                number={story.number}
                className="w-16"
              />
              <Link
                href={paths.item(
                  organization.slug,
                  project.key,
                  segmentOf(typeOf(delivery, story)),
                  identifier(project, story.number),
                  new URLSearchParams({ epic: item.id }),
                )}
                className="min-w-0 flex-1 truncate font-medium after:absolute after:inset-0 after:content-['']"
              >
                {story.title}
              </Link>
              <ReviewSignal item={story} />
              <span className="relative z-10">
                <AssigneePicker
                  assigneeId={story.assigneeId}
                  compact
                  onChange={
                    canChangeProperties
                      ? (assigneeId) =>
                          void mutate({
                            type: "updateWorkItem",
                            workItemId: story.id,
                            assigneeId,
                          })
                      : undefined
                  }
                />
              </span>
            </li>
          ))}
        </ul>
        {composing && (
          <form
            className="flex items-center gap-2 border-t bg-muted/30 px-2 py-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            {childTypes.length > 1 && childType && (
              <Popover
                width={200}
                trigger={(props) => (
                  <button
                    {...props}
                    type="button"
                    aria-label={`Type: ${childType.name}`}
                    className="grid size-7 place-items-center rounded-md hover:bg-muted"
                  >
                    <TypeIcon type={childType} />
                  </button>
                )}
              >
                <Picker
                  title="Type"
                  options={childTypes.map((t) => ({
                    value: t.id,
                    label: t.name,
                    icon: <TypeIcon type={t} />,
                  }))}
                  value={childType.id}
                  onSelect={setChildTypeId}
                />
              </Popover>
            )}
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setComposing(false);
                  setTitle("");
                }
              }}
              placeholder={`${childType?.name ?? "Item"} title — Enter to add another, Esc to finish`}
              aria-label={`New ${childType?.name.toLowerCase() ?? "item"} title`}
              className="h-7 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
            />
            <Button type="submit" size="sm" disabled={!title.trim()}>
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setComposing(false)}
            >
              Done
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
