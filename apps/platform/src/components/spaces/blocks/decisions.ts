import { useEffect, useSyncExternalStore } from "react";
import { callCapability } from "@lictory/core/capabilities/client";

// Recorded decisions that pages cite, read on demand (`getDecisions`) and
// shared by every decision reference on screen: one batched request per
// frame, cached for the session. Decisions are work item content (every
// member of the organization reads them), so the cache is per organization.

export type PageDecision = {
  id: string;
  title: string;
  excerpt: string;
  archivedAt: string | null;
  key: string | null;
  itemTitle: string | null;
  workItemId: string | null;
  revisionNumber: number | null;
  href: string | null;
};
type Entry =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "failed" }
  | { state: "ready"; decision: PageDecision };

const LOADING: Entry = { state: "loading" };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const queued = new Map<string, Set<string>>();
let scheduled = false;

const keyOf = (organizationId: string, id: string) => `${organizationId}:${id}`;
function emit() {
  for (const listener of listeners) listener();
}
function flush() {
  scheduled = false;
  for (const [organizationId, ids] of queued) {
    queued.delete(organizationId);
    const list = [...ids];
    for (let i = 0; i < list.length; i += 100) {
      const batch = list.slice(i, i + 100);
      callCapability<{ decisions: PageDecision[] }>("getDecisions", {
        organizationId,
        decisionIds: batch,
      })
        .then(({ decisions }) => {
          const found = new Map(decisions.map((d) => [d.id, d]));
          for (const id of batch) {
            const decision = found.get(id);
            entries.set(
              keyOf(organizationId, id),
              decision ? { state: "ready", decision } : { state: "missing" },
            );
          }
        })
        .catch(() => {
          for (const id of batch)
            entries.set(keyOf(organizationId, id), { state: "failed" });
        })
        .finally(emit);
    }
  }
}
function request(organizationId: string, id: string) {
  const key = keyOf(organizationId, id);
  const known = entries.get(key);
  if (known && known.state !== "failed") return;
  entries.set(key, LOADING);
  const ids = queued.get(organizationId) ?? new Set();
  ids.add(id);
  queued.set(organizationId, ids);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useDecision(
  organizationId: string,
  decisionId: string | null,
): Entry {
  useEffect(() => {
    if (decisionId) request(organizationId, decisionId);
  }, [organizationId, decisionId]);
  return useSyncExternalStore(
    subscribe,
    () =>
      (decisionId
        ? entries.get(keyOf(organizationId, decisionId))
        : undefined) ?? LOADING,
    () => LOADING,
  );
}

// A decision just recorded or picked: known without asking again.
export function rememberDecision(
  organizationId: string,
  decision: PageDecision,
) {
  entries.set(keyOf(organizationId, decision.id), {
    state: "ready",
    decision,
  });
  emit();
}
