"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { paths } from "~/lib/paths";
import { identifier, statusOrder } from "~/lib/work-items";
import { Button } from "~/components/ui/button";
import { SectionLabel } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import { IssueStatus } from "./status";
import { IssueIdentifier } from "./identifier";
import { ReviewSignal } from "./signals";
import { AssigneePicker } from "./properties";
import { useItem } from "./item-context";

// Stories inside an Epic: compact, information-dense, editable in place, and
// creatable without leaving the Epic. Ordering follows status, then identifier.
export function EpicStories() {
  const { item, product, readOnly } = useItem();
  const { items, organization, mutate } = useWorkspace();
  const [title, setTitle] = useState("");
  const [composing, setComposing] = useState(false);
  const stories = useMemo(
    () =>
      items
        .filter((i) => i.parentId === item.id && !i.archivedAt)
        .sort(
          (a, b) =>
            statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) ||
            a.number - b.number,
        ),
    [items, item.id],
  );
  const ready = stories.filter((s) =>
    ["ready", "in_progress", "done"].includes(s.status),
  ).length;
  const create = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    // Clear before awaiting so a title typed meanwhile is never wiped.
    setTitle("");
    await mutate({
      type: "createWorkItem",
      productId: item.productId,
      workItemId: crypto.randomUUID(),
      kind: "story",
      parentId: item.id,
      title: trimmed,
    });
  };
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Stories</SectionLabel>
        {stories.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {ready}/{stories.length} ready
          </span>
        )}
        {!readOnly && !composing && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setComposing(true)}
          >
            <Plus className="size-3.5" /> Add story
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-md border">
        {stories.length === 0 && !composing && (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">
            No stories yet. Break the Epic into concrete behavior engineering
            can implement.
          </p>
        )}
        <ul className="divide-y">
          {stories.map((story) => (
            <li
              key={story.id}
              className="group relative flex h-9 items-center gap-2 px-2 text-[13px] hover:bg-muted/50"
            >
              <span className="relative z-10">
                <IssueStatus
                  status={story.status}
                  compact
                  onChange={(status) =>
                    void mutate({
                      type: "updateWorkItem",
                      workItemId: story.id,
                      status,
                    })
                  }
                />
              </span>
              <IssueIdentifier
                product={product}
                number={story.number}
                className="w-16"
              />
              <Link
                href={paths.item(
                  organization.slug,
                  product.key,
                  "stories",
                  identifier(product, story.number),
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
                  onChange={(assigneeId) =>
                    void mutate({
                      type: "updateWorkItem",
                      workItemId: story.id,
                      assigneeId,
                    })
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
              placeholder="Story title — Enter to add another, Esc to finish"
              aria-label="New story title"
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
