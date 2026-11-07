import { useMemo } from "react";
import { FileText, Plus } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { relativeTime, type Project } from "@lictory/core/lib/work-items";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpaces } from "@lictory/platform/components/spaces/store";
import { SpaceIcon } from "@lictory/platform/components/spaces/space-meta";

const SPACES = 4;
const RECENT = 3;

// The project's knowledge in one line on its Refinement home: its spaces
// and its teams' spaces, and what was published there recently. Only spaces
// and pages I can read; no dashboard.
export function ProjectKnowledge({ project }: { project: Project }) {
  const { organization, canManage } = useWorkspace();
  const { index, openCreateSpace } = useSpaces();
  const { spaces, recent } = useMemo(() => {
    const spaces = index.spaces.filter(
      (s) => !s.archivedAt && s.projectId === project.id,
    );
    // The project's own spaces before its teams'.
    spaces.sort(
      (a, b) =>
        Number(Boolean(a.teamId)) - Number(Boolean(b.teamId)) ||
        a.name.localeCompare(b.name),
    );
    const recent = spaces
      .flatMap((space) =>
        (index.pagesBySpace.get(space.id) ?? [])
          .filter((p) => !p.archivedAt)
          .map((page) => ({ page, space })),
      )
      .sort((a, b) => b.page.updatedAt.localeCompare(a.page.updatedAt))
      .slice(0, RECENT);
    return { spaces, recent };
  }, [index, project.id]);
  if (!spaces.length && !canManage(project.id)) return null;
  return (
    <section
      aria-label={`${project.name} knowledge`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-4 py-2 text-xs"
    >
      <h2 className="font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        Knowledge
      </h2>
      {spaces.length === 0 ? (
        <button
          type="button"
          onClick={() => openCreateSpace({ projectId: project.id })}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3" aria-hidden /> Create a space for{" "}
          {project.name}’s pages
        </button>
      ) : (
        <ul className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
          {spaces.slice(0, SPACES).map((space) => (
            <li key={space.id}>
              <Link
                href={paths.space(organization.slug, space.slug)}
                className="inline-flex max-w-52 items-center gap-1.5 rounded-full px-1.5 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <SpaceIcon space={space} className="size-3.5 text-xs" />
                <span className="truncate">{space.name}</span>
              </Link>
            </li>
          ))}
          {spaces.length > SPACES && (
            <li>
              <Link
                href={paths.spaces(organization.slug)}
                className="rounded-full px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                +{spaces.length - SPACES} more
              </Link>
            </li>
          )}
        </ul>
      )}
      {recent.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 sm:ml-auto">
          <span className="text-muted-foreground">Recently published</span>
          <ul className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
            {recent.map(({ page, space }) => (
              <li key={page.id}>
                <Link
                  href={paths.spacePage(organization.slug, space.slug, page.id)}
                  className="inline-flex max-w-56 items-center gap-1 rounded-full px-1.5 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FileText
                    className="size-3 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="truncate">{page.title || "Untitled"}</span>
                  <time
                    dateTime={page.updatedAt}
                    className="shrink-0 text-muted-foreground"
                  >
                    {relativeTime(page.updatedAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
