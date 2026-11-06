import { Link } from "@lictory/platform/lib/navigation";
import { paths } from "@lictory/core/lib/paths";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { usePageHistory } from "@lictory/platform/components/spaces/store";
import { usePageBranchSelection } from "./branch-selection";
import { commitReview } from "./approval";

export function PageHistoryEntry({ pageId }: { pageId: string }) {
  const { organization, memberName } = useWorkspace();
  const space = useSpace();
  const { branches, pullRequests, head } = usePageHistory(pageId);
  const { branchId, setBranch } = usePageBranchSelection();
  const href = `${paths.spacePage(organization.slug, space.slug, pageId)}/history`;
  // Only Reviewed spaces publish approved versions; Direct spaces show
  // their reviewers in the version history instead.
  const review = head
    ? commitReview(space.publishing, head.approverIds.map(memberName))
    : null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      {review?.approved && (
        <span
          className="rounded-full border px-2 py-1 text-xs"
          title={review.line}
        >
          Approved published version
        </span>
      )}
      <select
        aria-label="Page branch"
        className="max-w-64 rounded-full border bg-card px-3 py-1.5"
        value={branchId ?? ""}
        onChange={(e) => setBranch(e.target.value)}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {!b.isMain ? ` · ${memberName(b.authorId)}` : ""}
            {b.collaboratorIds.length
              ? ` · with ${b.collaboratorIds.map(memberName).join(", ")}`
              : ""}
            {b.draft?.uncommittedChanges ? " · uncommitted changes" : ""}
            {pullRequests.some(
              (p) => p.sourceBranchId === b.id && p.status !== "merged",
            )
              ? " · pull request"
              : ""}
          </option>
        ))}
      </select>
      <Link
        href={`${href}${branchId ? `?branch=${branchId}` : ""}`}
        className="rounded-full px-2 py-1 underline underline-offset-4"
      >
        History & branches
      </Link>
      <Link
        href={`${href}?view=pulls`}
        className="rounded-full px-2 py-1 underline underline-offset-4"
      >
        Pull requests (
        {pullRequests.filter((p) => p.status !== "merged").length})
      </Link>
    </div>
  );
}
