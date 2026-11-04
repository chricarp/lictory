import { useState } from "react";
import { CheckCheck, GitCompareArrows, TriangleAlert } from "lucide-react";
import { Button } from "@lictory/ui/button";
import { cn } from "@lictory/core/lib/utils";
import { SectionLabel } from "@lictory/ui/primitives";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { categoryOf } from "@lictory/core/lib/work-items";

// Readiness qualifies a revision; accepting scope records the team's decision
// to deliver it. Later amendments never silently replace that agreement.
export function DeliveryScope({
  onCompare,
  embedded = false,
}: {
  onCompare: (from: string, to: string) => void;
  embedded?: boolean;
}) {
  const {
    item,
    project,
    current,
    canChangeProperties,
    readOnly,
    base,
    mutateConfirmed,
    reviewable,
  } = useItem();
  const { delivery } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (project.deliveryMode !== "native" || !current) return null;
  const category = categoryOf(delivery, item);
  const closed = category === "done" || category === "canceled";
  const changed = Boolean(
    item.committedRevisionId && item.committedRevisionId !== current.id,
  );
  const canAccept =
    !closed &&
    !readOnly &&
    canChangeProperties &&
    item.committedRevisionId !== current.id;
  const blocked =
    reviewable &&
    item.refinementState !== "ready" &&
    project.readinessPolicy === "block";
  const early = reviewable && item.refinementState !== "ready";
  const accept = async () => {
    setPending(true);
    setError(undefined);
    try {
      await mutateConfirmed({ type: "acceptDeliveryScope", ...base });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The revision was not accepted for delivery.",
      );
    } finally {
      setPending(false);
    }
  };
  // Embedded in the item workflow, the accepted revision is already named in
  // its Delivery row.
  const status = item.committedRevisionId ? (
    embedded ? null : (
      <p className="text-muted-foreground">
        Accepted for delivery:{" "}
        <span className="font-medium text-foreground">
          revision {item.committedRevisionNumber ?? "—"}
        </span>
      </p>
    )
  ) : (
    <p className="text-muted-foreground">
      {closed
        ? "No delivery scope was recorded for this historical item."
        : "Not accepted for delivery yet. Planning an iteration alone is tentative."}
    </p>
  );
  // Accepting before the checks pass is allowed by policy, but it is an
  // exception and must look like one.
  const exception = canAccept && early && !blocked;
  const actions = (changed || canAccept) && (
    <div className="flex flex-wrap items-center gap-1.5">
      {changed && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onCompare(item.committedRevisionId!, current.id)}
        >
          <GitCompareArrows className="size-3.5" /> Compare with accepted
          revision
        </Button>
      )}
      {canAccept && (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || blocked}
          className={cn(
            exception &&
              "text-warning shadow-[0_0_0_1px_color-mix(in_srgb,var(--warning)_40%,transparent)] hover:bg-warning/10",
          )}
          onClick={() => void accept()}
        >
          {exception && <TriangleAlert aria-hidden className="size-3.5" />}
          {pending
            ? "Accepting…"
            : `Accept revision ${current.number} for delivery`}
        </Button>
      )}
    </div>
  );
  return (
    <section className="space-y-2" aria-label="Delivery scope">
      {!embedded && <SectionLabel>Delivery scope</SectionLabel>}
      <div
        className={
          embedded
            ? "space-y-2 text-[13px]"
            : "space-y-2.5 rounded-lg border bg-card p-3 text-[13px]"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-64 space-y-1">
            {status}
            {item.deliveredRevisionId && (
              <p className="flex items-center gap-1.5">
                <CheckCheck className="size-3.5 text-success" />
                Delivered: revision {item.deliveredRevisionNumber ?? "—"}
              </p>
            )}
            {changed && (
              <p className="flex items-start gap-1.5 text-[13px] text-foreground">
                <TriangleAlert
                  aria-hidden
                  className="mt-px size-3.5 shrink-0 text-warning"
                />
                <span>
                  Revision {current.number} changes the accepted specification.
                  {closed
                    ? " A new amendment does not change what was delivered."
                    : " Accept it to change what the team delivers."}
                </span>
              </p>
            )}
          </div>
          {embedded && actions}
        </div>
        {!embedded && actions}
        {canAccept && early && (
          <p
            className={cn(
              "text-xs leading-relaxed",
              blocked ? "text-muted-foreground" : "text-warning",
            )}
            title={
              blocked
                ? undefined
                : "The project's readiness policy allows accepting before every check passes; the exception is recorded with the decision."
            }
          >
            {blocked
              ? "Complete the readiness checks before accepting this revision."
              : "Readiness checks are incomplete: accepting now records an exception."}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
