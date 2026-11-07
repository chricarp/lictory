import { Fragment, useEffect, useState } from "react";
import { callCapability } from "@lictory/core/capabilities/client";
import type { KnowledgeResult } from "@lictory/core/capabilities/product-knowledge";
import type { Highlight } from "@lictory/core/knowledge/snippet";

// Server content search for the command palette (searchKnowledge): what
// published pages, specifications and decisions say, beyond the titles the
// palette matches locally. Debounced; answers to an earlier query never
// replace a later one.

export type ContentSearch =
  | { status: "idle"; results: [] }
  | { status: "loading"; results: KnowledgeResult[] }
  | { status: "done"; results: KnowledgeResult[] }
  | { status: "error"; results: []; error: string };

const DEBOUNCE_MS = 250;
export const MIN_CONTENT_QUERY = 2;

export function useContentSearch(
  organizationId: string,
  query: string,
  enabled: boolean,
): ContentSearch {
  const q = query.trim();
  const active = enabled && q.length >= MIN_CONTENT_QUERY;
  // Answers belong to one organization and query: another organization
  // with the same words never sees them, not even while its own loads.
  const key = `${organizationId}\n${q}`;
  const [state, setState] = useState<{ key: string; search: ContentSearch }>({
    key: "",
    search: { status: "idle", results: [] },
  });
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
          if (current) setState({ key, search: { status: "done", results } });
        },
        (error: unknown) => {
          if (current)
            setState({
              key,
              search: {
                status: "error",
                results: [],
                error:
                  error instanceof Error
                    ? error.message
                    : "The search failed. Try again.",
              },
            });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, organizationId, q, key]);
  if (!active) return { status: "idle", results: [] };
  // Until this query's answer arrives, the previous query's results (in the
  // same organization) stay on screen.
  if (state.key !== key)
    return {
      status: "loading",
      results:
        state.search.status === "done" &&
        state.key.startsWith(`${organizationId}\n`)
          ? state.search.results
          : [],
    };
  return state.search;
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
