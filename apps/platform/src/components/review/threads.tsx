import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CornerDownRight,
  RotateCcw,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import type { EntityOf } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@lictory/platform/components/editor/markdown-editor";
import { Avatar, Badge, SectionLabel } from "@lictory/ui/primitives";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useRecordDecisionFrom } from "@lictory/platform/components/review/decisions";
import { QuoteBlock } from "@lictory/platform/components/discussions/presentation";
import type {
  Draft,
  Placement,
} from "@lictory/platform/components/review/spec-discussions";

function useMentionable() {
  const { directory } = useWorkspace();
  return directory.members;
}

// Comments on plain work (tasks, bugs): a conversation under the
// description. Specifications discuss in the panel beside the text
// (review/discussion-panel.tsx).
export function Discussions({
  draft,
  onDraftChange,
}: {
  draft: Draft;
  onDraftChange: (draft: Draft) => void;
}) {
  const { threads, readOnly } = useItem();
  const [showResolved, setShowResolved] = useState(false);
  const open = threads.filter((t) => t.status === "open");
  const resolved = threads.filter((t) => t.status === "resolved");
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Discussions</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {open.length} open
        </span>
        {resolved.length > 0 && (
          <button
            type="button"
            aria-expanded={showResolved}
            onClick={() => setShowResolved((v) => !v)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved
          </button>
        )}
      </div>
      <div className="space-y-3">
        {open.length === 0 && !draft && (
          <p className="text-[13px] text-muted-foreground">
            No comments yet. Start a discussion below.
          </p>
        )}
        {open.map((t) => (
          <Thread key={t.id} thread={t} />
        ))}
        {showResolved && resolved.map((t) => <Thread key={t.id} thread={t} />)}
      </div>
      {!readOnly && (
        <div className="mt-4">
          <ThreadComposer draft={draft} onDraftChange={onDraftChange} />
        </div>
      )}
    </div>
  );
}

// One discussion as a card: its state, the passage it is about and its
// messages, then the actions my capabilities allow (the server re-checks).
// Beside a specification the panel says where the passage is (`placement`)
// and links the card with its highlight (`active`, `hovered`); elsewhere
// (pull requests, suggestions) the card checks its quote itself.
export function Thread({
  thread,
  placement,
  active = false,
  hovered = false,
  onHover,
  onShowInText,
  onShowRevision,
  onBeforeDecision,
}: {
  thread: EntityOf<"thread">;
  placement?: Placement;
  active?: boolean;
  hovered?: boolean;
  onHover?: (threadId: string | null) => void;
  onShowInText?: (threadId: string) => void;
  onShowRevision?: (revisionId: string, threadId: string) => void;
  // Recording a decision opens its composer in the document.
  onBeforeDecision?: () => void;
}) {
  const {
    messages,
    memberName,
    mutate,
    item,
    current,
    entities,
    revisionNumber,
    readOnly,
    reviewable,
  } = useItem();
  const mentionable = useMentionable();
  const own = messages.filter((m) => m.threadId === thread.id);
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const replyForm = useRef<HTMLFormElement>(null);
  const isOpen = thread.status === "open";
  const [expanded, setExpanded] = useState(false);
  const showMessages = isOpen || expanded;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const revision = revisionNumber(thread.revisionId);
  const discussedCommit = entities.find(
    (e) => e.type === "specCommit" && e.id === thread.commitId,
  );
  const quote = thread.anchor?.quote;
  const where: Placement =
    placement ??
    (!quote
      ? "general"
      : (
            (discussedCommit?.type === "specCommit"
              ? discussedCommit.content
              : current?.content
            )?.replace(/\s+/g, " ") ?? ""
          ).includes(quote.replace(/\s+/g, " "))
        ? "here"
        : "changed");
  // Specification discussions (not pull request or suggestion threads) can
  // become a recorded decision once resolved.
  const recordDecision = useRecordDecisionFrom();
  const decisionSource =
    recordDecision && !thread.pullRequestId && !thread.suggestionId
      ? (...args: Parameters<typeof recordDecision>) => {
          onBeforeDecision?.();
          recordDecision(...args);
        }
      : undefined;
  const recorded = entities.some(
    (e) =>
      e.type === "decision" && e.sourceThreadId === thread.id && !e.archivedAt,
  );
  const conclusion = own.at(-1)?.body ?? "";
  const setState = (patch: { resolved?: boolean; blocking?: boolean }) =>
    void mutate({
      type: "setThreadState",
      workItemId: item.id,
      threadId: thread.id,
      resolved: patch.resolved ?? !isOpen,
      blocking: patch.blocking ?? thread.blocking,
    });
  const author = memberName(thread.authorId);
  const linked = where === "here" && isOpen && onHover;
  const writtenOn = thread.commitId
    ? `commit ${thread.commitId.slice(0, 8)}`
    : `revision ${revision ?? "?"}`;
  const revisionLink =
    !thread.commitId && revision !== undefined && onShowRevision ? (
      <button
        type="button"
        onClick={() => onShowRevision(thread.revisionId, thread.id)}
        className="rounded underline decoration-current/40 underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {writtenOn}
      </button>
    ) : (
      writtenOn
    );
  return (
    <article
      ref={ref}
      data-thread-id={thread.id}
      tabIndex={-1}
      aria-label={`${isOpen && thread.blocking ? "Blocking discussion" : "Discussion"} by ${author}`}
      onMouseEnter={linked ? () => onHover(thread.id) : undefined}
      onMouseLeave={linked ? () => onHover(null) : undefined}
      className={cn(
        "scroll-mt-24 rounded-xl bg-card text-[13px] ring-1 ring-foreground/10 transition-[box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        isOpen && thread.blocking && "ring-destructive/25",
        hovered && !active && "ring-foreground/25",
        active && "ring-2 ring-ring/55",
      )}
    >
      <header className="flex flex-wrap items-center gap-2 px-3 pt-2.5 text-xs text-muted-foreground">
        {!isOpen ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Badge tone="good">
              <CircleCheck className="size-3" aria-hidden /> Resolved
            </Badge>
            {expanded ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
            <span className="sr-only">
              {expanded ? "Collapse" : "Expand"} resolved discussion
            </span>
          </button>
        ) : thread.blocking ? (
          <span
            title={
              thread.pullRequestId || thread.suggestionId
                ? "Must be resolved before this change can merge."
                : "Must be resolved before the specification is ready."
            }
          >
            <Badge tone="danger">
              <CircleAlert className="size-3" aria-hidden /> Blocking
            </Badge>
          </span>
        ) : null}
        {recorded && (
          <Badge>
            <BookOpen className="size-3" aria-hidden /> Decision recorded
          </Badge>
        )}
        {thread.anchor?.section && (
          <span className="min-w-0 truncate">on “{thread.anchor.section}”</span>
        )}
        <span className="ml-auto tabular-nums">{revisionLink}</span>
      </header>
      {(where === "changed" || where === "removed") && (
        <p className="px-3 pt-1.5 text-xs font-medium text-warning">
          {where === "removed"
            ? "Original text removed"
            : "The quoted text changed"}
          {revision !== undefined &&
            !thread.commitId &&
            revision !== current?.number && <> since revision {revision}</>}
        </p>
      )}
      {quote && (
        <div className="px-3 pt-2">
          <QuoteBlock
            quote={quote}
            muted={where !== "here"}
            blocking={isOpen && thread.blocking}
            title="Show in the specification"
            onClick={
              where === "here" && onShowInText
                ? () => onShowInText(thread.id)
                : undefined
            }
          />
        </div>
      )}
      {showMessages ? (
        <ol className="mt-1">
          {own.map((m) => (
            <li key={m.id} className="px-3 py-2">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Avatar
                  userId={m.authorId}
                  name={memberName(m.authorId)}
                  size="xs"
                />
                <span className="font-medium text-foreground">
                  {memberName(m.authorId)}
                </span>
                <time dateTime={m.createdAt} title={absoluteTime(m.createdAt)}>
                  {relativeTime(m.createdAt)}
                </time>
              </div>
              <Markdown
                source={m.body}
                className="text-[13px] leading-6 [&>p]:my-0"
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {own.length === 1 ? "1 message" : `${own.length} messages`} · {author}
        </p>
      )}
      {!readOnly && (
        <footer className="flex flex-wrap items-center gap-0.5 border-t px-1.5 py-1.5">
          {replying ? (
            <form
              ref={replyForm}
              className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-start"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!reply.trim()) return;
                await mutate({
                  type: "replyToThread",
                  workItemId: item.id,
                  threadId: thread.id,
                  messageId: crypto.randomUUID(),
                  body: reply.trim(),
                });
                setReply("");
                setReplying(false);
              }}
            >
              <CornerDownRight className="mt-2 hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
              <MarkdownEditor
                fileContext={{
                  organizationId: item.organizationId,
                  workItemId: item.id,
                }}
                autoFocus
                mentions={mentionable}
                value={reply}
                onValueChange={setReply}
                onSubmit={() => replyForm.current?.requestSubmit()}
                onEscape={() => setReplying(false)}
                compact
                aria-label="Reply"
                placeholder="Reply… (⌘↵ to send)"
                containerClassName="min-w-0 flex-1"
                minHeight="4.5rem"
                maxHeight="20rem"
              />
              <Button
                type="submit"
                size="sm"
                className="self-end"
                disabled={!reply.trim()}
              >
                Reply
              </Button>
            </form>
          ) : (
            <>
              {showMessages && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2.5"
                  onClick={() => setReplying(true)}
                >
                  Reply
                </Button>
              )}
              {isOpen ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2.5"
                    onClick={() => setState({ resolved: true })}
                  >
                    <CircleCheck className="size-3.5" aria-hidden /> Resolve
                  </Button>
                  {decisionSource && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="px-2.5"
                      title="Resolve this discussion and keep its conclusion as a decision"
                      onClick={() =>
                        decisionSource(thread.id, conclusion, {
                          resolve: true,
                        })
                      }
                    >
                      <BookOpen className="size-3.5" aria-hidden /> Resolve as
                      decision
                    </Button>
                  )}
                  {reviewable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="px-2.5"
                      onClick={() => setState({ blocking: !thread.blocking })}
                    >
                      {thread.blocking ? "Mark non-blocking" : "Mark blocking"}
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2.5"
                  onClick={() => setState({ resolved: false })}
                >
                  <RotateCcw className="size-3.5" aria-hidden /> Reopen
                </Button>
              )}
              {!isOpen && decisionSource && !recorded && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2.5"
                  onClick={() => decisionSource(thread.id, conclusion)}
                >
                  <BookOpen className="size-3.5" aria-hidden /> Record decision
                </Button>
              )}
            </>
          )}
        </footer>
      )}
    </article>
  );
}

export function ThreadComposer({
  draft,
  onDraftChange,
  suggestionId,
  pullRequestId,
  commitId,
  onCreated,
}: {
  draft: Draft;
  onDraftChange: (d: Draft) => void;
  // Discuss a suggestion's proposed text rather than the specification.
  suggestionId?: string;
  pullRequestId?: string;
  commitId?: string;
  onCreated?: (threadId: string) => void;
}) {
  const { mutate, base, current, item, reviewable } = useItem();
  const mentionable = useMentionable();
  const [body, setBody] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [error, setError] = useState<string>();
  const editorRef = useRef<MarkdownEditorHandle>(null);
  useEffect(() => {
    if (draft) editorRef.current?.focus();
  }, [draft]);
  const submit = async () => {
    if (!body.trim() || !current) return;
    setError(undefined);
    const threadId = crypto.randomUUID();
    try {
      await mutate({
        type: "createThread",
        ...base,
        threadId,
        messageId: crypto.randomUUID(),
        body: body.trim(),
        blocking,
        section: draft?.section ?? "",
        quote: draft?.quote,
        ...(draft?.quote && draft.occurrence
          ? { occurrence: draft.occurrence }
          : {}),
        ...(suggestionId ? { suggestionId } : {}),
        ...(pullRequestId ? { pullRequestId, commitId } : {}),
      });
      setBody("");
      setBlocking(false);
      onDraftChange(null);
      onCreated?.(threadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post.");
    }
  };
  return (
    <form
      className={cn(
        "rounded-xl bg-card ring-1 ring-foreground/10",
        draft && "ring-2 ring-primary/25",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {draft?.quote && (
        <div className="flex items-start gap-2 px-3 pt-2.5">
          <div className="min-w-0 flex-1">
            <QuoteBlock quote={draft.quote} />
          </div>
          <button
            type="button"
            className="shrink-0 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            onClick={() => onDraftChange(null)}
          >
            Remove quote
          </button>
        </div>
      )}
      <MarkdownEditor
        fileContext={{
          organizationId: item.organizationId,
          workItemId: item.id,
        }}
        ref={editorRef}
        mentions={mentionable}
        value={body}
        onValueChange={setBody}
        onSubmit={() => void submit()}
        onEscape={draft?.quote ? () => onDraftChange(null) : undefined}
        compact
        minHeight="4.5rem"
        maxHeight="20rem"
        aria-label={
          draft?.quote ? "Comment on selection" : "Start a discussion"
        }
        placeholder={
          draft?.quote
            ? "What is unclear or wrong about this text?"
            : "Ask a question, flag a gap, or raise a concern… Type @ to mention someone."
        }
        containerClassName="rounded-none border-0 bg-transparent ring-0 focus-within:border-transparent focus-within:ring-0"
      />
      <div className="flex flex-wrap items-center gap-2 border-t px-2 py-1.5">
        {(reviewable || Boolean(suggestionId ?? pullRequestId)) && (
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={blocking}
              onChange={(e) => setBlocking(e.target.checked)}
            />
            {suggestionId || pullRequestId
              ? "Blocks merging"
              : "Blocks readiness"}
          </label>
        )}
        <span className="text-[11px] text-muted-foreground">
          revision {current?.number}
        </span>
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
        <Button
          type="submit"
          size="sm"
          className="ml-auto"
          disabled={!body.trim()}
        >
          {blocking ? "Post blocking discussion" : "Post"}
        </Button>
      </div>
    </form>
  );
}
