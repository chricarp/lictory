import { useCallback, useEffect, useState } from "react";
import { Toggle } from "@ui-sdk/react/toggle";
import { Bell, BellOff } from "lucide-react";
import { buttonClass } from "@lictory/ui/button";
import { DropdownItem } from "@lictory/ui/dropdown";
import { cn } from "@lictory/core/lib/utils";
import { notificationRequest } from "@lictory/platform/components/notifications/client";

// Last known explicit choice per item, so revisiting an item shows its button
// immediately while the request below revalidates it.
const known = new Map<string, boolean | null>();

// Involvement (author, assignee, reviewer, participant) subscribes a person
// implicitly; this lets them opt in without involvement or opt out despite it.
// Requests addressed to them (review requests, mentions) still arrive.
export function WatchButton({
  organizationId,
  workItemId,
  involved,
  appearance = "button",
  className,
}: {
  organizationId: string;
  workItemId: string;
  involved: boolean;
  // A row of a menu (the item header's More menu on phones).
  appearance?: "button" | "menuitem";
  className?: string;
}) {
  const key = `${organizationId}:${workItemId}`;
  const [explicit, setState] = useState<boolean | null | undefined>(() =>
    known.get(key),
  );
  const setExplicit = useCallback(
    (value: boolean | null | undefined) => {
      if (value !== undefined) known.set(key, value);
      setState(value);
    },
    [key],
  );
  useEffect(() => {
    let cancelled = false;
    void notificationRequest<{ watching: boolean | null }>({
      action: "watching",
      organizationId,
      workItemId,
    })
      .then((r) => {
        if (!cancelled) setExplicit(r.watching);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [organizationId, workItemId, setExplicit]);
  if (explicit === undefined) return null;
  const watching = explicit ?? involved;
  const toggle = async () => {
    const next = !watching;
    // Returning to the implicit state keeps later involvement meaningful.
    const value = next === involved ? null : next;
    setExplicit(value);
    try {
      await notificationRequest({
        action: "watch",
        organizationId,
        workItemId,
        watching: value,
      });
    } catch {
      setExplicit(explicit);
    }
  };
  if (appearance === "menuitem")
    return (
      <Toggle
        pressed={watching}
        onPressedChange={() => void toggle()}
        render={<DropdownItem className={className} />}
      >
        {watching ? (
          <Bell className="size-3.5 text-muted-foreground" aria-hidden />
        ) : (
          <BellOff className="size-3.5 text-muted-foreground" aria-hidden />
        )}
        {watching ? "Watching" : "Watch"}
      </Toggle>
    );
  return (
    <Toggle
      pressed={watching}
      onPressedChange={() => void toggle()}
      className={cn(buttonClass({ variant: "ghost", size: "sm" }), className)}
      title={watching ? "Stop watching" : "Get notified about changes"}
    >
      {watching ? (
        <Bell className="size-3.5" />
      ) : (
        <BellOff className="size-3.5" />
      )}
      <span className="max-sm:sr-only @max-[62rem]/frame:sr-only">
        {watching ? "Watching" : "Watch"}
      </span>
    </Toggle>
  );
}
