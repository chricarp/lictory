import { useMemo, useState } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@lictory/zero/queries";
import type { SpaceEntityOf } from "@lictory/core/contracts/protocol";
import { categoryOrder } from "@lictory/core/lib/work-items";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpacePages } from "@lictory/platform/components/spaces/store";
import {
  MoreRows,
  rollup,
  useWorkFacts,
  WorkRow,
  type WorkFact,
} from "@lictory/platform/components/spaces/work/work-row";

// A project or team space's "Linked work": the work items linked to its
// pages (mentioned in a published version, created from a page, attached
// to an item, cited by a specification), each once with how it is linked,
// open work first, with how much is done. Read from the space's knowledge
// links (`spaceWork`), so only readers of the space get them; items the
// reader cannot see are left out.

const PAGE = 6;

type Link = SpaceEntityOf<
  | "pageReference"
  | "workItemSource"
  | "pageAttachment"
  | "specificationCitation"
>;
// How an item is linked, in a few words, then where: "Mentioned, attached
// · Capture retry design", "Created from Refund runbook · cited in its
// spec", "Mentioned, cited in its spec · 2 pages".
const relationWords = [
  ["pageReference", "mentioned"],
  ["pageAttachment", "attached"],
  ["specificationCitation", "cited in its spec"],
] as const;

function linkDetail(on: ReadonlyMap<Link["type"], ReadonlySet<string>>) {
  const words = relationWords.flatMap(([type, word]) =>
    on.has(type) ? [word] : [],
  );
  const source = on.get("workItemSource");
  const pages = new Set([...on.values()].flatMap((set) => [...set]));
  const where = pages.size === 1 ? [...pages][0]! : `${pages.size} pages`;
  const parts = source
    ? [
        `Created from ${[...source][0]}`,
        words.join(", "),
        pages.size > 1 ? where : "",
      ]
    : [words.join(", "), where];
  const text = parts.filter(Boolean).join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function SpaceLinkedWork({ spaceId }: { spaceId: string }) {
  const { organization } = useWorkspace();
  const [rows] = useQuery(
    queries.spaceWork({ organizationId: organization.id, spaceId }),
    { ttl: "5m" },
  );
  const pages = useSpacePages(spaceId);
  const facts = useWorkFacts();
  const [visible, setVisible] = useState(PAGE);
  const linked = useMemo(() => {
    const titles = new Map(pages.map((p) => [p.id, p.title]));
    const byItem = new Map<
      string,
      { fact: WorkFact; on: Map<Link["type"], Set<string>> }
    >();
    for (const row of rows as { data: unknown }[]) {
      const link = row.data as Link;
      if (link.type === "specificationCitation" && !link.revisions.length)
        continue;
      const fact = facts.get(link.workItemId);
      const title = titles.get(link.pageId);
      if (!fact || !title) continue;
      const entry = byItem.get(link.workItemId) ?? {
        fact,
        on: new Map<Link["type"], Set<string>>(),
      };
      const set = entry.on.get(link.type) ?? new Set<string>();
      set.add(title);
      entry.on.set(link.type, set);
      byItem.set(link.workItemId, entry);
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
    return [...byItem.values()]
      .map(({ fact, on }) => ({
        fact,
        detail: linkDetail(on),
      }))
      .sort(
        (a, b) =>
          order(a.fact) - order(b.fact) || a.fact.key.localeCompare(b.fact.key),
      );
  }, [rows, pages, facts]);
  if (!linked.length) return null;
  const { done, total } = rollup(linked.map((l) => l.fact));
  const started = linked.filter(
    (l) => l.fact.status.category === "started",
  ).length;
  const shown = linked.slice(0, visible);
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
        {shown.map(({ fact, detail }) => (
          <WorkRow key={fact.item.id} fact={fact} detail={detail} showOwner />
        ))}
      </ul>
      <MoreRows
        total={linked.length}
        visible={visible}
        page={PAGE}
        onChange={setVisible}
      />
    </section>
  );
}
