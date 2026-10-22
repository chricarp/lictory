"use client";
import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@lictory/ui/button";
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
}: {
  organizationId: string;
  workItemId: string;
  involved: boolean;
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
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={watching}
      title={
        watching
          ? "You get notifications about changes to this item. Click to stop."
          : "Get notified about changes to this item."
      }
      onClick={() => void toggle()}
    >
      {watching ? (
        <Bell className="size-3.5" />
      ) : (
        <BellOff className="size-3.5" />
      )}
      {watching ? "Watching" : "Watch"}
    </Button>
  );
}
