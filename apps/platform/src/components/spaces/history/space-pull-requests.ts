import { useMemo, useState } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@lictory/zero/queries";
import {
  createSpaceRowMemo,
  type SpaceRow,
} from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Metadata only: opening the space review list must not fetch page documents.
export function useSpacePullRequests(spaceId: string) {
  const { organization } = useWorkspace();
  const [rows, result] = useQuery(
    queries.spacePullRequests({ organizationId: organization.id, spaceId }),
  );
  const [memo] = useState(createSpaceRowMemo);
  const pullRequests = useMemo(
    () =>
      [...memo(rows as readonly SpaceRow[]).values()].filter(
        (e) => e.type === "pagePullRequest",
      ),
    [memo, rows],
  );
  return { pullRequests, loaded: result.type === "complete" };
}
