import { Archive, Plus, Settings2 } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { Badge, EmptyState, SectionLabel } from "@lictory/ui/primitives";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useSpaceGrants,
  useSpacePages,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import { PageTree } from "@lictory/platform/components/spaces/page-tree";
import {
  SpaceIcon,
  accessSummary,
  homeOf,
  levelLabels,
} from "@lictory/platform/components/spaces/space-meta";
import { SpaceBreadcrumbs } from "@lictory/platform/components/spaces/breadcrumbs";
import { ArchivedSpaceNotice } from "@lictory/platform/components/spaces/archived-notice";

// A space's front page: what it is, where it lives, who can read and edit
// it, and its pages.
export function SpaceHome() {
  const space = useSpace();
  const { organization, directory } = useWorkspace();
  const { levelOf, canManageSpace } = useSpaces();
  const { canEdit, createPage } = usePageActions();
  const pages = useSpacePages(space.id);
  const grants = useSpaceGrants(space.id);
  const level = levelOf(space.id);
  const home = homeOf(space, directory, organization.name);
  const manage = canManageSpace(space);
  const activePages = pages.filter((p) => !p.archivedAt).length;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <SpaceBreadcrumbs space={space} />
        {space.archivedAt && <ArchivedSpaceNotice space={space} />}
        <header className="mt-4 flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-xl">
            <SpaceIcon space={space} className="size-6 text-xl" />
          </div>
          <div className="min-w-0 flex-1 basis-60">
            <h1 className="text-xl font-semibold tracking-tight break-words">
              {space.name}
            </h1>
            {space.description && (
              <p className="mt-1 text-sm leading-6 whitespace-pre-line text-muted-foreground">
                {space.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(manage || level === "edit") && (
              <Link
                href={paths.spaceSettings(organization.slug, space.slug)}
                className="contents"
              >
                <Button variant="secondary" size="sm">
                  <Settings2 className="size-3.5" aria-hidden /> Settings
                </Button>
              </Link>
            )}
            {canEdit && (
              <Button size="sm" onClick={() => createPage(null)}>
                <Plus className="size-3.5" aria-hidden /> New page
              </Button>
            )}
          </div>
        </header>
        <section
          aria-label="About this space"
          className="mt-5 rounded-xl bg-tray p-1"
        >
          <div className="rounded-[10px] bg-card px-4 py-3 shadow-(--shadow-border)">
            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
              <div>
                <dt className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                  Home
                </dt>
                <dd className="mt-0.5 truncate">{home.label}</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                  Publishing
                </dt>
                <dd className="mt-0.5">
                  {space.publishing === "direct" ? "Direct" : "Reviewed"}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                  Your access
                </dt>
                <dd className="mt-0.5">
                  {level ? levelLabels[level] : "None"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-[13px] leading-5 text-muted-foreground">
              <Badge
                tone={space.accessMode === "restricted" ? "warning" : "neutral"}
              >
                {space.accessMode === "restricted" ? "Restricted" : "Inherited"}
              </Badge>
              <span>
                {accessSummary(space, home, organization.name, grants.length)}
              </span>
            </p>
          </div>
        </section>
        <section aria-labelledby="space-pages" className="mt-8">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <SectionLabel>
              <span id="space-pages">Pages</span>
            </SectionLabel>
            <span className="text-xs text-muted-foreground tabular-nums">
              {activePages === 1 ? "1 page" : `${activePages} pages`}
            </span>
          </div>
          {pages.length === 0 ? (
            <EmptyState
              illustration="knowledge"
              title="No pages yet"
              action={
                canEdit ? (
                  <Button onClick={() => createPage(null)}>
                    <Plus className="size-3.5" aria-hidden /> New page
                  </Button>
                ) : undefined
              }
            >
              {canEdit
                ? "Start with the page people ask about most: a runbook, a decision record or how the team works."
                : "Nothing has been written here yet. Editors of this space can add the first page."}
            </EmptyState>
          ) : (
            <div className="rounded-xl bg-card p-1.5 shadow-(--shadow-border)">
              <PageTree variant="home" />
            </div>
          )}
          {space.archivedAt && (
            <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
              <Archive className="size-3.5" aria-hidden /> Pages of an archived
              space can be read but not changed.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
