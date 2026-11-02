import { useState } from "react";
import { Archive, ArchiveRestore, BookOpen, Plus, Search } from "lucide-react";
import { Button } from "@lictory/ui/button";
import { SectionLabel } from "@lictory/ui/primitives";
import { MarkdownEditor } from "@lictory/platform/components/ui/markdown-editor";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { useItem } from "@lictory/platform/components/items/item-context";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  canArchiveDecision,
  canRecordDecisions,
  type EntityOf,
} from "@lictory/core/contracts/protocol";
import { Link } from "@lictory/platform/lib/navigation";

type KnowledgeResult = {
  id: string;
  title: string;
  excerpt: string;
  kind: "decision" | "approved" | "delivered";
  key: string;
  revisionNumber: number;
  href: string;
};

export function Decisions() {
  const {
    entities,
    item,
    current,
    readOnly,
    capabilities,
    userId,
    memberName,
    revisionNumber,
    base,
    mutateConfirmed,
  } = useItem();
  const decisions = entities.filter(
    (e): e is EntityOf<"decision"> => e.type === "decision",
  );
  const [showArchived, setShowArchived] = useState(false);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceThreadId, setSourceThreadId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const canRecord = !readOnly && canRecordDecisions(capabilities);
  const sources = entities.filter(
    (e) =>
      e.type === "thread" &&
      e.status === "resolved" &&
      !e.pullRequestId &&
      !e.suggestionId,
  );
  const run = async (command: Parameters<typeof mutateConfirmed>[0]) => {
    setPending(true);
    setError(undefined);
    try {
      await mutateConfirmed(command);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The decision was not saved.");
      return false;
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <BookOpen className="size-3.5 text-muted-foreground" />
        <SectionLabel>Decisions</SectionLabel>
        {canRecord && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setComposing(true)}
          >
            <Plus className="size-3.5" /> Record decision
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Keep agreed conclusions with their original revision. Recording a
        decision does not approve the specification.
      </p>
      {decisions
        .filter((d) => showArchived || !d.archivedAt)
        .map((d) => (
          <article
            key={d.id}
            className="space-y-2 rounded-lg border bg-card p-3"
          >
            <div className="flex items-start gap-2">
              <h3 className="flex-1 text-sm font-medium">
                {d.title}
                {d.archivedAt && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    Archived
                  </span>
                )}
              </h3>
              {!readOnly && canArchiveDecision(capabilities, d, userId) && (
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={pending}
                  aria-label={`${d.archivedAt ? "Restore" : "Archive"} decision: ${d.title}`}
                  onClick={() =>
                    void run({
                      type: "setDecisionArchived",
                      workItemId: item.id,
                      decisionId: d.id,
                      archived: !d.archivedAt,
                    })
                  }
                >
                  {d.archivedAt ? (
                    <ArchiveRestore className="size-3.5" />
                  ) : (
                    <Archive className="size-3.5" />
                  )}
                </Button>
              )}
            </div>
            <Markdown source={d.body} />
            <p className="text-xs text-muted-foreground">
              {memberName(d.authorId)} · revision{" "}
              {revisionNumber(d.revisionId) ?? "earlier"}
              {d.sourceThreadId && " · from a resolved discussion"}
            </p>
          </article>
        ))}
      {decisions.some((d) => d.archivedAt) && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />{" "}
          Show archived decisions
        </label>
      )}
      {composing && (
        <form
          className="space-y-3 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              if (
                await run({
                  type: "recordDecision",
                  ...base,
                  decisionId: crypto.randomUUID(),
                  title: title.trim(),
                  body: body.trim(),
                  ...(sourceThreadId ? { sourceThreadId } : {}),
                })
              ) {
                setTitle("");
                setBody("");
                setSourceThreadId("");
                setComposing(false);
              }
            })();
          }}
        >
          <label className="block space-y-1 text-xs font-medium">
            Conclusion
            <input
              aria-label="Decision title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={240}
              required
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              placeholder="Retries reuse the original transaction ID"
            />
          </label>
          <MarkdownEditor
            aria-label="Decision details"
            value={body}
            onValueChange={setBody}
            placeholder="What was agreed, why, and any limits…"
            rows={3}
          />
          {sources.length > 0 && (
            <label className="block space-y-1 text-xs font-medium">
              Source discussion
              <select
                aria-label="Decision source discussion"
                value={sourceThreadId}
                onChange={(e) => setSourceThreadId(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Current revision {current?.number}</option>
                {sources.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.type === "thread"
                      ? (t.anchor?.quote ??
                        t.anchor?.section ??
                        "Resolved discussion")
                      : "Discussion"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setComposing(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={pending || !title.trim() || !body.trim()}
            >
              Save decision
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <RelatedKnowledge />
    </section>
  );
}

function RelatedKnowledge() {
  const { item } = useItem();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
        <Search className="size-3.5" /> Find related agreements
      </Button>
      {open && (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setLoading(true);
              setError(undefined);
              void callCapability<{ results: KnowledgeResult[] }>(
                "searchProductKnowledge",
                {
                  organizationId: item.organizationId,
                  projectId: item.projectId,
                  query,
                  limit: 5,
                },
              )
                .then((r) => setResults(r.results))
                .catch((e: unknown) =>
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Could not find agreements.",
                  ),
                )
                .finally(() => setLoading(false));
            }}
          >
            <input
              aria-label="Search product agreements"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={200}
              placeholder="Search decisions and specifications…"
              className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={loading}
            >
              Search
            </Button>
          </form>
          {results?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No recorded decisions or approved or delivered specifications
              match.
            </p>
          )}
          {results?.map((r) => (
            <div key={`${r.kind}:${r.id}`} className="rounded-md border p-3">
              <Link
                href={r.href}
                className="text-sm font-medium hover:underline"
              >
                {r.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {r.key} · revision {r.revisionNumber} ·{" "}
                {r.kind === "decision"
                  ? "Recorded conclusion"
                  : r.kind === "delivered"
                    ? "Recorded delivered scope"
                    : "Approved intent"}
              </p>
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                {r.excerpt}
              </p>
            </div>
          ))}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
