import { ancestorsOf } from "@lictory/platform/data/spaces";
import { GitPullRequest } from "lucide-react";
import { Button } from "@lictory/ui/button";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import "./history.css";
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
  const pages = useSpacePages(space.id);
  const page = pages.find((p) => p.id === pageId);
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
  const ancestors = ancestorsOf(new Map(pages.map((p) => [p.id, p])), page.id);
  const org = organization.slug;
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={page.title}
        breadcrumbs={[
          { label: "Spaces", href: paths.spaces(org) },
          { label: space.name, href: paths.space(org, space.slug) },
          ...ancestors.map((a) => ({
            label: a.title,
            href: paths.spacePage(org, space.slug, a.id),
          })),
        ]}
        meta="History"
        actions={
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={paths.spacePage(org, space.slug, page.id)} />}
          >
            Open published page
          </Button>
        }
      />
      <div className="spaces-history min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-8">
          <nav
            aria-label="Page history views"
            className="flex flex-wrap gap-5 border-b"
          >
            {[
              ["versions", "Versions"],
              ["branches", "Branches"],
              ["pulls", "Pull requests"],
            ].map(([key, title]) => (
              <button
                key={key}
                type="button"
                aria-current={view === key ? "page" : undefined}
                className={`min-h-8 border-b-2 px-1 py-1.5 text-sm focus-ring-inset transition-colors duration-150 outline-none hover:text-foreground ${view === key ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground"}`}
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
              initialSource={search.get("source")}
              selected={search.get("pr")}
              onSelect={(id) => change({ pr: id })}
            />
          ) : (
            <Versions pageId={page.id} branch={branch} />
          )}
        </div>
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
  const org = organization.slug;
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Pull requests"
        back={{
          label: `Back to ${space.name}`,
          href: paths.space(org, space.slug),
        }}
        breadcrumbs={[
          { label: "Spaces", href: paths.spaces(org) },
          { label: space.name, href: paths.space(org, space.slug) },
        ]}
        description={`Open proposals across ${space.name}.`}
      />
      <div className="spaces-history min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <section
          aria-label={`Open pull requests in ${space.name}`}
          className="mx-auto max-w-3xl space-y-5 p-6"
        >
          {!loaded && <p role="status">Loading pull requests…</p>}
          {loaded && !open.length && (
            <p className="text-sm text-muted-foreground">
              No open pull requests.
            </p>
          )}
          {open.length > 0 && (
            <ul className="divide-y divide-border/70 overflow-hidden rounded-xl bg-card shadow-(--shadow-border)">
              {open.map((p) => (
                <ListRow
                  key={p.id}
                  href={`${paths.spacePage(org, space.slug, p.pageId)}/history?view=pulls&pr=${p.id}`}
                  leading={
                    <GitPullRequest
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  }
                  title={p.title}
                  meta={
                    <>
                      <span className="truncate">
                        {pages.find((page) => page.id === p.pageId)?.title}
                      </span>
                      <span className="shrink-0 capitalize">{p.status}</span>
                      {p.reviewers.some((r) => r.userId === userId) && (
                        <span className="shrink-0 font-medium text-foreground/80">
                          Your review requested
                        </span>
                      )}
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
