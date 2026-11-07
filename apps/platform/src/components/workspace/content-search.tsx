import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { callCapability } from "@lictory/core/capabilities/client";
import type { KnowledgeResult } from "@lictory/core/capabilities/product-knowledge";
import type { Highlight } from "@lictory/core/knowledge/snippet";
import {
  useSearchFreshness,
  useVisibleRefresh,
} from "@lictory/platform/components/workspace/search-freshness";

// Server content search for the command palette (searchKnowledge): what
// published pages, specifications and decisions say, beyond the titles the
// palette matches locally. Debounced; answers to an earlier query never
// replace a later one. While the palette is open its answer follows
// synchronized access, publication and item state, and is read again at a
// bounded interval (search-freshness.ts).

export type ContentSearch =
  | { status: "idle"; results: [] }
  | { status: "loading"; results: KnowledgeResult[] }
  | { status: "done"; results: KnowledgeResult[] }
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
            });
        },
        (error: unknown) => {
          if (!current) return;
          // A failed re-read keeps the answer on screen; the next one retries.
          setState((prev) =>
            prev.key === key && prev.search.status === "done"
              ? prev
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
    ? { status: "done", results: shown }
    : state.search;
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
