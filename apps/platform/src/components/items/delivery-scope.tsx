import { useState } from "react";
import { CheckCheck, GitCompareArrows } from "lucide-react";
import { Button } from "@lictory/ui/button";
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
  return (
    <section className="space-y-2" aria-label="Delivery scope">
      {!embedded && <SectionLabel>Delivery scope</SectionLabel>}
      <div
        className={
          embedded
            ? "space-y-2 text-[13px]"
            : "space-y-2 rounded-lg border bg-card p-3 text-[13px]"
        }
      >
        {item.committedRevisionId ? (
          <p>
            Accepted for delivery:{" "}
            <b>revision {item.committedRevisionNumber ?? "—"}</b>
          </p>
        ) : (
          <p className="text-muted-foreground">
            {closed
              ? "No delivery scope was recorded for this historical item."
              : "Not accepted for delivery yet. Planning an iteration alone is tentative."}
          </p>
        )}
        {item.deliveredRevisionId && (
          <p className="flex items-center gap-1.5">
            <CheckCheck className="size-3.5 text-success" />
            Delivered: revision {item.deliveredRevisionNumber ?? "—"}
          </p>
        )}
        {changed && (
          <div className="space-y-1.5 border-t pt-2">
            <p className="text-warning">
              Revision {current.number} changes the accepted specification.
              {closed
                ? " A new amendment does not change what was delivered."
                : " Accept it to change what the team delivers."}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onCompare(item.committedRevisionId!, current.id)}
            >
              <GitCompareArrows className="size-3.5" /> Compare with accepted
              revision
            </Button>
          </div>
        )}
        {canAccept && (
          <>
            <Button
              size="sm"
              variant={changed ? "secondary" : "outline"}
              disabled={pending || blocked}
              onClick={() => void accept()}
            >
              {pending
                ? "Accepting…"
                : `Accept revision ${current.number} for delivery`}
            </Button>
            {early && (
              <p className="text-xs text-muted-foreground">
                {blocked
                  ? "Complete the readiness checks before accepting this revision."
                  : "Readiness checks are incomplete. Accepting records this exception under the project's readiness policy."}
              </p>
            )}
          </>
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
