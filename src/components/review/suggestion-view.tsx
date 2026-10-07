"use client";
import { useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  GitMerge,
  GitPullRequestDraft,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { relativeTime } from "~/lib/work-items";
import { canReviewSuggestions, type EntityOf } from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { MarkdownEditor } from "~/components/ui/markdown-editor";
import { Picker, Popover } from "~/components/ui/popover";
import { Avatar, Badge, Kbd, SectionLabel } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import { RevisionDiff } from "~/components/items/diff";
import { Markdown } from "~/components/items/markdown";
import { useItem } from "~/components/items/item-context";
import { Thread, ThreadComposer } from "./threads";
import { SuggestionStatusBadge, useSuggestionState } from "./suggestions";
import { SuggestionDetailsFields } from "./suggestion-details";

// A suggestion is reviewed like a pull request: the author drafts, opens for
// review, chooses reviewers and pushes new versions; reviewers approve or ask
// for changes; an assigned reviewer merges it into the next revision.
export function SuggestionView({
  suggestionId,
  onClose,
}: {
  suggestionId: string;
  onClose: () => void;
}) {
  const { suggestions } = useItem();
  const suggestion = suggestions.find((s) => s.id === suggestionId);
  if (!suggestion)
    return (
      <div className="space-y-3">
        <BackButton onClick={onClose} />
        <p className="text-[13px] text-muted-foreground">
          This suggestion is unavailable.
        </p>
      </div>
    );
  return <SuggestionBody suggestion={suggestion} onClose={onClose} />;
}

function SuggestionBody({
  suggestion,
  onClose,
}: {
  suggestion: EntityOf<"suggestion">;
  onClose: () => void;
}) {
  const {
    revisions,
    current,
    userId,
    memberName,
    mutate,
    base,
    item,
    readOnly,
    canEdit,
    revisionNumber,
    suggestionThreads,
  } = useItem();
  const [editing, setEditing] = useState(false);
  const [showProposed, setShowProposed] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState<{
    quote?: string;
    section: string;
  } | null>(null);
  const [error, setError] = useState<string>();
  const state = useSuggestionState(suggestion);
  const isAuthor = suggestion.authorId === userId;
  const isReviewer = state.reviewers.some((r) => r.userId === userId);
  const target = revisions.find((r) => r.id === suggestion.revisionId);
  const threads = suggestionThreads.filter(
    (t) => t.suggestionId === suggestion.id,
  );
  const openThreads = threads.filter((t) => t.status === "open");
  const resolvedThreads = threads.filter((t) => t.status === "resolved");
  const run = async (command: Parameters<typeof mutate>[0]) => {
    setError(undefined);
    try {
      await mutate(command);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed.");
    }
  };
  const setStatus = (status: "draft" | "open" | "closed") =>
    run({
      type: "setSuggestionState",
      workItemId: item.id,
      suggestionId: suggestion.id,
      status,
    });
  const mergeBlockers: string[] = [];
  if (state.outdated)
    mergeBlockers.push(
      `the specification moved to revision ${current?.number}; the author must update the suggestion`,
    );
  if (state.approvals.length === 0)
    mergeBlockers.push(`version ${suggestion.version} has no approval yet`);
  if (state.blocking.length)
    mergeBlockers.push(
      `${state.blocking.length} blocking discussion${state.blocking.length > 1 ? "s are" : " is"} open`,
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <BackButton onClick={onClose} />
        <SuggestionStatusBadge suggestion={suggestion} />
        <span className="ml-auto text-xs text-muted-foreground">
          v{suggestion.version} · against revision{" "}
          {revisionNumber(suggestion.revisionId) ?? "?"}
          {suggestion.status === "merged" && suggestion.mergedRevisionId
            ? ` · merged as revision ${revisionNumber(suggestion.mergedRevisionId) ?? ""}`
            : ""}
        </span>
      </div>
      <header>
        <h2 className="text-lg font-semibold tracking-tight">
          {suggestion.title ?? suggestion.rationale ?? "Proposed change"}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Avatar name={memberName(suggestion.authorId)} size="xs" />
          <span className="font-medium text-foreground">
            {memberName(suggestion.authorId)}
          </span>
          proposed {relativeTime(suggestion.createdAt)}
          {suggestion.updatedAt !== suggestion.createdAt && (
            <> · updated {relativeTime(suggestion.updatedAt)}</>
          )}
          {suggestion.resolvedAt && suggestion.resolvedById && (
            <>
              {" "}
              · {suggestion.status} by {memberName(suggestion.resolvedById)}{" "}
              {relativeTime(suggestion.resolvedAt)}
            </>
          )}
        </p>
      </header>

      {suggestion.title && suggestion.rationale && !editing && (
        <section className="rounded-lg border bg-card p-4">
          <SectionLabel>Description</SectionLabel>
          <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap">
            {suggestion.rationale}
          </p>
        </section>
      )}

      {state.outdated && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px]">
          <CircleAlert className="size-4 shrink-0 text-warning" />
          <span>
            The specification moved to revision {current?.number} since this was
            written against revision {target?.number}.{" "}
            {isAuthor
              ? "Update the suggestion against the current text before it can be merged."
              : "The author must update it before it can be merged."}
          </span>
          {isAuthor && !readOnly && !editing && (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={() => setEditing(true)}
            >
              Update against revision {current?.number}
            </Button>
          )}
        </div>
      )}

      {!readOnly && !state.settled && !editing && (
        <div className="flex flex-wrap items-center gap-1">
          {isAuthor && (
            <>
              {suggestion.status === "draft" ? (
                <Button size="sm" onClick={() => setStatus("open")}>
                  Open for review
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStatus("draft")}
                >
                  <GitPullRequestDraft className="size-3.5" /> Convert to draft
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3.5" /> Edit proposal
              </Button>
            </>
          )}
          {(isAuthor || canEdit) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setStatus("closed")}
            >
              <X className="size-3.5" /> Close
            </Button>
          )}
          {isReviewer && canEdit && suggestion.status === "open" && (
            <Button
              size="sm"
              className="ml-auto"
              disabled={!state.mergeable}
              title={
                state.mergeable
                  ? `Create revision ${(current?.number ?? 0) + 1} from this suggestion`
                  : `Cannot merge: ${mergeBlockers.join("; ")}.`
              }
              onClick={() =>
                run({
                  type: "mergeSuggestion",
                  ...base,
                  suggestionId: suggestion.id,
                })
              }
            >
              <GitMerge className="size-3.5" /> Merge as revision{" "}
              {(current?.number ?? 0) + 1}
            </Button>
          )}
        </div>
      )}
      {!readOnly && suggestion.status === "closed" && isAuthor && (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setStatus("open")}
          >
            <RotateCcw className="size-3.5" /> Reopen for review
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStatus("draft")}>
            Reopen as draft
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {editing && current ? (
        <SuggestionEditor
          suggestion={suggestion}
          onDone={() => setEditing(false)}
        />
      ) : (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <SectionLabel>Changes</SectionLabel>
            <span className="text-xs text-muted-foreground">
              revision {target?.number ?? "?"} → proposed v{suggestion.version}
            </span>
            <button
              type="button"
              onClick={() => setShowProposed((v) => !v)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              {showProposed ? "Show diff" : "Show proposed text"}
            </button>
          </div>
          {showProposed ? (
            <div className="rounded-md border p-4">
              <Markdown source={suggestion.replacement} />
            </div>
          ) : (
            <RevisionDiff
              before={target?.content ?? ""}
              after={suggestion.replacement}
            />
          )}
        </section>
      )}

      <Reviewers suggestion={suggestion} onError={setError} />

      <section>
        <div className="mb-2 flex items-center gap-2">
          <SectionLabel>Discussion</SectionLabel>
          <span className="text-xs text-muted-foreground tabular-nums">
            {openThreads.length} open
            {state.blocking.length
              ? ` · ${state.blocking.length} blocking`
              : ""}
          </span>
          {resolvedThreads.length > 0 && (
            <button
              onClick={() => setShowResolved((v) => !v)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              {showResolved ? "Hide" : "Show"} {resolvedThreads.length} resolved
            </button>
          )}
        </div>
        <div className="space-y-3">
          {openThreads.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              No open discussion about this proposal. A blocking discussion
              prevents merging until it is resolved.
            </p>
          )}
          {openThreads.map((t) => (
            <Thread key={t.id} thread={t} />
          ))}
          {showResolved &&
            resolvedThreads.map((t) => <Thread key={t.id} thread={t} />)}
        </div>
        {!readOnly && !state.settled && (
          <div className="mt-4">
            <ThreadComposer
              draft={draft}
              onDraftChange={setDraft}
              suggestionId={suggestion.id}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <ArrowLeft className="size-3.5" /> Specification
    </Button>
  );
}

// Who was asked, what they decided about the current version, and the
// reviewer's own controls. Only the author chooses reviewers, and only people
// holding a role that can both edit and review are eligible.
function Reviewers({
  suggestion,
  onError,
}: {
  suggestion: EntityOf<"suggestion">;
  onError: (message?: string) => void;
}) {
  const { directory } = useWorkspace();
  const { userId, memberName, mutate, item, readOnly, suggestionDecisions } =
    useItem();
  const state = useSuggestionState(suggestion);
  const [historyOpen, setHistoryOpen] = useState(false);
  const isAuthor = suggestion.authorId === userId;
  const isReviewer = state.reviewers.some((r) => r.userId === userId);
  const history = suggestionDecisions
    .filter((d) => d.suggestionId === suggestion.id && d.supersededAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const eligible = directory.members.filter(
    (m) =>
      m.id !== suggestion.authorId &&
      canReviewSuggestions(directory.roles, m.id) &&
      !state.reviewers.some((r) => r.userId === m.id),
  );
  const decide = (decision: "approve" | "changes_requested" | "revoke") =>
    mutate({
      type: "decideSuggestion",
      workItemId: item.id,
      suggestionId: suggestion.id,
      version: suggestion.version,
      decision,
    }).catch((e: unknown) =>
      onError(e instanceof Error ? e.message : "The decision failed."),
    );
  const mine = state.decisions.find((d) => d.reviewerId === userId);
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Reviewers</SectionLabel>
        {state.reviewers.length > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              state.approvals.length > 0
                ? "text-success"
                : "text-muted-foreground",
            )}
          >
            {state.approvals.length} / {state.reviewers.length} approved v
            {suggestion.version}
          </span>
        )}
        {isAuthor && !readOnly && !state.settled && (
          <Popover
            width={300}
            align="end"
            trigger={(props) => (
              <Button
                {...props}
                variant="ghost"
                size="sm"
                className="-mr-2 ml-auto"
                aria-label="Add reviewer"
              >
                <Plus className="size-3.5" /> Add reviewer
              </Button>
            )}
          >
            {(close) =>
              eligible.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  Nobody else is eligible. Reviewers need a role that can both
                  edit Epics and Stories and be asked to review.
                </p>
              ) : (
                <Picker
                  title="Reviewer"
                  hideSearch={eligible.length < 8}
                  options={eligible.map((m) => ({
                    value: m.id,
                    label: m.name,
                    hint: m.email,
                    keywords: m.email,
                    icon: <Avatar name={m.name} size="xs" />,
                  }))}
                  onSelect={(id) => {
                    close();
                    void mutate({
                      type: "setSuggestionReviewer",
                      workItemId: item.id,
                      suggestionId: suggestion.id,
                      userId: id,
                      assigned: true,
                    }).catch((e: unknown) =>
                      onError(
                        e instanceof Error
                          ? e.message
                          : "Could not add the reviewer.",
                      ),
                    );
                  }}
                />
              )
            }
          </Popover>
        )}
      </div>
      {state.reviewers.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {isAuthor
            ? "Nobody has been asked yet. Add a reviewer who can edit Epics and Stories; their approval lets them merge this into the specification."
            : "No reviewer assigned yet. Only an assigned reviewer can approve and merge this suggestion."}
        </p>
      ) : (
        <ul className="space-y-1">
          {state.reviewers.map((r) => {
            const decision = state.decisions.find(
              (d) => d.reviewerId === r.userId,
            );
            const stale = decision && decision.version !== suggestion.version;
            return (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-[13px]"
              >
                {decision?.decision === "approved" && !stale ? (
                  <Check className="size-4 text-success" />
                ) : decision?.decision === "changes_requested" && !stale ? (
                  <CircleAlert className="size-4 text-warning" />
                ) : (
                  <span className="grid size-4 place-items-center rounded-full border border-dashed border-muted-foreground/60" />
                )}
                <Avatar name={memberName(r.userId)} size="xs" />
                <span className="font-medium">
                  {memberName(r.userId)}
                  {r.userId === userId ? " (me)" : ""}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {!decision || stale
                    ? `Pending on v${suggestion.version}`
                    : decision.decision === "approved"
                      ? `Approved v${decision.version}`
                      : `Requested changes on v${decision.version}`}
                </span>
                {isAuthor && !readOnly && !state.settled && (
                  <button
                    aria-label={`Remove ${memberName(r.userId)} as reviewer`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      void mutate({
                        type: "setSuggestionReviewer",
                        workItemId: item.id,
                        suggestionId: suggestion.id,
                        userId: r.userId,
                        assigned: false,
                      })
                    }
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {isReviewer && !readOnly && suggestion.status === "open" && (
        <div className="mt-2 flex flex-wrap gap-1">
          {mine?.decision === "approved" ? (
            <Button size="sm" variant="ghost" onClick={() => decide("revoke")}>
              Revoke my approval
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                disabled={state.outdated}
                title={
                  state.outdated
                    ? "Wait for the author to update the suggestion against the current revision."
                    : undefined
                }
                onClick={() => decide("approve")}
              >
                <Check className="size-3.5" /> Approve v{suggestion.version}
              </Button>
              {mine?.decision !== "changes_requested" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => decide("changes_requested")}
                >
                  Request changes
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {history.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3 transition-transform",
                historyOpen && "rotate-180",
              )}
            />
            {history.length} earlier decision{history.length > 1 ? "s" : ""}
          </button>
          {historyOpen && (
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {history.map((d) => (
                <li key={d.id}>
                  {memberName(d.reviewerId)}{" "}
                  {d.decision === "approved"
                    ? "approved"
                    : "requested changes on"}{" "}
                  v{d.version} ·{" "}
                  <span className="text-warning">
                    {d.supersededReason?.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// The author's editor. Saving re-bases onto the current revision; a changed
// text becomes the next version and reviewers are asked to look again.
function SuggestionEditor({
  suggestion,
  onDone,
}: {
  suggestion: EntityOf<"suggestion">;
  onDone: () => void;
}) {
  const { current, revisions, mutate, item } = useItem();
  const [content, setContent] = useState(suggestion.replacement);
  const [rationale, setRationale] = useState(suggestion.rationale ?? "");
  const [title, setTitle] = useState(
    suggestion.title ?? suggestion.rationale ?? "",
  );
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const target = revisions.find((r) => r.id === suggestion.revisionId);
  const outdated = current && suggestion.revisionId !== current.id;
  const changed = content !== suggestion.replacement;
  const submit = async () => {
    if (!current) return;
    if (!title.trim()) return setError("Give this proposal a title.");
    if (!rationale.trim())
      return setError("Describe why this change is needed.");
    if (content === current.content)
      return setError(
        "The proposal is identical to the current specification.",
      );
    setPending(true);
    setError(undefined);
    try {
      await mutate({
        type: "updateSuggestion",
        workItemId: item.id,
        baseRevisionId: current.id,
        suggestionId: suggestion.id,
        replacement: content,
        title: title.trim(),
        rationale: rationale.trim(),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-3">
      {outdated && target && current && (
        <details className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[13px]">
          <summary className="cursor-pointer">
            What changed in the specification since revision {target.number}{" "}
            (now revision {current.number}) — fold these changes into your
            proposal.
          </summary>
          <div className="mt-2">
            <RevisionDiff before={target.content} after={current.content} />
          </div>
        </details>
      )}
      <SuggestionDetailsFields
        title={title}
        description={rationale}
        onTitleChange={setTitle}
        onDescriptionChange={setRationale}
      />
      <MarkdownEditor
        fileContext={{
          organizationId: item.organizationId,
          workItemId: item.id,
        }}
        value={content}
        onValueChange={setContent}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") onDone();
        }}
        spellCheck
        aria-label="Proposed specification"
        className="min-h-80 px-4 pt-4 font-mono"
        previewClassName="min-h-[320px] px-4 pt-4"
        style={{ fieldSizing: "content" }}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="md" onClick={onDone}>
          Cancel
        </Button>
        <Button size="md" onClick={() => void submit()} disabled={pending}>
          {changed
            ? `Save as v${suggestion.version + 1}`
            : outdated
              ? `Update against revision ${current?.number}`
              : "Save"}
          <Kbd>⌘↵</Kbd>
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {changed
          ? "A new version asks reviewers to approve again; their earlier decisions are kept as history."
          : "Re-basing onto the current revision keeps existing approvals when the proposed text is unchanged."}
      </p>
      {!changed && <Badge>No text change yet</Badge>}
    </div>
  );
}
