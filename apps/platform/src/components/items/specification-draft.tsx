import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { byType } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { useItem } from "@lictory/platform/components/items/item-context";
import type { LiveSpecificationProps } from "@lictory/platform/components/items/live-specification";

// Opens a specification line's live draft (docs/internals/specification-drafts.md)
// and mounts the live editor, which is its own chunk: readers never load
// Yjs, the collaboration provider or the editor. The draft's document name
// comes from the item's synchronized state (`specDraft`); a line without
// an open draft is opened once through the domain command.

const LiveSpecificationDraft = lazy(
  () => import("@lictory/platform/components/items/live-specification"),
);

// The open draft of a line (main when `branchId` is undefined).
export function useSpecificationDraft(branchId?: string) {
  const { entities } = useItem();
  return byType(entities, "specDraft").find(
    (d) => (d.branchId ?? undefined) === branchId,
  );
}

export function SpecificationDraftEditor({
  branchId,
  ...props
}: Omit<LiveSpecificationProps, "line"> & {
  branchId?: string;
  line: Omit<LiveSpecificationProps["line"], "draft">;
}) {
  const { item, mutateConfirmed } = useItem();
  const draft = useSpecificationDraft(branchId);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const opening = useRef(false);
  useEffect(() => {
    if (draft || opening.current) return;
    opening.current = true;
    mutateConfirmed({
      type: "openSpecificationDraft",
      workItemId: item.id,
      ...(branchId ? { branchId } : {}),
    })
      .catch((e: unknown) =>
        setError(
          e instanceof Error ? e.message : "The live draft could not open.",
        ),
      )
      .finally(() => {
        opening.current = false;
      });
  }, [draft, item.id, branchId, mutateConfirmed, attempt]);
  if (!draft && error)
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3 py-2 text-[13px]"
      >
        <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
        <p className="min-w-0 flex-1 basis-60">{error}</p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setError(undefined);
            setAttempt((n) => n + 1);
          }}
        >
          <RefreshCw className="size-3.5" aria-hidden /> Try again
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Close editor
        </Button>
      </div>
    );
  if (!draft) return <Opening />;
  return (
    <Suspense fallback={<Opening />}>
      <LiveSpecificationDraft {...props} line={{ ...props.line, draft }} />
    </Suspense>
  );
}

function Opening() {
  return (
    <p aria-busy="true" className="py-2 text-xs text-muted-foreground">
      Opening the live draft…
    </p>
  );
}
