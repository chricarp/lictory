import { useEffect, useRef } from "react";
import { isCarriedApproval } from "@lictory/core/contracts/decomposition";
import { useAnnounce } from "@lictory/platform/components/shell/announcer";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useShell } from "@lictory/platform/components/workspace/shell";

type ReviewState = {
  revision: { id: string; number: number; authorId: string } | null;
  approvals: ReadonlyMap<
    string,
    {
      status: string;
      reviewerId: string;
      reviewId: string;
      endReason?: string | null;
    }
  >;
};

// What changed in an item's review since its page opened, said by others:
// a new revision, an approval granted or revoked, approvals made outdated by
// a revision. The person's own decisions are confirmed where they made them.
// A revision that leaves the specification text unchanged (a merged
// breakdown) carries approvals to new rows: the server ends the old ones
// with a carried reason, and that is what is said, never "outdated".
export function reviewAnnouncements(
  previous: ReviewState,
  next: ReviewState,
  userId: string,
  names: {
    member: (id: string | null | undefined) => string;
    responsibility: (reviewId: string) => string;
  },
): { key: string; text: string }[] {
  const said: { key: string; text: string }[] = [];
  const revision = next.revision;
  if (
    revision &&
    previous.revision &&
    revision.id !== previous.revision.id &&
    revision.number > previous.revision.number &&
    revision.authorId !== userId
  )
    said.push({
      key: `revision:${revision.id}`,
      text: `${names.member(revision.authorId)} saved revision ${revision.number}`,
    });
  const outdated: string[] = [];
  const carried: string[] = [];
  // Who had an approval carried in this change: their new row on the new
  // revision is the same decision, not a new approval.
  const carriedBy = new Set<string>();
  for (const [id, approval] of next.approvals) {
    const before = previous.approvals.get(id);
    if (
      before?.status === "granted" &&
      approval.status === "stale" &&
      isCarriedApproval(approval.endReason)
    )
      carriedBy.add(approval.reviewerId);
  }
  for (const [id, approval] of next.approvals) {
    const before = previous.approvals.get(id);
    if (before?.status === approval.status) continue;
    const who = names.member(approval.reviewerId);
    const what = names.responsibility(approval.reviewId);
    if (approval.status === "granted" && !before) {
      if (approval.reviewerId !== userId && !carriedBy.has(approval.reviewerId))
        said.push({
          key: `approval:${id}:granted`,
          text: `${who} approved ${what}${revision ? ` on revision ${revision.number}` : ""}`,
        });
    } else if (approval.status === "revoked" && before) {
      if (approval.reviewerId !== userId)
        said.push({
          key: `approval:${id}:revoked`,
          text: `${who} withdrew the ${what} approval`,
        });
    } else if (approval.status === "stale" && before) {
      if (isCarriedApproval(approval.endReason)) {
        if (!carried.includes(what)) carried.push(what);
      } else outdated.push(what);
    }
  }
  // A revision that outdates several approvals is one announcement. Its
  // author is told too: the card saying so may be scrolled out of view
  // after a save at the end of a long specification.
  if (outdated.length)
    said.push({
      key: `outdated:${revision?.id ?? "none"}:${outdated.join(",")}`,
      text:
        revision?.authorId === userId
          ? `Revision ${revision.number} outdated earlier approvals: ${outdated.join(", ")} need${outdated.length === 1 ? "s" : ""} review again`
          : `Approvals need review again: ${outdated.join(", ")}`,
    });
  // Only the revision's author is told: for others nothing they must do
  // changed, and the new revision itself is announced above.
  if (carried.length && revision?.authorId === userId)
    said.push({
      key: `carried:${revision.id}:${carried.join(",")}`,
      text: `Revision ${revision.number} kept the approvals: ${carried.join(", ")}`,
    });
  return said;
}

// Announces review changes on the item page while it is open.
function useAnnounceReview() {
  const { current, approvals, reviews, userId, memberName } = useItem();
  const announce = useAnnounce();
  const { toast } = useShell();
  const revision = current
    ? { id: current.id, number: current.number, authorId: current.authorId }
    : null;
  const signature = `${revision?.id ?? ""}|${approvals
    .map((a) => `${a.id}:${a.status}`)
    .sort()
    .join(",")}`;
  const state = useRef<{ signature: string; value: ReviewState } | null>(null);
  const latest = useRef({ revision, approvals, reviews, userId, memberName });
  useEffect(() => {
    latest.current = { revision, approvals, reviews, userId, memberName };
  });
  useEffect(() => {
    const { revision, approvals, reviews, userId, memberName } = latest.current;
    const value: ReviewState = {
      revision,
      approvals: new Map(
        approvals.map((a) => [
          a.id,
          {
            status: a.status,
            reviewerId: a.reviewerId,
            reviewId: a.reviewId,
            endReason: a.endReason,
          },
        ]),
      ),
    };
    const previous = state.current;
    state.current = { signature, value };
    if (!previous || previous.signature === signature) return;
    const responsibility = (reviewId: string) => {
      const name = reviews.find((r) => r.id === reviewId)?.responsibility;
      return name ? `${name} review` : "the review";
    };
    for (const { key, text } of reviewAnnouncements(
      previous.value,
      value,
      userId,
      { member: memberName, responsibility },
    ))
      // The author's own save is shown, not only said: a toast is visible
      // wherever the page is scrolled, and is announced as well.
      if (
        (key.startsWith("outdated:") || key.startsWith("carried:")) &&
        revision?.authorId === userId
      ) {
        toast(text);
        // The status card shows what the save did to the approvals: bring
        // it into view instead of leaving it above a long specification.
        if (key.startsWith("outdated:"))
          requestAnimationFrame(() =>
            document
              .querySelector('[aria-label="Item workflow"]')
              ?.scrollIntoView({ block: "nearest" }),
          );
      } else announce(text, { key });
  }, [signature, announce, toast]);
}

// Rendered once inside the item's page.
export function ReviewAnnouncer() {
  useAnnounceReview();
  return null;
}
