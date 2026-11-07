import { formatReference } from "@lictory/core/contracts/references";
import type { PageNode } from "./canonical";
import type { WorkListFilter } from "./schema";

// Markdown of the blocks that show live Work data in a page. A page stores
// only what such a block asks for (a work list's project and filter); the
// Markdown of a commit is derived without reading Work, so it states the
// list's label and that it is live. Exports that run with the reader's
// access (`documentToMarkdown(json, { workList })`) resolve the items at
// that moment into a static list of references: importing it back keeps
// plain references, never a live list.

export type WorkListAttrs = {
  projectId: string | null;
  filter: WorkListFilter;
  filterId: string | null;
  title: string | null;
};
export type ResolvedWorkList = {
  // What the list shows, e.g. "Children of PAY-12".
  label?: string;
  items: readonly { id: string; key: string; title: string }[];
};
export type MarkdownOptions = {
  // Resolves a work list to the items the exporting person can see now;
  // null leaves it unresolved.
  workList?: (attrs: WorkListAttrs) => ResolvedWorkList | null;
};

const RESOLVED = "__resolvedWorkList";

export const workListLabels: Record<WorkListFilter, string> = {
  "epic-children": "Work in this epic",
  iteration: "Work in this iteration",
  label: "Work with this label",
  referenced: "Work referenced on this page",
};

export function workListAttrs(n: PageNode): WorkListAttrs {
  const a = n.attrs ?? {};
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    projectId: text(a.projectId),
    filter: (text(a.filter) ?? "referenced") as WorkListFilter,
    filterId: text(a.filterId),
    title: text(a.title),
  };
}

function escape(text: string) {
  return text.replace(/([\\`*_{}[\]<>|])/g, "\\$1");
}

export function workListMarkdown(n: PageNode): string {
  const attrs = workListAttrs(n);
  const resolved = n.attrs?.[RESOLVED] as ResolvedWorkList | undefined;
  const label = attrs.title ?? resolved?.label ?? workListLabels[attrs.filter];
  const heading = `**${escape(label)}** (live list in Lictory)`;
  if (!resolved) return heading;
  if (!resolved.items.length) return `${heading}\n\n*No work items*`;
  return [
    heading,
    "",
    ...resolved.items.map(
      (item) =>
        `- ${formatReference({ kind: "item", id: item.id }, item.key)} ${escape(item.title)}`,
    ),
  ].join("\n");
}

// A copy of the document whose work lists carry their resolved items.
export function withResolvedWorkLists(
  doc: PageNode,
  options: MarkdownOptions,
): PageNode {
  const resolve = options.workList;
  if (!resolve) return doc;
  const visit = (n: PageNode): PageNode => {
    if (n.type === "workList") {
      const resolved = resolve(workListAttrs(n));
      return resolved
        ? { ...n, attrs: { ...n.attrs, [RESOLVED]: resolved } }
        : n;
    }
    return n.content ? { ...n, content: n.content.map(visit) } : n;
  };
  return visit(doc);
}
