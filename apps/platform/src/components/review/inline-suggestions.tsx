import { useEffect, useId, useRef, useState } from "react";
import { Check, FilePenLine, PenLine, X } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { byType, relativeTime } from "@lictory/core/lib/work-items";
import {
  canReviewSuggestions,
  type EntityOf,
} from "@lictory/core/contracts/protocol";
import { suggestion as suggestionMachine } from "@lictory/core/contracts/state-machines";
import {
  parseMarkdownTree,
  replaceQuote,
  textModel,
  type Mark,
} from "@lictory/core/editor/markdown-text";
import { changedWords } from "@lictory/core/editor/word-diff";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { SectionLabel } from "@lictory/ui/primitives";
import { toast } from "@lictory/ui/toast";
import { Actor } from "@lictory/platform/components/identity/actor";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSuggestionState } from "@lictory/platform/components/review/suggestions";
import { SpecDiff } from "@lictory/platform/components/review/spec-diff";
import {
  useSpecDiscussions,
  type SuggestionDraft,
} from "@lictory/platform/components/review/spec-discussions";

// Suggested changes beside the specification (AGENTS.md "Suggestion"): a
// proposed text change someone allowed to accept it accepts or rejects;
// accepting creates the next revision. A small change on selected text is
// written right here; a larger one goes to the editor. Suggestions made
// elsewhere (an agent through the API) appear the same way.

// Resolves with `read()`'s first value within ten seconds, else undefined.
async function waitFor<T>(read: () => T | undefined): Promise<T | undefined> {
  for (let waited = 0; waited < 10_000; waited += 100) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return read();
}

const short = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

// Suggestions people can act on: open ones, and my own drafts.
export function useOpenSuggestions() {
  const { suggestions, userId } = useItem();
  return suggestions
    .filter(
      (s) =>
        s.status === "open" || (s.status === "draft" && s.authorId === userId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Where each suggestion written on the current revision changes its text:
// the span of the words it removes or replaces, marked in the reader.
export function suggestionRanges(
  content: string,
  revisionId: string | undefined,
  suggestions: readonly EntityOf<"suggestion">[],
): Mark<string>[] {
  const mine = suggestions.filter((s) => s.revisionId === revisionId);
  if (!mine.length) return [];
  const text = textModel(parseMarkdownTree(content)).text;
  return mine.flatMap((s) => {
    const next = textModel(parseMarkdownTree(s.replacement)).text;
    const { before } = changedWords(text, next);
    if (!before.length) return [];
    const from = before[0]!.from;
    const to = before.at(-1)!.to;
    // A change spread over the document marks where it starts.
    return [
      {
        from,
        to: to - from > 400 ? before[0]!.to : to,
        data: s.id,
      },
    ];
  });
}

// Who can accept a suggestion in this project: a discipline that both edits
// specifications and reviews (the server checks the same rule).
function useAcceptors(authorId: string) {
  const { directory } = useWorkspace();
  const { item } = useItem();
  return directory.members.filter(
    (m) =>
      canReviewSuggestions(directory.disciplines, m.id, item.projectId) &&
      (m.id !== authorId || directory.members.length === 1),
  );
}

// The composer for a change to a selected passage: the passage, what it
// should say, and who is asked to accept it.
export function SuggestionComposer({
  draft,
  onClose,
  onOpenEditor,
}: {
  draft: NonNullable<SuggestionDraft>;
  onClose: () => void;
  // Larger changes are written in the editor instead.
  onOpenEditor?: (quote: string) => void;
}) {
  const { current, item, userId, mutateConfirmed, base, entities } = useItem();
  const latestEntities = useRef(entities);
  useEffect(() => {
    latestEntities.current = entities;
  }, [entities]);
  const discussions = useSpecDiscussions();
  const acceptors = useAcceptors(userId);
  // A ready specification is protected: the same change is then reviewed
  // by its reviewers before it applies (a proposed change on its own line
  // of work), instead of being accepted by one person.
  const reviewed = item.mainProtected;
  const preferred =
    [item.assigneeId, item.createdById, current?.authorId].find(
      (id) => id && acceptors.some((m) => m.id === id),
    ) ??
    acceptors[0]?.id ??
    "";
  const [text, setText] = useState(draft.quote);
  const [why, setWhy] = useState("");
  const [acceptor, setAcceptor] = useState(preferred);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const ids = { text: useId(), why: useId(), who: useId() };
  // The reviewed path, with the commands the branch screens use: a line of
  // work from the current revision holding exactly this change, sent for
  // review at once. Merging it later creates the next revision.
  const proposeReviewedChange = async (replacement: string, title: string) => {
    if (!current) return;
    const branches = byType(entities, "specBranch");
    let name = "change";
    for (let n = 2; branches.some((b) => b.name === name); n++)
      name = `change-${n}`;
    const branchId = crypto.randomUUID();
    const reason = why.trim() || title;
    await mutateConfirmed({ type: "createBranch", ...base, branchId, name });
    // Main's line is recorded on the server with the first branch; the new
    // branch (at main's head) and main arrive with the next sync.
    const synced = await waitFor(() => {
      const now = byType(latestEntities.current, "specBranch");
      const branch = now.find((b) => b.id === branchId);
      const main = now.find((b) => b.name === "main");
      return branch && main ? { branch, main } : undefined;
    });
    if (!synced)
      throw new Error(
        "The change was started but has not arrived yet. Open Proposed changes to send it for review.",
      );
    await mutateConfirmed({
      type: "commitBranch",
      workItemId: item.id,
      branchId,
      baseCommitId: synced.branch.headId,
      title: current.title,
      content: replacement,
      message: short(reason, 500),
    });
    await mutateConfirmed({
      type: "createPullRequest",
      workItemId: item.id,
      pullRequestId: crypto.randomUUID(),
      sourceId: branchId,
      targetId: synced.main.id,
      title,
      description: short(reason, 10_000),
      draft: false,
    });
    toast({
      title: "Change sent for review",
      description: `Becomes revision ${current.number + 1} once approved.`,
      type: "success",
    });
  };
  const submit = async () => {
    if (!current || pending) return;
    const replacement = replaceQuote(current.content, draft, text.trim());
    if (replacement === null) {
      setError(
        "This passage has formatting or spans several blocks. Use Larger change.",
      );
      return;
    }
    if (replacement === current.content) {
      setError("The text is unchanged.");
      return;
    }
    const suggestionId = crypto.randomUUID();
    const title = short(`Change “${draft.quote}”`, 120);
    setPending(true);
    setError(undefined);
    if (reviewed) {
      try {
        await proposeReviewedChange(replacement, title);
        onClose();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "The change was not sent for review.",
        );
      } finally {
        setPending(false);
      }
      return;
    }
    try {
      await mutateConfirmed({
        type: "createSuggestion",
        ...base,
        suggestionId,
        replacement,
        title,
        rationale: why.trim() || title,
        open: true,
      });
      if (acceptor)
        await mutateConfirmed({
          type: "setSuggestionReviewer",
          workItemId: item.id,
          suggestionId,
          userId: acceptor,
          assigned: true,
        });
      discussions?.setActiveSuggestion(suggestionId);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The suggestion was not saved.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      aria-label="Suggest a change"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-2.5 rounded-xl border bg-card p-3 text-[13px] shadow-(--shadow-border)"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <PenLine aria-hidden className="size-3.5" /> Suggest a change
      </p>
      <blockquote className="border-l-2 border-destructive/50 pl-2.5 text-muted-foreground line-through decoration-destructive/60">
        {short(draft.quote, 280)}
      </blockquote>
      <div className="space-y-1">
        <label htmlFor={ids.text} className="text-xs font-medium">
          Replace with
        </label>
        <textarea
          id={ids.text}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          rows={Math.min(6, Math.max(2, Math.ceil(text.length / 40)))}
          className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 outline-none focus:border-primary/60 focus:ring-3 focus:ring-primary/10"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={ids.why} className="text-xs font-medium">
          Why{" "}
          <span className="font-normal text-muted-foreground">optional</span>
        </label>
        <input
          id={ids.why}
          value={why}
          maxLength={2000}
          onChange={(event) => setWhy(event.target.value)}
          className="h-8 w-full rounded-lg border border-input bg-background px-2.5 outline-none focus:border-primary/60 focus:ring-3 focus:ring-primary/10"
        />
      </div>
      {!reviewed && (
        <div className="space-y-1">
          <span id={ids.who} className="text-xs font-medium">
            Who accepts it
          </span>
          {acceptors.length ? (
            <DropdownSelect
              aria-labelledby={ids.who}
              value={acceptor}
              onValueChange={setAcceptor}
              size="sm"
              className="w-full"
            >
              {acceptors.map((m) => (
                <DropdownSelectOption key={m.id} value={m.id} label={m.name}>
                  {m.name}
                </DropdownSelectOption>
              ))}
            </DropdownSelect>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nobody else in this project can accept suggestions yet.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="submit" size="sm" disabled={pending}>
          {reviewed ? "Send for review" : "Suggest"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {onOpenEditor && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              onClose();
              onOpenEditor(draft.quote);
            }}
          >
            <FilePenLine aria-hidden className="size-3.5" /> Larger change
          </Button>
        )}
      </div>
    </form>
  );
}

// One suggested change: who suggested it, the words it changes, and the
// decision for whoever is asked to accept it.
export function SuggestionCard({
  suggestion,
  active = false,
}: {
  suggestion: EntityOf<"suggestion">;
  active?: boolean;
}) {
  const {
    current,
    revisions,
    userId,
    memberName,
    mutateConfirmed,
    item,
    readOnly,
    canEdit,
    revisionNumber,
  } = useItem();
  const discussions = useSpecDiscussions();
  const state = useSuggestionState(suggestion);
  const acceptors = useAcceptors(suggestion.authorId);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const target = revisions.find((r) => r.id === suggestion.revisionId);
  const isAuthor = suggestion.authorId === userId;
  // Nobody asked yet: someone who could accept it takes it by accepting.
  const canTake =
    !isAuthor &&
    state.reviewers.length === 0 &&
    suggestionMachine.allows(suggestion.status, "setReviewer") &&
    acceptors.some((m) => m.id === userId);
  const isAcceptor =
    state.reviewers.some((r) => r.userId === userId) || canTake;
  const iApproved = state.approvals.some((a) => a.reviewerId === userId);
  const run = async (action: () => Promise<unknown>) => {
    setPending(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change was refused.");
    } finally {
      setPending(false);
    }
  };
  const accept = () =>
    run(async () => {
      if (!current) return;
      if (canTake)
        await mutateConfirmed({
          type: "setSuggestionReviewer",
          workItemId: item.id,
          suggestionId: suggestion.id,
          userId,
          assigned: true,
        });
      if (!iApproved)
        await mutateConfirmed({
          type: "decideSuggestion",
          workItemId: item.id,
          suggestionId: suggestion.id,
          version: suggestion.version,
          decision: "approve",
        });
      await mutateConfirmed({
        type: "mergeSuggestion",
        workItemId: item.id,
        baseRevisionId: current.id,
        suggestionId: suggestion.id,
      });
      toast({
        title: `Suggestion accepted as revision ${current.number + 1}`,
        type: "success",
      });
    });
  const close = () =>
    run(() =>
      mutateConfirmed({
        type: "setSuggestionState",
        workItemId: item.id,
        suggestionId: suggestion.id,
        status: "closed",
      }),
    );
  const ask = (id: string) =>
    run(() =>
      mutateConfirmed({
        type: "setSuggestionReviewer",
        workItemId: item.id,
        suggestionId: suggestion.id,
        userId: id,
        assigned: true,
      }),
    );
  const canClose =
    !readOnly &&
    (isAuthor || canEdit) &&
    suggestionMachine.allows(suggestion.status, "close");
  const blocked = item.mainProtected
    ? "The specification is ready. Suggest it again to send it for review."
    : state.outdated
      ? `Outdated: written on revision ${revisionNumber(suggestion.revisionId) ?? "?"}.`
      : state.blocking.length
        ? `${state.blocking.length} blocking discussion${state.blocking.length > 1 ? "s" : ""} to resolve first.`
        : suggestion.status === "draft"
          ? "Private draft"
          : null;
  const waitingOn = state.reviewers
    .filter((r) => r.userId !== userId)
    .map((r) => memberName(r.userId));
  return (
    <article
      data-suggestion-id={suggestion.id}
      tabIndex={-1}
      aria-label={`Suggested change by ${memberName(suggestion.authorId)}`}
      onMouseEnter={() => discussions?.setActiveSuggestion(suggestion.id)}
      className={cn(
        "space-y-2 rounded-xl border bg-card p-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active && "border-primary/40 ring-1 ring-primary/20",
      )}
    >
      <header className="flex min-w-0 items-center gap-1.5 text-xs">
        <Actor userId={suggestion.authorId} label="none" size={16} />
        <span className="truncate font-medium">
          {memberName(suggestion.authorId)}
        </span>
        <span className="shrink-0 text-muted-foreground">
          suggests · {relativeTime(suggestion.createdAt)}
        </span>
      </header>
      {suggestion.rationale && suggestion.rationale !== suggestion.title && (
        <p className="text-[13px] whitespace-pre-wrap">
          {suggestion.rationale}
        </p>
      )}
      {target && (
        <SpecDiff
          compact
          before={target.content}
          after={suggestion.replacement}
          beforeLabel={`revision ${target.number}`}
          afterLabel="suggested"
        />
      )}
      {blocked ? (
        <p className="text-xs text-muted-foreground">{blocked}</p>
      ) : isAcceptor && !readOnly ? null : waitingOn.length ? (
        <p className="text-xs text-muted-foreground">
          Waiting for {waitingOn.join(" or ")} to accept it.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nobody is asked to accept it yet.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {isAcceptor && !readOnly && !blocked && (
          <Button size="sm" disabled={pending} onClick={() => void accept()}>
            <Check aria-hidden className="size-3.5" /> Accept
          </Button>
        )}
        {canClose && (
          <Button
            size="sm"
            variant={isAcceptor ? "secondary" : "ghost"}
            disabled={pending}
            onClick={() => void close()}
          >
            <X aria-hidden className="size-3.5" />{" "}
            {isAuthor ? "Withdraw" : "Reject"}
          </Button>
        )}
        {isAuthor &&
          !readOnly &&
          state.reviewers.length === 0 &&
          acceptors.length > 0 &&
          suggestionMachine.allows(suggestion.status, "setReviewer") && (
            <DropdownSelect
              aria-label="Ask someone to accept it"
              value=""
              placeholder="Ask someone to accept it"
              onValueChange={(id) => id && void ask(id)}
              size="sm"
            >
              {acceptors.map((m) => (
                <DropdownSelectOption key={m.id} value={m.id} label={m.name}>
                  {m.name}
                </DropdownSelectOption>
              ))}
            </DropdownSelect>
          )}
      </div>
    </article>
  );
}

// The suggested changes in the discussions panel, in the order made.
export function SuggestionList() {
  const discussions = useSpecDiscussions();
  const open = useOpenSuggestions();
  if (!open.length) return null;
  return (
    <section aria-label="Suggested changes" className="flex flex-col gap-2">
      <SectionLabel>
        {open.length === 1
          ? "1 suggested change"
          : `${open.length} suggested changes`}
      </SectionLabel>
      {open.map((s) => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          active={discussions?.activeSuggestion === s.id}
        />
      ))}
    </section>
  );
}

// The review rail names suggestions that wait for a decision and opens
// them beside the text.
export function SuggestionsWaiting() {
  const { suggestionReviewers, userId } = useItem();
  const discussions = useSpecDiscussions();
  const open = useOpenSuggestions().filter((s) => s.status === "open");
  if (!open.length || !discussions) return null;
  const mine = open.filter((s) =>
    suggestionReviewers.some(
      (r) => r.suggestionId === s.id && r.userId === userId && !r.withdrawnAt,
    ),
  ).length;
  return (
    <button
      type="button"
      onClick={() => {
        discussions.setPanelOpen(true);
        const first = open[0]!.id;
        discussions.setActiveSuggestion(first);
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLElement>(
              `[data-suggestion-id="${CSS.escape(first)}"]`,
            )
            ?.focus(),
        );
      }}
      className="mb-3 flex w-full items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-left text-[13px] outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <PenLine aria-hidden className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        {open.length === 1
          ? "1 suggested change"
          : `${open.length} suggested changes`}
        {mine > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · {mine === open.length ? "for you to accept" : `${mine} for you`}
          </span>
        )}
      </span>
    </button>
  );
}
