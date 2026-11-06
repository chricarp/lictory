import { paths } from "@lictory/core/lib/paths";
import {
  Link,
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { useSpacePages } from "@lictory/platform/components/spaces/store";
import { usePageBranchSelection } from "./branch-selection";
import { Versions } from "./versions";
import { Branches } from "./branches";
import { PullRequests } from "./pull-requests";
import { useSpacePullRequests } from "./space-pull-requests";

export function PageHistoryWorkspace() {
  const { page: pageId } = useParams<{ page: string }>();
  const space = useSpace();
  const { organization } = useWorkspace();
  const page = useSpacePages(space.id).find((p) => p.id === pageId);
  const { branch } = usePageBranchSelection();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = search.get("view") ?? "versions";
  const change = (values: Record<string, string | null>) => {
    const params = new URLSearchParams(search);
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.replace(`${pathname}?${params}`, { scroll: false });
  };
  if (!page) return <p className="p-6">This page was not found.</p>;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8">
        <Link
          className="text-sm underline underline-offset-4"
          href={`${paths.spacePage(organization.slug, space.slug, page.id)}${branch && !branch.isMain ? `?branch=${branch.id}` : ""}`}
        >
          Back to {page.title}
        </Link>
        <h1 className="text-2xl font-semibold break-words">
          {page.title} · History & review
        </h1>
        <nav aria-label="Page history views" className="flex flex-wrap gap-2">
          {[
            ["versions", "Versions"],
            ["branches", "Branches"],
            ["pulls", "Pull requests"],
          ].map(([key, title]) => (
            <button
              key={key}
              type="button"
              aria-current={view === key ? "page" : undefined}
              className={`rounded-full border px-4 py-2 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${view === key ? "bg-muted font-medium" : ""}`}
              onClick={() => change({ view: key!, pr: null })}
            >
              {title}
            </button>
          ))}
        </nav>
        {view === "branches" ? (
          <Branches pageId={page.id} />
        ) : view === "pulls" ? (
          <PullRequests
            pageId={page.id}
            selected={search.get("pr")}
            onSelect={(id) => change({ pr: id })}
          />
        ) : (
          <Versions pageId={page.id} branch={branch} />
        )}
      </div>
    </div>
  );
}

export function SpacePullRequests() {
  const space = useSpace();
  const pages = useSpacePages(space.id);
  const { organization, userId } = useWorkspace();
  const { pullRequests, loaded } = useSpacePullRequests(space.id);
  const open = pullRequests.filter(
    (p) =>
      p.status !== "merged" &&
      pages.some((page) => page.id === p.pageId && !page.archivedAt),
  );
  return (
    <div className="h-full overflow-y-auto">
      <section className="mx-auto max-w-3xl space-y-5 p-6">
        <Link
          className="text-sm underline"
          href={paths.space(organization.slug, space.slug)}
        >
          Back to {space.name}
        </Link>
        <h1 className="text-2xl font-semibold">Pull requests</h1>
        <p className="text-sm text-muted-foreground">
          Open proposals across {space.name}.
        </p>
        {!loaded && <p role="status">Loading pull requests…</p>}
        {loaded && !open.length && (
          <p className="text-sm text-muted-foreground">
            No open pull requests.
          </p>
        )}
        <ul className="space-y-2">
          {open.map((p) => (
            <li key={p.id}>
              <Link
                className="block rounded-xl border p-4 hover:bg-muted"
                href={`${paths.spacePage(organization.slug, space.slug, p.pageId)}/history?view=pulls&pr=${p.id}`}
              >
                <span className="font-medium">{p.title}</span>
                <span className="ml-2 text-xs">
                  {p.status}
                  {p.reviewers.some((r) => r.userId === userId)
                    ? " · Your review requested"
                    : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
