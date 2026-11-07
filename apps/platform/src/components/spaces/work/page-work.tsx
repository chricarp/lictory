import { useMemo, useState } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { GitBranch } from "lucide-react";
import { queries } from "@lictory/zero/queries";
import { iterationLabel } from "@lictory/core/contracts/protocol";
import type {
  SpaceEntity,
  SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import { SectionLabel } from "@lictory/ui/primitives";
import { Link, usePathname } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  rollup,
  useWorkFacts,
  WorkRow,
  type WorkFact,
} from "@lictory/platform/components/spaces/work/work-row";

// "Work on this page": below the published page, the work it knows about
// (docs/internals/knowledge-links.md), read from the `pageWork` query: items
// its published version mentions, items created from it, items it is
// attached to, specifications that cite it, page changes proposed from work
// items and the planning contexts that keep it. Rows exist only for pages I
// read; items I cannot see are left out entirely (no placeholder, no count).

type Rows = { data: unknown }[];

export function usePageWork(pageId: string) {
  const { organization } = useWorkspace();
  const [rows] = useQuery(
    queries.pageWork({ organizationId: organization.id, pageId }),
    { ttl: "5m" },
  );
  return useMemo(() => {
    const by = <T extends SpaceEntity["type"]>(type: T) =>
      (rows as Rows)
        .map((r) => r.data as SpaceEntity)
        .filter((e): e is SpaceEntityOf<T> => e.type === type);
    return {
      references: by("pageReference"),
      sources: by("workItemSource"),
      attachments: by("pageAttachment"),
      citations: by("specificationCitation"),
      origins: by("pageBranchOrigin"),
      contexts: by("pageContextLink"),
    };
  }, [rows]);
}

const purposeLabel = {
  background: "Background",
  design: "Design",
  runbook: "Runbook",
} as const;

type Linked = { fact: WorkFact; details: string[]; order: number };

const VISIBLE = 6;

export function PageWorkPanel({ pageId }: { pageId: string }) {
  const work = usePageWork(pageId);
  const facts = useWorkFacts();
  const { projects, delivery } = useWorkspace();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  const linked = useMemo(() => {
    const byItem = new Map<string, Linked>();
    const add = (workItemId: string, detail: string, order: number) => {
      const fact = facts.get(workItemId);
      if (!fact) return;
      const entry = byItem.get(workItemId) ?? { fact, details: [], order };
      if (!entry.details.includes(detail)) entry.details.push(detail);
      entry.order = Math.min(entry.order, order);
      byItem.set(workItemId, entry);
    };
    for (const s of work.sources)
      add(s.workItemId, "Created from this page", 0);
    for (const r of work.references) add(r.workItemId, "Mentioned", 1);
    for (const a of work.attachments)
      add(a.workItemId, `Attached · ${purposeLabel[a.purpose]}`, 2);
    for (const c of work.citations) {
      const fact = facts.get(c.workItemId);
      if (!fact) continue;
      const current = c.revisions.find(
        (r) => r.revisionId === fact.item.revisionId,
      );
      const latest = c.revisions.at(-1);
      add(
        c.workItemId,
        current
          ? "Cited in its specification"
          : `Cited in revision ${latest?.number ?? ""}`.trim(),
        3,
      );
    }
    return [...byItem.values()].sort(
      (a, b) => a.order - b.order || a.fact.key.localeCompare(b.fact.key),
    );
  }, [work, facts]);

  const origins = useMemo(
    () =>
      work.origins
        .map((o) => ({ origin: o, fact: facts.get(o.workItemId) }))
        .sort((a, b) => b.origin.createdAt.localeCompare(a.origin.createdAt)),
    [work.origins, facts],
  );

  const contexts = useMemo(() => {
    const names: string[] = [];
    for (const c of work.contexts) {
      const project = projects.find((p) => p.id === c.projectId);
      if (!project) continue;
      if (c.iterationId) {
        const iteration = delivery.iterations.get(c.iterationId);
        if (iteration)
          names.push(
            `${project.key} ${iterationLabel(iteration, project.iterationMode)}`,
          );
      } else if (c.teamId) {
        const team = delivery.teams.get(c.teamId);
        if (team) names.push(`${project.key} ${team.name}`);
      } else names.push(project.name);
    }
    return [...new Set(names)];
  }, [work.contexts, projects, delivery]);

  if (!linked.length && !origins.length && !contexts.length) return null;
  const { done, total } = rollup(linked.map((l) => l.fact));
  const shown = expanded ? linked : linked.slice(0, VISIBLE);
  return (
    <section
      aria-labelledby={`page-work-${pageId}`}
      className="mt-14 border-t pt-5"
      data-testid="page-work"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <SectionLabel>
          <span id={`page-work-${pageId}`}>Work on this page</span>
        </SectionLabel>
        {total > 0 && (
          <span
            className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums"
            data-testid="page-work-rollup"
          >
            <span
              aria-hidden
              className="relative h-1 w-16 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-success"
                style={{ width: `${(done / total) * 100}%` }}
              />
            </span>
            {done} of {total} done
          </span>
        )}
        {contexts.length > 0 && (
          <span className="text-xs text-muted-foreground sm:ml-auto">
            Context for {contexts.join(", ")}
          </span>
        )}
      </div>
      {linked.length > 0 && (
        <ul className="-mx-2 mt-2" aria-label="Work items">
          {shown.map((l) => (
            <WorkRow
              key={l.fact.item.id}
              fact={l.fact}
              detail={l.details.join(" · ")}
              showOwner
            />
          ))}
        </ul>
      )}
      {linked.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {expanded ? "Show fewer" : `Show all ${linked.length}`}
        </button>
      )}
      {origins.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-muted-foreground">
            Changes proposed from work
          </h3>
          <ul className="-mx-2 mt-1">
            {origins.map(({ origin, fact }) => {
              const pr = origin.pullRequests.at(-1);
              const state = origin.deletedAt
                ? pr?.status === "merged"
                  ? "Merged"
                  : "Closed"
                : pr
                  ? pr.status === "merged"
                    ? "Merged"
                    : pr.status === "draft"
                      ? "Draft pull request"
                      : pr.status === "open"
                        ? "In review"
                        : "Closed"
                  : "Branch";
              const href = origin.deletedAt
                ? `${pathname}/history?view=branches`
                : pr && pr.status !== "closed"
                  ? `${pathname}/history?view=pulls&pr=${pr.id}`
                  : `${pathname}?branch=${origin.branchId}`;
              return (
                <li
                  key={origin.id}
                  className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-muted/60"
                >
                  <GitBranch
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <Link
                    href={href}
                    className="min-w-0 flex-1 truncate font-medium outline-none hover:underline focus-visible:underline"
                  >
                    {origin.name}
                  </Link>
                  {fact && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      from{" "}
                      <span className="font-mono tabular-nums">{fact.key}</span>
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {state}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
