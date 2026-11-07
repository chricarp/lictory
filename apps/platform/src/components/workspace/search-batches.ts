import type {
  KnowledgeKind,
  KnowledgeResult,
} from "@lictory/core/capabilities/product-knowledge";

// The batches of "See all results" (search-results.tsx). Each batch
// continues after the previous one's position; a refresh reads them again.

// One batch: where it starts (null: the beginning) and which kinds it reads.
export type SearchRequest = {
  cursor: string | null;
  kinds: readonly KnowledgeKind[];
};
export type SearchAnswer = {
  results: KnowledgeResult[];
  // Kinds with more results after this batch, and where they continue.
  more: KnowledgeKind[];
  cursor: string | null;
};

// Where the batch after `answer` starts, or null when nothing follows it.
export const nextRequest = (answer: SearchAnswer): SearchRequest | null =>
  answer.cursor && answer.more.length
    ? { cursor: answer.cursor, kinds: answer.more }
    : null;

// Reads as many batches again as were loaded (`depth`), one after another
// from the beginning, each continuing where the newly read one ends. Keeping
// the old positions instead would lose what moved across a boundary (a
// result added before it pushes one out of a window, and the next window
// still starts after it) or show it twice. Stops early when nothing
// follows.
export async function refreshBatches(
  first: SearchRequest,
  depth: number,
  fetch: (request: SearchRequest) => Promise<SearchAnswer>,
): Promise<{ requests: SearchRequest[]; answers: SearchAnswer[] }> {
  const requests: SearchRequest[] = [];
  const answers: SearchAnswer[] = [];
  let request: SearchRequest | null = first;
  while (request && requests.length < Math.max(1, depth)) {
    const answer = await fetch(request);
    requests.push(request);
    answers.push(answer);
    request = nextRequest(answer);
  }
  return { requests, answers };
}
