import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@lictory/zero/queries";
import type { SpaceEntity } from "@lictory/core/contracts/protocol";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  createSpaceRowMemo,
  type SpaceRow,
} from "@lictory/platform/data/spaces";
import {
  contextLinks,
  itemKnowledge,
  pageCountsByItem,
  type ContextScope,
  type PageLookup,
} from "@lictory/platform/data/knowledge";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpaces } from "@lictory/platform/components/spaces/store";

// Knowledge links for Work surfaces (docs/internals/knowledge-links.md):
// synchronized rows of pages I read, resolved against the page summaries I
// read. Nothing here ever names or counts another page.

const TTL = "5m";

// Rows to entities, each keeping its identity while unchanged.
function useEntities(
  raw: unknown,
  result: { type: string },
): { rows: SpaceEntity[]; loaded: boolean } {
  const [memo] = useState(createSpaceRowMemo);
  const rows = useMemo(
    () => [...memo(raw as readonly SpaceRow[]).values()],
    [memo, raw],
  );
  return { rows, loaded: result.type === "complete" };
}

export function usePageLookup(): PageLookup {
  const { index } = useSpaces();
  return useMemo(
    () => ({ pageById: index.pageById, spaceById: index.spaceById }),
    [index.pageById, index.spaceById],
  );
}

export function useItemKnowledge(item: { id: string; revisionId: string }) {
  const { organization } = useWorkspace();
  const lookup = usePageLookup();
  const [raw, result] = useQuery(
    queries.workItemKnowledge({
      organizationId: organization.id,
      workItemId: item.id,
    }),
    { ttl: TTL },
  );
  const { rows, loaded } = useEntities(raw, result);
  const knowledge = useMemo(
    () => itemKnowledge(rows, lookup, item),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the item's identity is its id and revision
    [rows, lookup, item.id, item.revisionId],
  );
  // The same count lists and previews show ("N pages").
  const count = useMemo(
    () => pageCountsByItem(rows, lookup).get(item.id) ?? 0,
    [rows, lookup, item.id],
  );
  return { knowledge, loaded, count };
}

// Readable pages per work item (mentions and attachments), for lists.
export function useItemPageCounts() {
  const { organization } = useWorkspace();
  const lookup = usePageLookup();
  const [raw, result] = useQuery(
    queries.itemPageLinks({ organizationId: organization.id }),
    { ttl: TTL },
  );
  const { rows } = useEntities(raw, result);
  return useMemo(() => pageCountsByItem(rows, lookup), [rows, lookup]);
}

export function useProjectContext(projectId: string) {
  const { organization } = useWorkspace();
  const lookup = usePageLookup();
  const [raw, result] = useQuery(
    queries.projectContext({ organizationId: organization.id, projectId }),
    { ttl: TTL },
  );
  const { rows, loaded } = useEntities(raw, result);
  const listOf = useMemo(
    () => (scope: ContextScope) => contextLinks(rows, lookup, scope),
    [rows, lookup],
  );
  return { listOf, loaded };
}

export type PageLinkDetails = {
  pageId: string;
  title: string;
  publishedCommitId: string;
  publishedVersion: number;
  versions: Record<string, number>;
  blocks: { blockId: string; heading: string | null; excerpt: string }[];
};
type Request = {
  pageId: string;
  blocks?: { commitId: string; blockIds: string[] };
  versions?: string[];
};

// Where pages mention the item and which versions pins are (read on demand
// for pages I read). Refetched when what is asked changes; failures leave
// the list as the links alone describe it.
export function usePageLinkDetails(requests: Request[]) {
  const { organization } = useWorkspace();
  const key = JSON.stringify(requests);
  const [state, setState] = useState<{
    key: string;
    details: Map<string, PageLinkDetails>;
  }>();
  useEffect(() => {
    const pages = JSON.parse(key) as Request[];
    if (!pages.length) return;
    let current = true;
    callCapability<{ pages: PageLinkDetails[] }>("describePageLinks", {
      organizationId: organization.id,
      pages,
    })
      .then(
        (result) =>
          current &&
          setState({
            key,
            details: new Map(result.pages.map((p) => [p.pageId, p])),
          }),
      )
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [organization.id, key]);
  // While a new answer loads the previous one stays: its entries are keyed
  // by page and commit, so they remain true.
  return state?.details;
}
