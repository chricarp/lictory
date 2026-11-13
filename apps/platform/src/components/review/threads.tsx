import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  MoreHorizontal,
  RotateCcw,
  X,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import type { EntityOf } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Popover } from "@lictory/ui/popover";
import { toast } from "@lictory/ui/toast";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@lictory/platform/components/editor/markdown-editor";
import { Avatar, Badge, SectionLabel } from "@lictory/ui/primitives";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useRecordDecisionFrom } from "@lictory/platform/components/review/decisions";
import {
  announce,
  QuoteBlock,
  useStoredDraft,
} from "@lictory/platform/components/discussions/presentation";
import { Menu, MenuItem } from "@lictory/platform/components/spaces/menu";
import type {
  Draft,
  Placement,
} from "@lictory/platform/components/review/spec-discussions";

function useMentionable() {
  const { directory } = useWorkspace();
  return directory.members;
}

// The send shortcut as this platform writes it.
export const sendKeys =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘↵"
    : "Ctrl+↵";

// Long conversations show their opening message and the latest replies;
// the ones between fold into one line until asked for.
const FOLD_FROM = 5;
const KEEP_LATEST = 2;

// Comments on plain work (tasks, bugs): a conversation under the
// description, newest discussion last, the composer after it. Specifications
// discuss in the panel beside the text (review/discussion-panel.tsx).
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
      <div className="mb-3 flex items-center gap-2">
        <SectionLabel>Discussions</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {open.length} open
        </span>
        {resolved.length > 0 && (
          <ResolvedToggle
            count={resolved.length}
            shown={showResolved}
            onToggle={() => setShowResolved((v) => !v)}
            className="ml-auto"
          />
        )}
      </div>
      <div className="space-y-3">
        {open.length === 0 && !showResolved && (
          <p className="text-[13px] text-muted-foreground">
            {readOnly ? "No open discussions." : "No open discussions yet."}
          </p>
        )}
        {open.map((t) => (
          <Thread key={t.id} thread={t} />
        ))}
        {showResolved && resolved.map((t) => <Thread key={t.id} thread={t} />)}
        {!readOnly && (
          <ThreadComposer draft={draft} onDraftChange={onDraftChange} />
        )}
      </div>
    </div>
  );
}

// "Show 2 resolved" / "Hide 2 resolved".
export function ResolvedToggle({
  count,
  shown,
  onToggle,
  className,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={shown}
      data-resolved-toggle
      onClick={onToggle}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 touch:h-11",
        className,
      )}
    >
      {shown ? (
        <ChevronDown className="size-3.5" aria-hidden />
      ) : (
        <ChevronRight className="size-3.5" aria-hidden />
      )}
      {shown ? "Hide" : "Show"} {count} resolved
    </button>
  );
}

const iconAction =
  "grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground touch:size-11";
const textAction =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 touch:h-11 touch:px-3";

// One discussion as a card: what it is about (state, section, the quoted
// passage), its messages, and a reply field. Resolving is the one action
// on the card's face; the rest (blocking, decisions) wait in its menu.
// Actions are offered by my capabilities; the server re-checks them.
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
    mutateConfirmed,
    item,
    current,
    entities,
    revisionNumber,
    readOnly,
    reviewable,
  } = useItem();
  const own = messages.filter((m) => m.threadId === thread.id);
  const isOpen = thread.status === "open";
  const [expanded, setExpanded] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
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
  const author = memberName(thread.authorId);
  // State changes show at once and are announced once the server accepts
  // them; a refusal puts the discussion back and says why.
  const setState = async (
    patch: { resolved?: boolean; blocking?: boolean },
    done: string,
  ) => {
    try {
      await mutateConfirmed({
        type: "setThreadState",
        workItemId: item.id,
        threadId: thread.id,
        resolved: patch.resolved ?? !isOpen,
        blocking: patch.blocking ?? thread.blocking,
      });
      announce(done);
    } catch (failure) {
      const reason = failure instanceof Error ? ` ${failure.message}` : "";
      toast.add({
        title: `The discussion by ${author} was not changed`,
        type: "error",
        description: reason.trim() || "Try again.",
        timeout: 8000,
      });
      announce(`The discussion was not changed.${reason}`);
    }
  };
  // Resolving folds the card away: focus moves on to the next discussion
  // (or the previous one, or the resolved list) instead of being lost.
  const resolve = () => {
    const card = ref.current;
    const list = card?.parentElement;
    const cards = list
      ? [...list.querySelectorAll<HTMLElement>(":scope > [data-thread-id]")]
      : [];
    const at = card ? cards.indexOf(card) : -1;
    const hadFocus = Boolean(card?.contains(document.activeElement));
    const next = cards.slice(at + 1).find((c) => c !== card) ?? cards[at - 1];
    // The last open discussion: "Show resolved" (in the panel's list or in
    // a task's section header), which appears once the resolution renders.
    const section = card?.closest("section");
    void setState(
      { resolved: true },
      "Discussion resolved. Show resolved discussions to reopen it.",
    );
    if (!hadFocus) return;
    if (next?.isConnected && next !== card) {
      requestAnimationFrame(() => next.focus());
      return;
    }
    let tries = 0;
    const focusToggle = () => {
      const toggle = section?.querySelector<HTMLElement>(
        "[data-resolved-toggle]",
      );
      if (toggle) toggle.focus();
      else if (tries++ < 10) window.setTimeout(focusToggle, 50);
    };
    requestAnimationFrame(focusToggle);
  };
  const linked = where === "here" && isOpen && onHover;
  // Plain work has no revisions worth naming; a specification's
  // discussions say which revision (or branch commit) they were written on.
  const versioned = reviewable || Boolean(thread.commitId);
  const writtenOn = thread.commitId
    ? `commit ${thread.commitId.slice(0, 8)}`
    : `revision ${revision ?? "?"}`;
  const writtenOnLabel = thread.commitId
    ? `Written on commit ${thread.commitId.slice(0, 8)}`
    : `Written on revision ${revision ?? "?"}`;
  const revisionLink = !versioned ? null : !thread.commitId &&
    revision !== undefined &&
    onShowRevision ? (
    <button
      type="button"
      title={`${writtenOnLabel}: show it`}
      onClick={() => onShowRevision(thread.revisionId, thread.id)}
      className="shrink-0 rounded tabular-nums underline decoration-current/30 underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 touch:-my-3 touch:py-3"
    >
      {writtenOn}
    </button>
  ) : (
    <span title={writtenOnLabel} className="shrink-0 tabular-nums">
      {writtenOn}
    </span>
  );
  const menuItems: ReactNode[] = [];
  if (!readOnly && isOpen && decisionSource)
    menuItems.push(
      <MenuItem
        key="decision"
        icon={<BookOpen />}
        onSelect={() =>
          decisionSource(thread.id, conclusion, { resolve: true })
        }
      >
        Resolve as decision
      </MenuItem>,
    );
  if (!readOnly && !isOpen && decisionSource && !recorded)
    menuItems.push(
      <MenuItem
        key="record"
        icon={<BookOpen />}
        onSelect={() => decisionSource(thread.id, conclusion)}
      >
        Record decision
      </MenuItem>,
    );
  if (!readOnly && isOpen && reviewable)
    menuItems.push(
      <MenuItem
        key="blocking"
        icon={thread.blocking ? <CircleDashed /> : <CircleAlert />}
        onSelect={() =>
          void setState(
            { blocking: !thread.blocking },
            thread.blocking
              ? "Discussion no longer blocks."
              : "Discussion now blocks.",
          )
        }
      >
        {thread.blocking ? "Mark non-blocking" : "Mark blocking"}
      </MenuItem>,
    );
  const blockingTitle =
    thread.pullRequestId || thread.suggestionId
      ? "Must be resolved before this change can merge."
      : "Must be resolved before the specification is ready.";
  const foldable = own.length >= FOLD_FROM;
  const folded = foldable && !unfolded;
  const shown = folded ? [own[0]!, ...own.slice(-KEEP_LATEST)] : own;
  const middle = own.length - 1 - KEEP_LATEST;
  const section = thread.anchor?.section;
  // What the discussion is about (state, section) heads the card with its
  // actions; a plain comment puts them beside its opening message.
  const context = !isOpen || thread.blocking || recorded || Boolean(section);
  const statusBadges = (
    <>
      {!isOpen ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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
        <span title={blockingTitle} className="shrink-0">
          <Badge tone="danger">
            <CircleAlert className="size-3" aria-hidden /> Blocking
          </Badge>
        </span>
      ) : null}
      {recorded && (
        <span className="shrink-0">
          <Badge>
            <BookOpen className="size-3" aria-hidden /> Decision
          </Badge>
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {section ? (
          <>
            <span className="sr-only">On </span>
            <span title={section}>{section}</span>
          </>
        ) : null}
      </span>
    </>
  );
  const actions = (
    <span className="ml-auto flex shrink-0 items-center gap-0.5">
      {!readOnly &&
        (isOpen ? (
          <button
            type="button"
            className={textAction}
            title="Resolve: the question is answered (reopen any time)"
            onClick={resolve}
          >
            <CircleCheck className="size-3.5" aria-hidden /> Resolve
          </button>
        ) : (
          <button
            type="button"
            className={textAction}
            onClick={() =>
              void setState({ resolved: false }, "Discussion reopened.")
            }
          >
            <RotateCcw className="size-3.5" aria-hidden /> Reopen
          </button>
        ))}
      {menuItems.length > 0 && (
        <Popover
          align="end"
          width={220}
          trigger={(props) => (
            <button
              {...props}
              type="button"
              aria-label="Discussion actions"
              title="Discussion actions"
              className={iconAction}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          )}
        >
          {(close) => (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Choosing an item (by click or Enter) closes the menu; the items handle the keys.
            <div onClick={close}>
              <Menu label={`Actions for the discussion by ${author}`}>
                {menuItems}
              </Menu>
            </div>
          )}
        </Popover>
      )}
    </span>
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
        "group/thread @container/thread scroll-mt-24 rounded-xl bg-card text-[13px] ring-1 ring-foreground/10 transition-[box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        isOpen && thread.blocking && "ring-destructive/30",
        hovered && !active && "ring-foreground/25",
        active && "ring-2 ring-ring/55",
      )}
    >
      {context && (
        <header className="flex min-h-10 items-center gap-1.5 py-1.5 pr-1.5 pl-3 text-xs text-muted-foreground">
          {statusBadges}
          {actions}
        </header>
      )}
      {(where === "changed" || where === "removed") && (
        <p className="px-3 pb-1.5 text-xs font-medium text-warning">
          {where === "removed"
            ? "Original text removed"
            : "The quoted text changed"}
          {revision !== undefined &&
            !thread.commitId &&
            revision !== current?.number && <> since revision {revision}</>}
        </p>
      )}
      {quote && (
        <div className="px-3">
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
        <ol
          className={cn(
            "space-y-3 px-3 pb-3",
            quote ? "pt-3" : context ? "pt-0.5" : "pt-2",
          )}
        >
          {shown.map((m, index) => [
            <li key={m.id}>
              <Message
                authorId={m.authorId}
                name={memberName(m.authorId)}
                createdAt={m.createdAt}
                body={m.body}
                meta={index === 0 ? revisionLink : undefined}
                actions={index === 0 && !context ? actions : undefined}
              />
            </li>,
            // One toggle in its own place after the opening message: it
            // stays the same element (and keeps focus) as the middle of the
            // conversation folds and unfolds beneath it.
            index === 0 && foldable && (
              <li key="fold">
                <button
                  type="button"
                  aria-expanded={!folded}
                  onClick={() => setUnfolded((v) => !v)}
                  className="flex min-h-6 w-full items-center gap-2 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 touch:min-h-11"
                >
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  {folded ? "Show" : "Hide"} {middle} earlier{" "}
                  {middle === 1 ? "reply" : "replies"}
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </button>
              </li>
            ),
          ])}
        </ol>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full min-w-0 items-baseline gap-1.5 px-3 pb-2.5 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="shrink-0 font-medium text-foreground/80">
            {author}:
          </span>
          <span className="min-w-0 truncate">
            {plainText(own[0]?.body ?? "")}
          </span>
          <span className="ml-auto shrink-0 tabular-nums">
            {own.length === 1 ? "1 message" : `${own.length} messages`}
          </span>
        </button>
      )}
      {!readOnly && showMessages && (
        <ReplyField
          thread={thread}
          // A conversation between several people is answered as a whole.
          to={new Set(own.map((m) => m.authorId)).size > 1 ? "" : author}
        />
      )}
    </article>
  );
}

// Markdown as one line of plain text, for previews.
function plainText(markdown: string) {
  return markdown
    .replace(/@\[([^\]]+)\]\(mention:[^)]+\)/g, "@$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function Message({
  authorId,
  name,
  createdAt,
  body,
  meta,
  actions,
}: {
  authorId: string;
  name: string;
  createdAt: string;
  body: string;
  // After the time: the revision the discussion was written on.
  meta?: ReactNode;
  // The discussion's actions, when it has no header to hold them.
  actions?: ReactNode;
}) {
  const when = (
    <>
      <time
        dateTime={createdAt}
        title={absoluteTime(createdAt)}
        className="shrink-0"
      >
        {relativeTime(createdAt)}
      </time>
      {meta && (
        <>
          <span aria-hidden>·</span>
          {meta}
        </>
      )}
    </>
  );
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-2">
      <Avatar userId={authorId} name={name} size="sm" />
      {/* Who wrote it comes first; when the discussion's actions share the
        line, time and revision move to a line of their own. Nothing is
        clipped: metadata wraps. */}
      <div
        className={cn(
          "flex min-w-0 items-center gap-x-1.5 text-xs leading-5 text-muted-foreground",
          actions ? "-my-1 -mr-1.5" : "flex-wrap",
        )}
      >
        <span className="min-w-0 truncate font-medium text-foreground">
          {name}
        </span>
        {!actions && when}
        {actions && (
          // On a wide card the time stays beside the name.
          <span className="hidden items-center gap-x-1.5 @min-[26rem]/thread:flex">
            {when}
          </span>
        )}
        {actions}
      </div>
      {actions && (
        <div className="col-start-2 flex flex-wrap items-center gap-x-1.5 text-xs leading-5 text-muted-foreground @min-[26rem]/thread:hidden">
          {when}
        </div>
      )}
      <Markdown
        source={body}
        className="col-start-2 text-[13px] leading-[1.4rem] break-words [&>ol]:my-2 [&>p]:my-2 [&>ul]:my-2"
      />
    </div>
  );
}

// The reply field under a discussion: one line at rest, a full-width
// editor while writing. What is written is a draft until it is sent: it
// survives closing the field, the panel or the sheet (and a reload in this
// tab). Sending waits for the server; a refused reply comes back with the
// reason, its text intact.
function ReplyField({
  thread,
  to,
}: {
  thread: EntityOf<"thread">;
  to: string;
}) {
  const { mutate, item, memberName } = useItem();
  const { userId } = useWorkspace();
  const mentionable = useMentionable();
  const [reply, setReply] = useStoredDraft(`${item.id}:reply:${thread.id}`);
  const [replying, setReplying] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const form = useRef<HTMLFormElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => {
    setReplying(false);
    setError(undefined);
    requestAnimationFrame(() => opener.current?.focus());
  };
  // Sending applies at once (and queues while offline). Text the server
  // later refuses is kept by the workspace's recovery (the sync status
  // offers it back, also after a reload), so the draft is done here.
  const send = async () => {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await mutate({
        type: "replyToThread",
        workItemId: item.id,
        threadId: thread.id,
        messageId: crypto.randomUUID(),
        body: text,
      });
      setReply("");
      close();
      announce("Reply posted.");
    } catch (failure) {
      setError(
        `Your reply was not sent${failure instanceof Error ? `: ${failure.message}` : "."} Your text is kept; send it again when ready.`,
      );
    } finally {
      setSending(false);
    }
  };
  // The open reply stays in view, also when a phone's keyboard takes the
  // lower half of the screen.
  useEffect(() => {
    if (!replying) return;
    const keep = () => form.current?.scrollIntoView({ block: "nearest" });
    keep();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", keep);
    window.addEventListener("resize", keep);
    return () => {
      viewport?.removeEventListener("resize", keep);
      window.removeEventListener("resize", keep);
    };
  }, [replying]);
  // Discarding a draft can be undone for a few seconds.
  const [discarded, setDiscarded] = useState<string>();
  useEffect(() => {
    if (discarded === undefined) return;
    const timer = window.setTimeout(() => setDiscarded(undefined), 8000);
    return () => window.clearTimeout(timer);
  }, [discarded]);
  if (!replying)
    return (
      <div className="flex items-center gap-1 border-t px-3 py-2">
        <button
          ref={opener}
          type="button"
          aria-label="Reply"
          disabled={sending}
          onClick={() => {
            setDiscarded(undefined);
            setReplying(true);
          }}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted/50 px-2 text-left text-[13px] text-muted-foreground ring-1 ring-foreground/5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 enabled:hover:bg-muted enabled:hover:text-foreground disabled:cursor-progress touch:h-11"
        >
          <Avatar userId={userId} name={memberName(userId)} size="xs" />
          <span className="min-w-0 flex-1 truncate">
            {sending
              ? "Sending…"
              : discarded !== undefined
                ? "Draft discarded"
                : reply.trim()
                  ? plainText(reply)
                  : "Reply…"}
          </span>
          {!sending && reply.trim() && (
            <span className="shrink-0 text-[11px] font-medium text-foreground/70">
              Draft
            </span>
          )}
        </button>
        {!sending && reply.trim() && (
          <button
            type="button"
            aria-label="Discard draft reply"
            title="Discard draft reply"
            onClick={() => {
              setDiscarded(reply);
              setReply("");
              announce("Draft discarded. Undo is available for a few seconds.");
            }}
            className={iconAction}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
        {discarded !== undefined && !reply.trim() && (
          <button
            type="button"
            onClick={() => {
              setReply(discarded);
              setDiscarded(undefined);
            }}
            className={textAction}
          >
            <RotateCcw className="size-3.5" aria-hidden /> Undo
          </button>
        )}
      </div>
    );
  return (
    <form
      ref={form}
      className="space-y-2 border-t px-3 pt-2.5 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <MarkdownEditor
        fileContext={{
          organizationId: item.organizationId,
          workItemId: item.id,
        }}
        autoFocus
        mentions={mentionable}
        value={reply}
        onValueChange={setReply}
        onSubmit={() => form.current?.requestSubmit()}
        onEscape={close}
        compact
        aria-label="Reply"
        placeholder={to ? `Reply to ${to}…` : "Reply to the discussion…"}
        containerClassName="w-full"
        minHeight="4.5rem"
        maxHeight="22rem"
      />
      {error && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 text-[11px] leading-4 text-muted-foreground touch:hidden">
          {sendKeys} to send · Close keeps a draft
        </span>
        {/* Closing keeps what was written (a draft); discarding is
          explicit, on the field at rest. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto shrink-0 touch:h-11"
          title="Close (Esc); keeps your draft"
          onClick={close}
        >
          Close
        </Button>
        <Button
          type="submit"
          size="sm"
          className="shrink-0 touch:h-11"
          title={`Reply (${sendKeys})`}
          disabled={!reply.trim() || sending}
        >
          Reply
        </Button>
      </div>
    </form>
  );
}

// Starts a discussion: a one-line field at rest that opens into an editor
// (with the quoted passage, when there is one) while writing.
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
  const draftKey = `${item.id}:new:${suggestionId ?? pullRequestId ?? "item"}`;
  const [body, setBody] = useStoredDraft(draftKey);
  const [blockingDraft, setBlockingDraft] = useStoredDraft(
    `${draftKey}:blocking`,
  );
  const blocking = blockingDraft === "yes";
  const setBlocking = (on: boolean) => setBlockingDraft(on ? "yes" : "");
  // The passage a draft comments on is kept with its text, so a draft
  // restored after a reload still belongs to that passage.
  const [anchorDraft, setAnchorDraft] = useStoredDraft(`${draftKey}:anchor`);
  const anchor = draft ? JSON.stringify(draft) : "";
  useEffect(() => {
    if (anchor) setAnchorDraft(anchor);
  }, [anchor, setAnchorDraft]);
  // Decided once, from what was stored when the composer opened: a stored
  // passage comes back only with the text written about it. A passage
  // selected and left without text is forgotten, so it never attaches
  // itself to a later, unrelated comment.
  const restoredAnchor = useRef(false);
  useEffect(() => {
    if (restoredAnchor.current) return;
    restoredAnchor.current = true;
    if (draft || !anchorDraft) return;
    if (!body.trim()) {
      setAnchorDraft("");
      return;
    }
    try {
      onDraftChange(JSON.parse(anchorDraft) as Draft);
    } catch {
      setAnchorDraft("");
    }
  }, [anchorDraft, body, draft, onDraftChange, setAnchorDraft]);
  const [error, setError] = useState<string>();
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // A comment on a selection opens in full view (below the panel's sticky
  // header), then takes focus.
  useEffect(() => {
    if (!draft) return;
    formRef.current?.scrollIntoView({ block: "nearest" });
    editorRef.current?.focus();
  }, [draft]);
  const active = focused || Boolean(draft) || body.trim() !== "";
  const change = Boolean(suggestionId ?? pullRequestId);
  const submit = async () => {
    const text = body.trim();
    if (!text || !current || sending) return;
    setError(undefined);
    setSending(true);
    const threadId = crypto.randomUUID();
    // Posting applies at once (and queues while offline); text the server
    // later refuses is kept by the workspace's recovery.
    try {
      await mutate({
        type: "createThread",
        ...base,
        threadId,
        messageId: crypto.randomUUID(),
        body: text,
        blocking,
        section: draft?.section ?? "",
        quote: draft?.quote,
        ...(draft?.quote && draft.occurrence
          ? { occurrence: draft.occurrence }
          : {}),
        ...(suggestionId ? { suggestionId } : {}),
        ...(pullRequestId ? { pullRequestId, commitId } : {}),
      });
      announce(blocking ? "Blocking discussion posted." : "Discussion posted.");
      setBody("");
      setBlocking(false);
      setAnchorDraft("");
      onDraftChange(null);
      onCreated?.(threadId);
    } catch (e) {
      setError(
        `Not posted${e instanceof Error ? `: ${e.message}` : "."} Your text is kept; post it again when ready.`,
      );
    } finally {
      setSending(false);
    }
  };
  // Cancel discards what was written; Escape only steps away and keeps it.
  // Discarding can be undone for a few seconds: text, passage and the
  // blocking choice come back together.
  const [discarded, setDiscarded] = useState<{
    body: string;
    blocking: boolean;
    draft: Draft;
  }>();
  useEffect(() => {
    if (!discarded) return;
    const timer = window.setTimeout(() => setDiscarded(undefined), 8000);
    return () => window.clearTimeout(timer);
  }, [discarded]);
  const discard = () => {
    if (body.trim()) {
      setDiscarded({ body, blocking, draft });
      announce("Draft discarded. Undo is available for a few seconds.");
    }
    setBody("");
    setBlocking(false);
    setAnchorDraft("");
    setError(undefined);
    onDraftChange(null);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const undoDiscard = () => {
    if (!discarded) return;
    setBody(discarded.body);
    setBlocking(discarded.blocking);
    if (discarded.draft) onDraftChange(discarded.draft);
    setDiscarded(undefined);
    requestAnimationFrame(() => editorRef.current?.focus());
  };
  const stepAway = () => {
    if (!body.trim()) {
      onDraftChange(null);
      setAnchorDraft("");
    }
    (document.activeElement as HTMLElement | null)?.blur();
  };
  return (
    <form
      ref={formRef}
      aria-busy={sending || undefined}
      className={cn(
        "scroll-mt-16 scroll-mb-4 rounded-xl bg-card ring-1 ring-foreground/10 transition-shadow",
        active && "ring-2 ring-primary/25",
      )}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
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
            className="shrink-0 rounded px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            onClick={() => {
              onDraftChange(null);
              setAnchorDraft("");
            }}
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
        disabled={sending}
        onSubmit={() => void submit()}
        onEscape={draft?.quote || body.trim() ? stepAway : undefined}
        compact
        toolbar={active}
        minHeight={active ? "4.5rem" : "1.5rem"}
        maxHeight="20rem"
        aria-label={
          draft?.quote ? "Comment on selection" : "Start a discussion"
        }
        placeholder={
          draft?.quote
            ? "What is unclear or wrong about this text?"
            : reviewable
              ? "Start a discussion…"
              : "Add a comment…"
        }
        containerClassName="rounded-none border-0 bg-transparent ring-0 focus-within:border-transparent focus-within:ring-0"
      />
      {active && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-2 py-1.5">
          {(reviewable || change) && (
            <label
              title={
                change
                  ? "The change cannot merge until this discussion is resolved."
                  : "The specification cannot become ready until this discussion is resolved."
              }
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2 text-xs ring-1 transition-colors select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60 touch:h-11 touch:px-3",
                blocking
                  ? "bg-destructive/8 text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))] ring-destructive/25"
                  : "text-muted-foreground ring-foreground/10 hover:text-foreground",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={blocking}
                onChange={(e) => setBlocking(e.target.checked)}
              />
              <CircleAlert className="size-3.5" aria-hidden />
              {change ? "Blocks merging" : "Blocks readiness"}
            </label>
          )}
          {reviewable && current && !change && (
            <span
              className="text-[11px] text-muted-foreground tabular-nums"
              title={`Written on revision ${current.number}`}
            >
              revision {current.number}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {(Boolean(draft) || body.trim() !== "") && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="touch:h-11"
                onClick={discard}
              >
                {body.trim() ? "Discard" : "Cancel"}
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              className="touch:h-11"
              title={`Post (${sendKeys})`}
              variant={blocking ? "danger" : "primary"}
              disabled={!body.trim() || sending}
            >
              {blocking ? "Post blocking discussion" : "Post"}
            </Button>
          </span>
          {error && (
            <p role="alert" className="w-full px-1 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
      {discarded && !body.trim() && (
        <div className="flex items-center gap-2 border-t px-3 py-1 text-xs text-muted-foreground">
          Draft discarded
          <button
            type="button"
            // Focusing would open the composer and move this row away
            // before the click lands; Undo focuses the editor itself.
            onMouseDown={(event) => event.preventDefault()}
            onClick={undoDiscard}
            className={cn(textAction, "ml-auto")}
          >
            <RotateCcw className="size-3.5" aria-hidden /> Undo
          </button>
        </div>
      )}
    </form>
  );
}
