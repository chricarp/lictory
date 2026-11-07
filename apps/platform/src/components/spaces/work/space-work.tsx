import { useMemo, useState } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@lictory/zero/queries";
import type { SpaceEntityOf } from "@lictory/core/contracts/protocol";
import { categoryOrder } from "@lictory/core/lib/work-items";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpacePages } from "@lictory/platform/components/spaces/store";
import {
  rollup,
  useWorkFacts,
  WorkRow,
  type WorkFact,
} from "@lictory/platform/components/spaces/work/work-row";

// A project or team space's "Linked work": the work items its published
// pages mention, open work first, with how much is done. Read from the
// space's page references (`spaceWork`), so only readers of the space get
// them; items the reader cannot see are left out.

const VISIBLE = 6;

export function SpaceLinkedWork({ spaceId }: { spaceId: string }) {
  const { organization } = useWorkspace();
  const [rows] = useQuery(
    queries.spaceWork({ organizationId: organization.id, spaceId }),
    { ttl: "5m" },
  );
  const pages = useSpacePages(spaceId);
  const facts = useWorkFacts();
  const [expanded, setExpanded] = useState(false);
  const linked = useMemo(() => {
    const titles = new Map(pages.map((p) => [p.id, p.title]));
    const byItem = new Map<string, { fact: WorkFact; pages: string[] }>();
    for (const row of rows as { data: unknown }[]) {
      const ref = row.data as SpaceEntityOf<"pageReference">;
      const fact = facts.get(ref.workItemId);
      const title = titles.get(ref.pageId);
      if (!fact || !title) continue;
      const entry = byItem.get(ref.workItemId) ?? { fact, pages: [] };
      entry.pages.push(title);
      byItem.set(ref.workItemId, entry);
    }
    // Open work first (in progress, then not started), done and canceled last.
    const order = (f: WorkFact) => {
      const c = f.status.category;
      return c === "started"
        ? 0
        : c === "done" || c === "canceled"
          ? 3 + categoryOrder.indexOf(c)
          : 1;
    };
    return [...byItem.values()].sort(
      (a, b) =>
        order(a.fact) - order(b.fact) || a.fact.key.localeCompare(b.fact.key),
    );
  }, [rows, pages, facts]);
  if (!linked.length) return null;
  const { done, total } = rollup(linked.map((l) => l.fact));
  const started = linked.filter(
    (l) => l.fact.status.category === "started",
  ).length;
  const shown = expanded ? linked : linked.slice(0, VISIBLE);
  return (
    <section aria-labelledby="space-work" className="mt-10">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <h2 id="space-work" className="text-sm font-semibold">
          Linked work{" "}
          <span className="ml-0.5 font-normal text-muted-foreground tabular-nums">
            {linked.length}
          </span>
        </h2>
        <span
          className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums"
          data-testid="space-work-rollup"
        >
          <span
            aria-hidden
            className="relative h-1 w-16 overflow-hidden rounded-full bg-muted"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-success"
              style={{ width: `${total ? (done / total) * 100 : 0}%` }}
            />
          </span>
          {started > 0 && `${started} in progress · `}
          {done} of {total} done
        </span>
      </div>
      <ul className="rounded-2xl border border-transparent bg-card p-1.5 shadow-(--shadow-border)">
        {shown.map(({ fact, pages: on }) => (
          <WorkRow
            key={fact.item.id}
            fact={fact}
            detail={on.length === 1 ? `in ${on[0]}` : `in ${on.length} pages`}
            showOwner
          />
        ))}
      </ul>
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
    </section>
  );
}
