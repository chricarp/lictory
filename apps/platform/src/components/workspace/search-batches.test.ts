import assert from "node:assert/strict";
import { test } from "node:test";
import type { KnowledgeResult } from "@lictory/core/capabilities/product-knowledge";
import {
  nextRequest,
  refreshBatches,
  type SearchAnswer,
  type SearchRequest,
} from "@lictory/platform/components/workspace/search-batches";

// A search over an ordered list, two results per batch, continuing after
// the last result shown (as searchKnowledge's cursor does).
function server(initial: string[]) {
  let order = [...initial];
  const fetch = (request: SearchRequest): Promise<SearchAnswer> => {
    const start = request.cursor ? order.indexOf(request.cursor) + 1 : 0;
    const rows = order.slice(start, start + 3);
    const shown = rows.slice(0, 2);
    const more = rows.length > 2;
    return Promise.resolve({
      results: shown.map((id) => ({ id, kind: "page" }) as KnowledgeResult),
      more: more ? ["page"] : [],
      cursor: more ? shown.at(-1)! : null,
    });
  };
  return {
    fetch,
    set: (next: string[]) => {
      order = next;
    },
  };
}
const ids = (answers: SearchAnswer[]) =>
  answers.flatMap((a) => a.results.map((r) => r.id));
const first: SearchRequest = { cursor: null, kinds: ["page"] };

async function loadTwo(fetch: (r: SearchRequest) => Promise<SearchAnswer>) {
  const one = await fetch(first);
  const two = await fetch(nextRequest(one)!);
  return [one, two];
}

void test("a refresh after an insertion before two open batches keeps every result once", async () => {
  const search = server(["A", "B", "C", "D", "E"]);
  assert.deepEqual(ids(await loadTwo(search.fetch)), ["A", "B", "C", "D"]);
  search.set(["X", "A", "B", "C", "D", "E"]);
  const refreshed = await refreshBatches(first, 2, search.fetch);
  // B moved into the second window instead of falling between them.
  assert.deepEqual(ids(refreshed.answers), ["X", "A", "B", "C"]);
  assert.equal(refreshed.requests.length, 2);
  assert.equal(refreshed.requests[1]!.cursor, "A");
  // The rest continues after the newly read last batch.
  const rest = await search.fetch(nextRequest(refreshed.answers.at(-1)!)!);
  assert.deepEqual(ids([rest]), ["D", "E"]);
});

void test("a refresh after a removal inside an open batch closes the gap without repeating", async () => {
  const search = server(["A", "B", "C", "D", "E", "F"]);
  await loadTwo(search.fetch);
  search.set(["A", "C", "D", "E", "F"]);
  const refreshed = await refreshBatches(first, 2, search.fetch);
  assert.deepEqual(ids(refreshed.answers), ["A", "C", "D", "E"]);
  // An insertion and a removal at once.
  search.set(["X", "A", "C", "E", "F"]);
  const again = await refreshBatches(first, 2, search.fetch);
  assert.deepEqual(ids(again.answers), ["X", "A", "C", "E"]);
  assert.deepEqual(again.answers.at(-1)!.more, ["page"]);
});

void test("a refresh stops when fewer results remain than were loaded", async () => {
  const search = server(["A", "B", "C", "D", "E"]);
  await loadTwo(search.fetch);
  search.set(["A", "B"]);
  const refreshed = await refreshBatches(first, 2, search.fetch);
  assert.equal(refreshed.answers.length, 1);
  assert.deepEqual(ids(refreshed.answers), ["A", "B"]);
  assert.equal(nextRequest(refreshed.answers[0]!), null);
});
