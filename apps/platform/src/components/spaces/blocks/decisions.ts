import { useCallback, useEffect, useSyncExternalStore } from "react";
import { callCapability } from "@lictory/core/capabilities/client";

// Recorded decisions that pages cite, read on demand (`getDecisions`) and
// shared by every decision reference on screen: one batched request per
// frame. Decisions are work item content (every member of the organization
// reads them), so the cache is per person and organization, and dropped
// when either changes. A decision can be archived (withdrawn from active
// knowledge) or restored at any time, so what is on screen is read again
// when the window regains focus or becomes visible and at a bounded interval
// while it is visible. A failed first read offers a retry; a failed refresh
// keeps what was read (offline is no reason to hide a decision) but marks
// it stale with when it was last checked, so the card never presents an
// unchecked state as current.

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
  | {
      state: "ready";
      decision: PageDecision;
      // When the server last confirmed it (ms since the epoch).
      checkedAt: number;
      // The last refresh failed: what is shown may no longer be current.
      stale?: true;
    };

// Read again while visible, and on focus when older than this.
export const DECISION_REFRESH_MS = 60_000;
const FOCUS_STALE_MS = 5_000;

const LOADING: Entry = { state: "loading" };
let scope = "";
const entries = new Map<string, Entry>();
const fetchedAt = new Map<string, number>();
const inFlight = new Set<string>();
// Decision ids on screen, with how many references show each.
const shown = new Map<string, number>();
const listeners = new Set<() => void>();
const queued = new Set<string>();
let scheduled = false;
let organizationOfScope = "";

function emit() {
  for (const listener of listeners) listener();
}

// Another person or organization: nothing read for the previous one is
// shown or kept.
function enter(userId: string, organizationId: string) {
  const next = `${userId}:${organizationId}`;
  if (next === scope) return;
  scope = next;
  organizationOfScope = organizationId;
  entries.clear();
  fetchedAt.clear();
  inFlight.clear();
  queued.clear();
}

function flush() {
  scheduled = false;
  const ids = [...queued];
  queued.clear();
  const requestScope = scope;
  const organizationId = organizationOfScope;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    for (const id of batch) inFlight.add(id);
    callCapability<{ decisions: PageDecision[] }>("getDecisions", {
      organizationId,
      decisionIds: batch,
    })
      .then(({ decisions }) => {
        if (requestScope !== scope) return;
        const found = new Map(decisions.map((d) => [d.id, d]));
        const now = Date.now();
        for (const id of batch) {
          const decision = found.get(id);
          entries.set(
            id,
            decision
              ? { state: "ready", decision, checkedAt: now }
              : { state: "missing" },
          );
          fetchedAt.set(id, now);
        }
      })
      .catch(() => {
        if (requestScope !== scope) return;
        // A refresh that fails keeps what was read, marked stale; a first
        // read fails.
        for (const id of batch) {
          const known = entries.get(id);
          entries.set(
            id,
            known?.state === "ready"
              ? { ...known, stale: true }
              : { state: "failed" },
          );
        }
      })
      .finally(() => {
        if (requestScope !== scope) return;
        for (const id of batch) inFlight.delete(id);
        emit();
      });
  }
}

function request(id: string, maxAge: number) {
  if (inFlight.has(id) || queued.has(id)) return;
  const known = entries.get(id);
  const age = Date.now() - (fetchedAt.get(id) ?? 0);
  if (
    known &&
    known.state !== "failed" &&
    !(known.state === "ready" && known.stale) &&
    age < maxAge
  )
    return;
  // A refresh keeps showing what was read until the answer arrives.
  if (!known || known.state === "failed") {
    entries.set(id, LOADING);
    emit();
  }
  queued.add(id);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}

function refreshShown(maxAge: number) {
  if (document.visibilityState !== "visible") return;
  for (const id of shown.keys()) request(id, maxAge);
}

// One timer and one pair of listeners while any decision is on screen.
let timer: ReturnType<typeof setInterval> | undefined;
const onFocus = () => refreshShown(FOCUS_STALE_MS);
function watch() {
  if (timer) return;
  timer = setInterval(
    () => refreshShown(DECISION_REFRESH_MS - 1000),
    DECISION_REFRESH_MS,
  );
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
}
function unwatch() {
  if (!timer || shown.size) return;
  clearInterval(timer);
  timer = undefined;
  window.removeEventListener("focus", onFocus);
  document.removeEventListener("visibilitychange", onFocus);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useDecision(
  userId: string,
  organizationId: string,
  decisionId: string | null,
): Entry & { retry: () => void } {
  enter(userId, organizationId);
  useEffect(() => {
    if (!decisionId) return;
    enter(userId, organizationId);
    shown.set(decisionId, (shown.get(decisionId) ?? 0) + 1);
    watch();
    request(decisionId, Infinity);
    return () => {
      const n = (shown.get(decisionId) ?? 1) - 1;
      if (n > 0) shown.set(decisionId, n);
      else shown.delete(decisionId);
      unwatch();
    };
  }, [userId, organizationId, decisionId]);
  const entry = useSyncExternalStore(
    subscribe,
    () => (decisionId ? entries.get(decisionId) : undefined) ?? LOADING,
    () => LOADING,
  );
  const retry = useCallback(() => {
    if (decisionId) request(decisionId, 0);
  }, [decisionId]);
  return { ...entry, retry };
}
