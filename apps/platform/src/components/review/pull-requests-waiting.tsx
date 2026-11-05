import { ArrowRight, GitPullRequest } from "lucide-react";
import type { EntityOf } from "@lictory/core/contracts/protocol";
import {
  Link,
  usePathname,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { useItem } from "@lictory/platform/components/items/item-context";

// Pull requests whose review is waiting on the viewer. The item page opens on
// main, where a reviewer would otherwise find them only below the whole
// specification, while the rail above reads "2 / 2 approved".
//
// Each open pull request carries the people it still waits for, derived on
// the server: an undecided review, or an approval for a merge result that has
// since changed.
export function PullRequestsWaiting() {
  const { item, entities, userId } = useItem();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const waiting = entities.filter(
    (e): e is EntityOf<"pullRequest"> =>
      e.type === "pullRequest" &&
      e.workItemId === item.id &&
      e.status === "open" &&
      e.pendingReviewerIds.includes(userId),
  );
  if (!waiting.length) return null;
  const hrefFor = (id: string) => {
    const params = new URLSearchParams(searchParams);
    for (const name of ["branch", "branches", "ai", "suggestion"])
      params.delete(name);
    params.set("pr", id);
    return `${pathname}?${params}`;
  };
  return (
    <section
      aria-label="Pull requests waiting for your review"
      className="mb-5 rounded-lg border border-primary/25 bg-primary/5 p-3 text-[13px]"
    >
      <p className="mb-1.5 font-medium">
        {waiting.length === 1
          ? "A pull request waits for your review"
          : `${waiting.length} pull requests wait for your review`}
      </p>
      <ul className="space-y-1">
        {waiting.map((pr) => (
          <li key={pr.id}>
            <Link
              href={hrefFor(pr.id)}
              scroll={false}
              className="group flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-primary/10"
            >
              <GitPullRequest
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate">{pr.title}</span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground group-hover:text-foreground">
                Review <ArrowRight aria-hidden className="size-3" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
