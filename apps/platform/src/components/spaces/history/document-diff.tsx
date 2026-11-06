import { useMemo } from "react";
import { diffDocuments } from "@lictory/core/spaces/document/diff";
import {
  canonicalizeDocument,
  type PageNode,
} from "@lictory/core/spaces/document/canonical";
import { PageReader } from "@lictory/platform/components/spaces/editor/document";

export function DocumentDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  if (before === after) return null;
  return (
    <div className="overflow-hidden rounded-lg border text-sm">
      <div className="border-b bg-destructive/8 px-4 py-3">
        <span className="mr-3 font-medium">− Before</span>
        {before || "Untitled"}
      </div>
      <div className="bg-success/8 px-4 py-3">
        <span className="mr-3 font-medium">+ After</span>
        {after || "Untitled"}
      </div>
    </div>
  );
}

// Compare whole top-level blocks so nested lists and tables retain their schema
// and are never rendered twice as both a parent change and a child change.
export function RenderedDocumentDiff({
  before,
  after,
  beforeLabel = "Base version",
  afterLabel = "Result",
}: {
  before: unknown;
  after: unknown;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const comparison = useMemo(() => {
    const base = canonicalizeDocument(before),
      result = canonicalizeDocument(after);
    const old = new Map(
      (base.content ?? []).map((node) => [String(node.attrs?.id), node]),
    );
    const next = new Map(
      (result.content ?? []).map((node) => [String(node.attrs?.id), node]),
    );
    const placeholder =
      base.content?.length === 1 &&
      base.content[0]?.type === "paragraph" &&
      !base.content[0].content?.length
        ? String(base.content[0].attrs?.id)
        : null;
    return diffDocuments(base, result)
      .filter(
        (change) =>
          !(change.kind === "removed" && change.blockId === placeholder),
      )
      .filter(
        (change) =>
          change.kind !== "unchanged" &&
          (old.has(change.blockId) || next.has(change.blockId)),
      )
      .map((change) => ({
        ...change,
        before: old.get(change.blockId),
        after: next.get(change.blockId),
      }));
  }, [before, after]);
  const groups: { kind: string; before: PageNode[]; after: PageNode[] }[] = [];
  for (const change of comparison) {
    let group = groups.at(-1);
    if (group?.kind !== change.kind) {
      group = { kind: change.kind, before: [], after: [] };
      groups.push(group);
    }
    if (change.before) group.before.push(change.before);
    if (change.after) group.after.push(change.after);
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {beforeLabel} → {afterLabel}
        </span>
        <span>
          {comparison.length}{" "}
          {comparison.length === 1 ? "block changed" : "blocks changed"}
        </span>
      </div>
      {!comparison.length && (
        <p className="rounded-lg bg-muted/50 p-5 text-sm text-muted-foreground">
          No document changes between these versions.
        </p>
      )}
      {groups.map((change, index) => (
        <section
          key={index}
          aria-label={`${change.kind} block`}
          className="overflow-hidden rounded-xl border"
        >
          <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium">
            <span className="capitalize">{change.kind}</span>
            {change.kind === "moved" && (
              <span className="text-muted-foreground">Position changed</span>
            )}
          </div>
          {change.before.length > 0 && (
            <Block nodes={change.before} kind="removed" label={beforeLabel} />
          )}
          {change.after.length > 0 && (
            <Block nodes={change.after} kind="added" label={afterLabel} />
          )}
        </section>
      ))}
    </div>
  );
}
function Block({
  nodes,
  kind,
  label,
}: {
  nodes: PageNode[];
  kind: "added" | "removed";
  label: string;
}) {
  const content = useMemo(() => ({ type: "doc", content: nodes }), [nodes]);
  return (
    <div
      className={`border-l-2 px-5 py-4 [&_.page-document]:min-h-0 ${kind === "added" ? "border-l-success bg-success/5" : "border-l-destructive bg-destructive/5"}`}
    >
      <p className="mb-3 text-xs font-medium text-muted-foreground">
        {kind === "added" ? "+" : "−"} {label}
      </p>
      <PageReader content={content} label={`${label}: ${kind} content`} />
    </div>
  );
}
