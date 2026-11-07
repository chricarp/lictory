import { useMemo, useState, type ReactNode } from "react";
import { GitCompareArrows, History } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { isCarriedApproval } from "@lictory/core/contracts/decomposition";
import {
  parseMarkdownTree,
  placeQuote,
  textModel,
} from "@lictory/core/editor/markdown-text";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Avatar, Badge, SectionLabel } from "@lictory/ui/primitives";
import { Markdown } from "@lictory/platform/components/items/markdown";
import {
  useItem,
  type Revision,
} from "@lictory/platform/components/items/item-context";
import {
  DiffViewToggle,
  SpecDiff,
  TitleDiff,
  type DiffView,
} from "@lictory/platform/components/review/spec-diff";
import { threadMarks } from "@lictory/platform/components/review/markdown-marks";

// A specification's history, like a page's: Versions (every revision with
// who wrote it, why, the approvals given on it and the revisions accepted
// for and delivered by delivery), and Branches & pull requests. Any two
// revisions can be compared; restoring makes a new revision, it never
// rewrites one.

export type HistoryScreen = {
  kind: "history";
  // The revision on screen (the current one when null).
  revision: string | null;
  // Compared with this revision; null: its previous revision; "none": read.
  compare: string | null;
  // A discussion whose quote is marked in the revision it was written on.
  thread?: string | null;
};

export function HistoryNav({
  current,
  onVersions,
  onBranches,
}: {
  current: "versions" | "branches";
  onVersions: () => void;
  onBranches: () => void;
}) {
  return (
    <nav
      aria-label="Specification history"
      className="flex flex-wrap gap-5 border-b"
    >
      {(
        [
          ["versions", "Versions", onVersions],
          ["branches", "Branches & pull requests", onBranches],
        ] as const
      ).map(([key, title, go]) => (
        <button
          key={key}
          type="button"
          aria-current={current === key ? "page" : undefined}
          onClick={go}
          className={cn(
            "min-h-8 border-b-2 px-1 py-1.5 text-sm transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
            current === key
              ? "border-foreground font-medium text-foreground"
              : "border-transparent text-muted-foreground",
          )}
        >
          {title}
        </button>
      ))}
    </nav>
  );
}

export function RevisionPanel({
  onHistory,
}: {
  onHistory: (screen: Omit<HistoryScreen, "kind">) => void;
}) {
  const { revisions, current, memberName, approvals, userId } = useItem();
  if (!current) return null;
  // "Since my last approval" is the most useful starting point for a reviewer.
  const myLast = approvals
    .filter((a) => a.reviewerId === userId && a.revisionId !== current.id)
    .map((a) => revisions.find((r) => r.id === a.revisionId))
    .filter(Boolean)
    .sort((a, b) => b!.number - a!.number)[0];
  const previous = revisions[1];
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Revision</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {current.number} of {revisions.length}
        </span>
      </div>
      <p className="text-[13px]">
        <span className="font-medium">Revision {current.number}</span>
        <span className="text-muted-foreground">
          {" "}
          · {memberName(current.authorId)} · {relativeTime(current.createdAt)}
        </span>
      </p>
      {current.changeSummary && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {current.changeSummary}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {previous && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onHistory({ revision: current.id, compare: previous.id })
            }
          >
            <GitCompareArrows className="size-3.5" /> vs. revision{" "}
            {previous.number}
          </Button>
        )}
        {myLast && myLast.id !== previous?.id && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onHistory({ revision: current.id, compare: myLast.id })
            }
          >
            Since my approval (r{myLast.number})
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onHistory({ revision: null, compare: null })}
        >
          <History className="size-3.5" /> History
        </Button>
      </div>
    </section>
  );
}

// The approvals given on one revision, as the review panel words them.
function useRevisionApprovals(revisionId: string) {
  const { approvals, reviews, memberName, revisionNumber } = useItem();
  return approvals
    .filter((a) => a.revisionId === revisionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((a) => {
      const responsibility =
        reviews.find((r) => r.id === a.reviewId)?.responsibility ?? "Review";
      const state =
        a.status === "granted"
          ? "valid"
          : isCarriedApproval(a.endReason)
            ? a.endReason!.toLowerCase()
            : a.status === "stale"
              ? `outdated (${a.endReason ?? "specification revised"})`
              : "revoked";
      return {
        id: a.id,
        responsibility,
        reviewer: memberName(a.reviewerId),
        granted: a.status === "granted",
        state,
        revision: revisionNumber(a.revisionId),
      };
    });
}

function Markers({ revision }: { revision: Revision }) {
  const { item, current, approvals, reviews } = useItem();
  const granted = approvals
    .filter((a) => a.revisionId === revision.id && a.status === "granted")
    .map((a) => reviews.find((r) => r.id === a.reviewId)?.responsibility ?? "")
    .filter(Boolean);
  const markers: ReactNode[] = [];
  if (revision.id === current?.id) markers.push(<Badge key="c">Current</Badge>);
  if (revision.id === item.committedRevisionId)
    markers.push(<Badge key="a">Accepted for delivery</Badge>);
  if (revision.id === item.deliveredRevisionId)
    markers.push(
      <Badge key="d" tone="good">
        Delivered
      </Badge>,
    );
  if (granted.length)
    markers.push(
      <Badge key="g" tone="good">
        Approved: {[...new Set(granted)].join(", ")}
      </Badge>,
    );
  return markers.length ? (
    <span className="mt-1.5 flex flex-wrap gap-1">{markers}</span>
  ) : null;
}

export function SpecVersions({
  screen,
  onChange,
}: {
  screen: HistoryScreen;
  onChange: (screen: HistoryScreen) => void;
}) {
  const {
    revisions,
    current,
    memberName,
    mutateConfirmed: mutate,
    base,
    item,
    capabilities,
    readOnly,
    threads,
  } = useItem();
  const [view, setView] = useState<DiffView>("changes");
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const shown =
    revisions.find((r) => r.id === screen.revision) ?? current ?? revisions[0];
  const previous = shown
    ? revisions.find((r) => r.number < shown.number)
    : undefined;
  const compared =
    screen.compare === "none"
      ? undefined
      : screen.compare
        ? revisions.find((r) => r.id === screen.compare)
        : previous;
  // The discussion that linked here, its quote marked in this revision.
  const thread = threads.find((t) => t.id === screen.thread);
  const marks = useMemo(() => {
    const quote = thread?.anchor?.quote;
    if (!thread || !quote || !shown || compared) return undefined;
    const place = placeQuote(textModel(parseMarkdownTree(shown.content)), {
      quote,
      section: thread.anchor?.section ?? "",
      occurrence: thread.anchor?.occurrence,
    });
    return place.kind === "found"
      ? [
          threadMarks([
            {
              from: place.from,
              to: place.to,
              data: { threadId: thread.id, blocking: thread.blocking },
            },
          ]),
        ]
      : undefined;
  }, [thread, shown, compared]);
  const approvals = useRevisionApprovals(shown?.id ?? "");
  if (!shown || !current) return null;
  const select = (revision: string) =>
    onChange({ kind: "history", revision, compare: null });
  const canRestore =
    !readOnly &&
    !item.mainProtected &&
    capabilities.editSpecifications &&
    shown.id !== base.baseRevisionId;
  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <section aria-label="Versions">
        <h2 className="mb-3 text-sm font-semibold">Versions</h2>
        <ol className="space-y-1">
          {revisions.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={r.id === shown.id}
                onClick={() => select(r.id)}
                className={cn(
                  "w-full rounded-xl border p-3 text-left text-[13px] transition-[background-color,border-color] duration-150 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60",
                  r.id === shown.id
                    ? "border-border bg-muted"
                    : "border-transparent",
                )}
              >
                <span className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 font-mono text-xs font-semibold">
                    r{r.number}
                  </span>
                  <span
                    className={cn(
                      "line-clamp-2",
                      r.changeSummary
                        ? "font-medium"
                        : "text-muted-foreground italic",
                    )}
                  >
                    {r.changeSummary ??
                      (r.number === 1 ? "First revision" : "No summary")}
                  </span>
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Avatar
                    userId={r.authorId}
                    name={memberName(r.authorId)}
                    size="xs"
                  />
                  {memberName(r.authorId)}
                  <span aria-hidden>·</span>
                  <time
                    dateTime={r.createdAt}
                    title={absoluteTime(r.createdAt)}
                  >
                    {relativeTime(r.createdAt)}
                  </time>
                </span>
                <Markers revision={r} />
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label="Selected revision" className="min-w-0 space-y-4">
        <div className="space-y-3 border-b pb-4">
          <div>
            {/* One line: a long summary is cut here and read in full in
                the list of versions (and on pointing at it). */}
            <h2 className="flex min-w-0 items-baseline text-lg font-semibold tracking-tight">
              <span className="shrink-0">Revision {shown.number}</span>
              {shown.changeSummary && (
                <span
                  title={shown.changeSummary}
                  className="min-w-0 truncate font-normal text-muted-foreground"
                >
                  &nbsp;· {shown.changeSummary}
                </span>
              )}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {memberName(shown.authorId)} ·{" "}
              <time
                dateTime={shown.createdAt}
                title={absoluteTime(shown.createdAt)}
              >
                {relativeTime(shown.createdAt)}
              </time>
              {shown.id === current.id && " · current"}
            </p>
          </div>
          {approvals.length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {approvals.map((a) => (
                <li
                  key={a.id}
                  className={a.granted ? "" : "text-muted-foreground"}
                >
                  <span className="font-medium">{a.responsibility}</span> ·{" "}
                  {a.reviewer} approved revision {a.revision} · {a.state}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {revisions.length > 1 && (
              <DropdownSelect
                aria-label="Compare with"
                variant="secondary"
                className="w-auto min-w-44"
                value={compared?.id ?? "none"}
                onValueChange={(value) =>
                  onChange({
                    kind: "history",
                    revision: shown.id,
                    compare: value,
                  })
                }
              >
                <DropdownSelectOption value="none">
                  Read this revision
                </DropdownSelectOption>
                {revisions
                  .filter((r) => r.id !== shown.id)
                  .map((r) => (
                    <DropdownSelectOption key={r.id} value={r.id}>
                      Compare with revision {r.number}
                    </DropdownSelectOption>
                  ))}
              </DropdownSelect>
            )}
            {compared && <DiffViewToggle view={view} onChange={setView} />}
            {canRestore && !confirm && (
              <Button variant="secondary" onClick={() => setConfirm(true)}>
                Restore revision {shown.number}
              </Button>
            )}
          </div>
          {!readOnly &&
            item.mainProtected &&
            capabilities.editSpecifications && (
              <p className="text-sm text-muted-foreground">
                Main is protected. Use a branch and pull request to restore
                earlier content.
              </p>
            )}
          {canRestore && confirm && (
            <div className="space-y-2 rounded-xl p-3 ring-1 ring-foreground/10">
              <p className="text-sm">
                Restore revision {shown.number} as a new main revision. Existing
                approvals will require review again.
              </p>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  disabled={restoring}
                  onClick={async () => {
                    setRestoring(true);
                    setError("");
                    try {
                      await mutate({
                        type: "revertSpecification",
                        ...base,
                        revisionId: shown.id,
                      });
                      setConfirm(false);
                      onChange({
                        kind: "history",
                        revision: null,
                        compare: null,
                      });
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not restore revision.",
                      );
                    } finally {
                      setRestoring(false);
                    }
                  }}
                >
                  Confirm restore revision {shown.number}
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
        {compared ? (
          <>
            <TitleDiff before={compared.title} after={shown.title} />
            <SpecDiff
              before={compared.content}
              after={shown.content}
              beforeLabel={`Revision ${compared.number}`}
              afterLabel={`Revision ${shown.number}`}
              view={view}
              onViewChange={setView}
            />
          </>
        ) : (
          <article aria-label={`Revision ${shown.number}`}>
            {thread && !marks && (
              <p className="mb-3 text-xs text-warning">
                The quoted text is not in this revision.
              </p>
            )}
            <div data-spec-root>
              <Markdown source={shown.content} marks={marks} />
            </div>
          </article>
        )}
      </section>
    </div>
  );
}
