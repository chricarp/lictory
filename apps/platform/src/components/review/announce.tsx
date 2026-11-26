import { useEffect, useRef } from "react";
import { useAnnounce } from "@lictory/platform/components/shell/announcer";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useShell } from "@lictory/platform/components/workspace/shell";

type ReviewState = {
  revision: { id: string; number: number; authorId: string } | null;
  approvals: ReadonlyMap<
    string,
    { status: string; reviewerId: string; reviewId: string }
  >;
};

// What changed in an item's review since its page opened, said by others:
// a new revision, an approval granted or revoked, approvals made outdated by
// a revision. The person's own decisions are confirmed where they made them.
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
  for (const [id, approval] of next.approvals) {
    const before = previous.approvals.get(id);
    if (before?.status === approval.status) continue;
    const who = names.member(approval.reviewerId);
    const what = names.responsibility(approval.reviewId);
    if (approval.status === "granted" && !before) {
      if (approval.reviewerId !== userId)
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
      outdated.push(what);
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
          { status: a.status, reviewerId: a.reviewerId, reviewId: a.reviewId },
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
      if (key.startsWith("outdated:") && revision?.authorId === userId)
        toast(text);
      else announce(text, { key });
  }, [signature, announce, toast]);
}

// Rendered once inside the item's page.
export function ReviewAnnouncer() {
  useAnnounceReview();
  return null;
}
