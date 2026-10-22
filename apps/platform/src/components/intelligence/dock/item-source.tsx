import { useCallback, useMemo } from "react";
import { identifier } from "@lictory/core/lib/work-items";
import { useItem } from "@lictory/platform/components/items/item-context";
import {
  useAiBlocker,
  useAiRuns,
} from "@lictory/platform/components/review/ai-review";
import {
  usePublishDockItem,
  type DockItem,
} from "@lictory/platform/components/intelligence/dock/store";

// Rendered inside an open work item: tells the dock which item the person is
// looking at and lets it start and follow the item's Lictory Intelligence
// review (the same durable review run as before; findings open in the item).
export function DockItemSource({
  viewing,
  onOpen,
}: {
  viewing: string | null;
  onOpen: (runId: string) => void;
}) {
  const { item, project, reviewable, readOnly, capabilities, mutateConfirmed } =
    useItem();
  const runs = useAiRuns("item_review");
  const aiBlocker = useAiBlocker();
  const allowed =
    capabilities.requestReviews || capabilities.editSpecifications;
  const blocked =
    aiBlocker ??
    (readOnly
      ? "This item is read-only."
      : !allowed
        ? "Your disciplines in this project cannot request reviews."
        : null);
  const request = useCallback(
    () =>
      mutateConfirmed({
        type: "requestAiReview",
        workItemId: item.id,
        runId: crypto.randomUUID(),
      }).then(() => undefined),
    [mutateConfirmed, item.id],
  );
  const key = identifier(project, item.number);
  const title = item.title;
  const value = useMemo<DockItem>(
    () => ({
      id: item.id,
      key,
      title,
      review: reviewable
        ? { runs, blocked, request, open: onOpen, viewing }
        : null,
    }),
    [item.id, key, title, reviewable, runs, blocked, request, onOpen, viewing],
  );
  usePublishDockItem(value);
  return null;
}
