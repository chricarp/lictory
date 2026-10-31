import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ProposedChild } from "@lictory/core/contracts/decomposition";
import { enabledTypes } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { SectionLabel } from "@lictory/ui/primitives";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Markdown } from "@lictory/platform/components/items/markdown";

export function BreakdownProposal({
  proposals,
  onChange,
  includeApplied = false,
}: {
  proposals: ProposedChild[];
  onChange?: (proposals: ProposedChild[]) => void;
  includeApplied?: boolean;
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
  const pending = proposals.filter(
    (child) => includeApplied || !existing.has(child.workItemId),
  );
  if (!types.length && !pending.length) return null;
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
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        These children become shared work only when this pull request is
        approved and merged into main. Existing children stay unchanged.
      </p>
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
              proposals.length >= 100
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
      {!pending.length && !onChange && (
        <p className="text-sm text-muted-foreground">
          No additional children are proposed.
        </p>
      )}
    </section>
  );
}
