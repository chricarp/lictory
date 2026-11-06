import { useMemo, useState } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@lictory/zero/queries";
import type {
  SpaceEntity,
  SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import {
  createSpaceRowMemo,
  type SpaceRow,
} from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

export type PageThread = SpaceEntityOf<"pageThread">;
export type PageThreadMessage = SpaceEntityOf<"pageThreadMessage">;
export type Discussions = {
  threads: PageThread[];
  messages: ReadonlyMap<string, PageThreadMessage[]>;
};

const sameList = <T>(a: readonly T[] | undefined, b: readonly T[]) =>
  a?.length === b.length && a.every((x, i) => x === b[i]);

// Threads (oldest first) and each thread's messages, keeping the previous
// lists while nothing in them changed: the editor's highlights are not
// recomputed for unrelated history rows.
export function createDiscussionsMemo() {
  let previous: Discussions | undefined;
  return (entities: ReadonlyMap<string, SpaceEntity>): Discussions => {
    const threads: PageThread[] = [];
    const messages = new Map<string, PageThreadMessage[]>();
    for (const entity of entities.values())
      if (entity.type === "pageThread") threads.push(entity);
      else if (entity.type === "pageThreadMessage") {
        const list = messages.get(entity.threadId);
        if (list) list.push(entity);
        else messages.set(entity.threadId, [entity]);
      }
    threads.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    for (const [id, list] of messages) {
      list.sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
      const before = previous?.messages.get(id);
      if (before && sameList(before, list)) messages.set(id, before);
    }
    const unchanged =
      previous &&
      sameList(previous.threads, threads) &&
      previous.messages.size === messages.size &&
      [...messages].every(([id, list]) => previous!.messages.get(id) === list);
    if (!unchanged) previous = { threads, messages };
    return previous!;
  };
}

// The page's discussions from its synchronized history (the same `page`
// query the history uses, so Zero shares one subscription).
export function usePageDiscussions(pageId: string) {
  const { organization } = useWorkspace();
  const [rows, result] = useQuery(
    queries.page({ organizationId: organization.id, pageId }),
    { ttl: "5m" },
  );
  const [rowMemo] = useState(createSpaceRowMemo);
  const [memo] = useState(createDiscussionsMemo);
  const discussions = useMemo(
    () => memo(rowMemo(rows as readonly SpaceRow[])),
    [memo, rowMemo, rows],
  );
  return { ...discussions, loaded: result.type === "complete" };
}
