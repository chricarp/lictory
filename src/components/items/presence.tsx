"use client";
import { useEffect, useState } from "react";
import {
  announcePresence,
  presenceFor,
  subscribePresence,
  PRESENCE_TTL,
} from "~/sync/client/hub";
import { Avatar } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";

// "Anna and Marco are viewing this Story." Best-effort and ephemeral: it never
// affects correctness, and disappears when heartbeats stop.
export function Presence({ itemId }: { itemId: string }) {
  const { organization, userId, memberName } = useWorkspace();
  const [viewers, setViewers] = useState<string[]>([]);
  useEffect(() => {
    const update = () =>
      setViewers(
        presenceFor(organization.id, itemId).filter((id) => id !== userId),
      );
    const unsubscribe = subscribePresence(organization.id, update);
    const expiry = setInterval(update, PRESENCE_TTL / 3);
    void announcePresence(organization.id, itemId);
    const heartbeat = setInterval(
      () => void announcePresence(organization.id, itemId),
      20_000,
    );
    update();
    return () => {
      unsubscribe();
      clearInterval(expiry);
      clearInterval(heartbeat);
      void announcePresence(organization.id, null);
    };
  }, [organization.id, itemId, userId]);
  if (!viewers.length) return null;
  const names = viewers.map((id) => memberName(id));
  const text =
    names.length === 1
      ? `${names[0]} is viewing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are viewing`
        : `${names[0]} and ${names.length - 1} others are viewing`;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      title={names.join(", ")}
    >
      <span className="flex -space-x-1">
        {viewers.slice(0, 3).map((id) => (
          <Avatar
            key={id}
            name={memberName(id)}
            size="xs"
            className="ring-1 ring-background"
          />
        ))}
      </span>
      <span className="hidden sm:inline">{text}</span>
    </span>
  );
}
