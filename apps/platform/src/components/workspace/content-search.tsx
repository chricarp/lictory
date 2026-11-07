import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { callCapability } from "@lictory/core/capabilities/client";
import type { KnowledgeResult } from "@lictory/core/capabilities/product-knowledge";
import type { Highlight } from "@lictory/core/knowledge/snippet";
import { relativeTime } from "@lictory/core/lib/work-items";
import {
  useSearchFreshness,
  useVisibleRefresh,
} from "@lictory/platform/components/workspace/search-freshness";

// Server content search for the command palette (searchKnowledge): what
// published pages, specifications and decisions say, beyond the titles the
// palette matches locally. Debounced; answers to an earlier query never
// replace a later one. While the palette is open its answer follows
// synchronized access, publication and item state, and is read again at a
// bounded interval (search-freshness.ts). When reading it again fails, the
// answer stays on screen marked as not checked since it was last read.

export type ContentSearch =
  | { status: "idle"; results: [] }
  | { status: "loading"; results: KnowledgeResult[] }
  | {
      status: "done";
      results: KnowledgeResult[];
      // The last read again failed: when it was last read, and a retry.
      stale?: { checkedAt: number; retry: () => void };
    }
  | { status: "error"; results: []; error: string };

const DEBOUNCE_MS = 250;
export const MIN_CONTENT_QUERY = 2;

export function useContentSearch(
  userId: string,
  organizationId: string,
  query: string,
  enabled: boolean,
): ContentSearch {
  const q = query.trim();
  const active = enabled && q.length >= MIN_CONTENT_QUERY;
  // Answers belong to one person, organization and query: someone else, or
  // another organization with the same words, never sees them, not even
  // while their own loads.
  const scope = `${userId}\n${organizationId}\n`;
  const key = `${scope}${q}`;
  const fresh = useSearchFreshness();
  const factsOf = useRef(fresh.facts);
  useEffect(() => {
    factsOf.current = fresh.facts;
  });
  const [state, setState] = useState<{
    key: string;
    search: ContentSearch;
    // What the synchronized rows said about the results when they were read.
    facts: string;
    // When they were read, and whether reading them again failed since.
    checkedAt?: number;
    stale?: true;
  }>({ key: "", search: { status: "idle", results: [] }, facts: "" });
  // Bumped to read the same query again.
  const [reread, setReread] = useState(0);
  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = setTimeout(() => {
      void callCapability<{ results: KnowledgeResult[] }>("searchKnowledge", {
        organizationId,
        query: q,
        limit: 5,
      }).then(
        ({ results }) => {
          if (current)
            setState({
              key,
              search: { status: "done", results },
              facts: factsOf.current(results),
              checkedAt: Date.now(),
            });
        },
        (error: unknown) => {
          if (!current) return;
          // A failed re-read keeps the answer on screen, marked as not
          // checked; the next one (or Retry) reads again.
          setState((prev) =>
            prev.key === key && prev.search.status === "done"
              ? { ...prev, stale: true }
              : {
                  key,
                  facts: "",
                  search: {
                    status: "error",
                    results: [],
                    error:
                      error instanceof Error
                        ? error.message
                        : "The search failed. Try again.",
                  },
                },
          );
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, organizationId, q, key, reread]);
  const answered = state.key === key && state.search.status === "done";
  const facts = answered ? fresh.facts(state.search.results) : "";
  const changed = answered && facts !== state.facts;
  useEffect(() => {
    if (!changed) return;
    // Shortly, so a burst of changes is one read.
    const timer = setTimeout(() => setReread((n) => n + 1), 300);
    return () => clearTimeout(timer);
  }, [changed, facts]);
  useVisibleRefresh(() => setReread((n) => n + 1), active && answered);
  const shown = useMemo(
    () =>
      state.search.status === "done" ? fresh.visible(state.search.results) : [],
    [state.search, fresh],
  );
  if (!active) return { status: "idle", results: [] };
  // Until this query's answer arrives, the previous query's results (for
  // the same person and organization) stay on screen.
  if (state.key !== key)
    return {
      status: "loading",
      results:
        state.search.status === "done" && state.key.startsWith(scope)
          ? shown
          : [],
    };
  return state.search.status === "done"
    ? {
        status: "done",
        results: shown,
        ...(state.stale && state.checkedAt
          ? {
              stale: {
                checkedAt: state.checkedAt,
                retry: () => setReread((n) => n + 1),
              },
            }
          : {}),
      }
    : state.search;
}

// Search results on screen that could not be checked again: they may no
// longer be true (a decision withdrawn, a page published again). Said in
// text, with when they were last read and a way to read them again.
export function StaleNotice({
  checkedAt,
  onRetry,
}: {
  checkedAt: number;
  onRetry: () => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
      <span>
        Couldn’t refresh · last checked{" "}
        {relativeTime(new Date(checkedAt).toISOString())}
      </span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-sm text-foreground underline decoration-foreground/30 underline-offset-2 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        Retry
      </button>
    </span>
  );
}

// Text with the matched ranges marked.
export function Highlighted({
  text,
  highlights,
}: {
  text: string;
  highlights: readonly Highlight[];
}) {
  if (!highlights.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [i, h] of [...highlights]
    .sort((a, b) => a.start - b.start)
    .entries()) {
    if (h.start < at) continue;
    if (h.start > at)
      parts.push(<Fragment key={`t${i}`}>{text.slice(at, h.start)}</Fragment>);
    parts.push(
      <mark
        key={`m${i}`}
        className="rounded-[3px] bg-primary/15 px-px text-foreground"
      >
        {text.slice(h.start, h.end)}
      </mark>,
    );
    at = h.end;
  }
  if (at < text.length)
    parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}
