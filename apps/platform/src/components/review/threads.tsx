import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CircleAlert,
  CircleCheck,
  CornerDownRight,
  MessageSquare,
  Quote,
  RotateCcw,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { relativeTime } from "@lictory/core/lib/work-items";
import type { EntityOf } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { MarkdownEditor } from "@lictory/platform/components/ui/markdown-editor";
import { Avatar, Badge, SectionLabel } from "@lictory/ui/primitives";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useRecordDecisionFrom } from "@lictory/platform/components/review/decisions";

function useMentionable() {
  const { directory } = useWorkspace();
  return directory.members;
}

type Draft = { quote?: string; section: string } | null;

export function Discussions({
  draft,
  onDraftChange,
}: {
  draft: Draft;
  onDraftChange: (draft: Draft) => void;
}) {
  const { threads, readOnly, reviewable } = useItem();
  const [showResolved, setShowResolved] = useState(false);
  const open = threads.filter((t) => t.status === "open");
  const resolved = threads.filter((t) => t.status === "resolved");
  const blocking = open.filter((t) => t.blocking).length;
  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (draft)
      composerRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
  }, [draft]);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Discussions</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {open.length} open{blocking ? ` · ${blocking} blocking` : ""}
        </span>
        {resolved.length > 0 && (
          <button
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
            {reviewable
              ? "No open discussions. Select text in the specification to comment on it, or start a general discussion below."
              : "No comments yet. Start a discussion below."}
          </p>
        )}
        {open.map((t) => (
          <Thread key={t.id} thread={t} />
        ))}
        {showResolved && resolved.map((t) => <Thread key={t.id} thread={t} />)}
      </div>
      {!readOnly && (
        <div ref={composerRef} className="mt-4">
          <ThreadComposer draft={draft} onDraftChange={onDraftChange} />
        </div>
      )}
    </div>
  );
}

export function Thread({ thread }: { thread: EntityOf<"thread"> }) {
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
  const isOpen = thread.status === "open";
  const revision = revisionNumber(thread.revisionId);
  const discussedCommit = entities.find(
    (e) => e.type === "specCommit" && e.id === thread.commitId,
  );
  const quoteStillPresent = thread.anchor?.quote
    ? (
        (discussedCommit?.type === "specCommit"
          ? discussedCommit.content
          : current?.content
        )?.replace(/\s+/g, " ") ?? ""
      ).includes(thread.anchor.quote.replace(/\s+/g, " "))
    : true;
  // Specification discussions (not pull request or suggestion threads) can
  // become a recorded decision once resolved.
  const recordDecision = useRecordDecisionFrom();
  const decisionSource =
    recordDecision && !thread.pullRequestId && !thread.suggestionId
      ? recordDecision
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
  return (
    <article
      data-thread-id={thread.id}
      tabIndex={-1}
      className={cn(
        "scroll-mt-24 rounded-lg border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        isOpen && thread.blocking && "border-destructive/40",
        !isOpen && "opacity-75",
      )}
      aria-label={`${thread.blocking ? "Blocking " : ""}discussion`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        {isOpen ? (
          thread.blocking ? (
            <Badge tone="danger">
              <CircleAlert className="size-3" /> Blocking
            </Badge>
          ) : (
            <Badge>
              <MessageSquare className="size-3" /> Open
            </Badge>
          )
        ) : (
          <Badge tone="good">
            <CircleCheck className="size-3" /> Resolved
          </Badge>
        )}
        {recorded && (
          <Badge>
            <BookOpen className="size-3" /> Decision recorded
          </Badge>
        )}
        {thread.anchor?.section && (
          <span className="truncate">on “{thread.anchor.section}”</span>
        )}
        <span className="ml-auto tabular-nums">
          {thread.commitId
            ? `commit ${thread.commitId.slice(0, 8)}`
            : `revision ${revision ?? "?"}`}
        </span>
      </header>
      {thread.anchor?.quote && (
        <blockquote
          className={cn(
            "mx-3 mt-2 flex gap-2 rounded bg-muted/60 px-2 py-1.5 text-[13px] text-muted-foreground",
            !quoteStillPresent && "italic",
          )}
        >
          <Quote className="mt-1 size-3 shrink-0" />
          <span className="line-clamp-3">{thread.anchor.quote}</span>
        </blockquote>
      )}
      {thread.anchor?.quote && !quoteStillPresent && (
        <p className="mx-3 mt-1 text-[11px] text-warning">
          The quoted text changed in a later revision.
        </p>
      )}
      <ol className="divide-y">
        {own.map((m) => (
          <li key={m.id} className="px-3 py-2 text-[13px]">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Avatar
                userId={m.authorId}
                name={memberName(m.authorId)}
                size="xs"
              />
              <span className="font-medium text-foreground">
                {memberName(m.authorId)}
              </span>
              <time title={new Date(m.createdAt).toLocaleString()}>
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
      {!readOnly && (
        <footer className="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
          {replying ? (
            <form
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
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                    e.currentTarget.form?.requestSubmit();
                  if (e.key === "Escape") setReplying(false);
                }}
                rows={2}
                aria-label="Reply"
                placeholder="Reply… (⌘↵ to send)"
                containerClassName="min-w-0 flex-1"
                className="min-h-28"
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReplying(true)}
              >
                Reply
              </Button>
              {isOpen ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setState({ resolved: true })}
                  >
                    <CircleCheck className="size-3.5" /> Resolve
                  </Button>
                  {decisionSource && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Resolve this discussion and keep its conclusion as a decision"
                      onClick={() =>
                        decisionSource(thread.id, conclusion, {
                          resolve: true,
                        })
                      }
                    >
                      <BookOpen className="size-3.5" /> Resolve as decision
                    </Button>
                  )}
                  {reviewable && (
                    <Button
                      size="sm"
                      variant="ghost"
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
                  onClick={() => setState({ resolved: false })}
                >
                  <RotateCcw className="size-3.5" /> Reopen
                </Button>
              )}
              {!isOpen && decisionSource && !recorded && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => decisionSource(thread.id, conclusion)}
                >
                  <BookOpen className="size-3.5" /> Record decision
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
}: {
  draft: Draft;
  onDraftChange: (d: Draft) => void;
  // Discuss a suggestion's proposed text rather than the specification.
  suggestionId?: string;
  pullRequestId?: string;
  commitId?: string;
}) {
  const { mutate, base, current, item, reviewable } = useItem();
  const mentionable = useMentionable();
  const [body, setBody] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [error, setError] = useState<string>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (draft) textareaRef.current?.focus();
  }, [draft]);
  const submit = async () => {
    if (!body.trim() || !current) return;
    setError(undefined);
    try {
      await mutate({
        type: "createThread",
        ...base,
        threadId: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
        body: body.trim(),
        blocking,
        section: draft?.section ?? "",
        quote: draft?.quote,
        ...(suggestionId ? { suggestionId } : {}),
        ...(pullRequestId ? { pullRequestId, commitId } : {}),
      });
      setBody("");
      setBlocking(false);
      onDraftChange(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post.");
    }
  };
  return (
    <form
      className={cn(
        "rounded-md border bg-card",
        draft && "border-primary/40 ring-2 ring-primary/10",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {draft?.quote && (
        <div className="flex items-start gap-2 border-b bg-muted/50 px-3 py-1.5 text-[13px] text-muted-foreground">
          <Quote className="mt-1 size-3 shrink-0" />
          <span className="line-clamp-2 flex-1">{draft.quote}</span>
          <button
            type="button"
            className="text-xs hover:text-foreground"
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
        ref={textareaRef}
        mentions={mentionable}
        value={body}
        onValueChange={setBody}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
        }}
        rows={2}
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
