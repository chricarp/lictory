import { useId, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { spaceLevelAtLeast } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  usePageHistory,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import { Dialog } from "@lictory/platform/components/spaces/dialog";

// "Add to a page" on a recorded decision: proposes a change to a page I can
// edit that appends the decision as a card, as a page branch and pull
// request opened from the item's revision. The published page never
// changes here; the space's reviewers (or its editors, in a Direct space)
// merge it. The decision's text stays in Work; the page shows it live.

type Decision = { id: string; title: string; revisionId: string | null };

const LIMIT = 30;

export function AddDecisionToPage({
  decision,
  workItemId,
  revisionId,
  onClose,
}: {
  decision: Decision;
  workItemId: string;
  // The item revision the proposal is opened from.
  revisionId: string;
  onClose: () => void;
}) {
  const { organization, mutateConfirmed } = useWorkspace();
  const { index, levelOf } = useSpaces();
  const [query, setQuery] = useState("");
  const [pageId, setPageId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [proposed, setProposed] = useState<string>();
  const listId = useId();
  const history = usePageHistory(pageId);

  const pages = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...index.pageById.values()]
      .filter((p) => {
        const space = index.spaceById.get(p.spaceId);
        return (
          space &&
          !space.archivedAt &&
          !p.archivedAt &&
          spaceLevelAtLeast(levelOf(space.id), "edit") &&
          (!q || p.title.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, LIMIT)
      .map((p) => ({ page: p, space: index.spaceById.get(p.spaceId)! }));
  }, [index, levelOf, query]);
  const chosen = pages.find((p) => p.page.id === pageId) ?? null;
  const head = history.head;

  const propose = async () => {
    if (!chosen || !head || pending) return;
    setPending(true);
    setError(undefined);
    const blocks = [
      ...((head.content.content as Record<string, unknown>[] | undefined) ??
        []),
    ];
    // An empty last paragraph is replaced rather than kept above the card.
    const last = blocks.at(-1);
    if (last?.type === "paragraph" && !last.content) blocks.pop();
    const branchId = crypto.randomUUID();
    const pullRequestId = crypto.randomUUID();
    try {
      await mutateConfirmed({
        type: "proposePageChange",
        pageId: chosen.page.id,
        branchId,
        pullRequestId,
        title: head.title,
        content: {
          ...head.content,
          content: [
            ...blocks,
            {
              type: "paragraph",
              content: [
                {
                  type: "decisionRef",
                  attrs: { decisionId: decision.id, label: decision.title },
                },
              ],
            },
          ],
        } as unknown as Record<string, never>,
        message: `Add decision: ${decision.title}`.slice(0, 2000),
        origin: { workItemId, revisionId },
      });
      setProposed(
        `${paths.spacePage(organization.slug, chosen.space.slug, chosen.page.id)}/history?view=pulls&pr=${pullRequestId}`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change could not be proposed.",
      );
    } finally {
      setPending(false);
    }
  };

  if (proposed && chosen)
    return (
      <Dialog
        title="Change proposed"
        description={`“${chosen.page.title}” gets the decision once the pull request is merged.`}
        onClose={onClose}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
            <Link href={proposed} className="contents">
              <Button>Open the pull request</Button>
            </Link>
          </>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          Nothing on the published page changed. Reviewers of{" "}
          {chosen.space.name} see the proposal with the other changes to the
          page.
        </p>
      </Dialog>
    );

  return (
    <Dialog
      title="Add the decision to a page"
      description={
        <>
          Proposes a change that adds{" "}
          <span className="font-medium text-foreground">
            “{decision.title}”
          </span>{" "}
          to the end of a page, for review. The published page does not change
          until the proposal is merged.
        </>
      }
      onClose={onClose}
      onSubmit={() => void propose()}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!chosen || !head || pending}>
            {pending ? "Proposing…" : "Propose change"}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Input
          data-autofocus
          aria-label="Find a page"
          aria-controls={listId}
          value={query}
          placeholder="Find a page you can edit"
          onChange={(e) => setQuery(e.target.value)}
        />
        {pages.length ? (
          <div
            id={listId}
            role="radiogroup"
            aria-label="Pages"
            className="max-h-72 space-y-0.5 overflow-y-auto"
          >
            {pages.map(({ page, space }) => (
              <label
                key={page.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] has-focus-visible:ring-2 has-focus-visible:ring-ring/60",
                  page.id === pageId ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <input
                  type="radio"
                  name="decision-page"
                  value={page.id}
                  checked={page.id === pageId}
                  onChange={() => setPageId(page.id)}
                  className="sr-only"
                />
                <FileText
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {page.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {space.name}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="px-1 py-3 text-[13px] text-muted-foreground">
            {query.trim()
              ? "No page you can edit matches."
              : "There is no page you can edit."}
          </p>
        )}
        {chosen && !head && (
          <p className="text-xs text-muted-foreground">Loading the page…</p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
