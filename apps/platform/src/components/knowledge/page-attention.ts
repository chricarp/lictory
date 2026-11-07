import { useMemo, useState } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@lictory/zero/queries";
import type { SpaceEntityOf } from "@lictory/core/contracts/protocol";
import {
  createSpaceRowMemo,
  type SpaceRow,
} from "@lictory/platform/data/spaces";
import {
  pageAttention,
  pagesAwaitingMyReview,
  readablePage,
} from "@lictory/platform/data/knowledge";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { usePageLookup } from "@lictory/platform/components/knowledge/store";

// Inbox To do for pages: page pull requests waiting on me, derived from the
// synchronized pull requests of spaces I read and, for those that ask for
// my review, the review decisions on their pages. An entry disappears as
// soon as its state resolves (I review, changes are addressed, it merges)
// or I can no longer read the page.
export function usePageAttention() {
  const { organization, userId } = useWorkspace();
  const lookup = usePageLookup();
  const [prRows] = useQuery(
    queries.myPagePullRequests({ organizationId: organization.id }),
  );
  const [prMemo] = useState(createSpaceRowMemo);
  const pullRequests = useMemo(
    () =>
      [...prMemo(prRows as readonly SpaceRow[]).values()].filter(
        (e): e is SpaceEntityOf<"pagePullRequest"> =>
          e.type === "pagePullRequest",
      ),
    [prMemo, prRows],
  );
  const pageIds = useMemo(
    () => pagesAwaitingMyReview(pullRequests, userId).slice(0, 200),
    [pullRequests, userId],
  );
  const [reviewRows, reviewResult] = useQuery(
    queries.pagePullRequestReviews({
      organizationId: organization.id,
      pageIds,
    }),
    { enabled: pageIds.length > 0 },
  );
  const [reviewMemo] = useState(createSpaceRowMemo);
  const reviews = useMemo(
    () =>
      [...reviewMemo(reviewRows as readonly SpaceRow[]).values()].filter(
        (e): e is SpaceEntityOf<"pagePullRequestReview"> =>
          e.type === "pagePullRequestReview",
      ),
    [reviewMemo, reviewRows],
  );
  // Until my decisions are here, a review I already gave is not asked again.
  const reviewsKnown = !pageIds.length || reviewResult.type === "complete";
  return useMemo(
    () =>
      pageAttention(pullRequests, reviews, userId, (pageId) =>
        Boolean(readablePage(lookup, pageId)),
      )
        .filter(
          (entry) =>
            reviewsKnown ||
            entry.reason === "changes_requested" ||
            entry.reason === "ready_to_merge",
        )
        .map((entry) => ({
          ...entry,
          ...readablePage(lookup, entry.pullRequest.pageId)!,
        })),
    [pullRequests, reviews, userId, lookup, reviewsKnown],
  );
}

export type PageAttentionEntry = ReturnType<typeof usePageAttention>[number];
