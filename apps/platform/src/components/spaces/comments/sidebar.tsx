import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  GitBranch,
  MessageSquare,
  RotateCcw,
  X,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import type { PageThreadAnchor } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Avatar, Badge, SectionLabel } from "@lictory/ui/primitives";
import { Link } from "@lictory/platform/lib/navigation";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { MarkdownEditor } from "@lictory/platform/components/ui/markdown-editor";
import type { FileContext } from "@lictory/platform/components/items/file-upload";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import type {
  PageThread,
  PageThreadMessage,
} from "@lictory/platform/components/spaces/comments/store";
import type { OtherLine } from "@lictory/platform/components/spaces/comments/line-threads";
import { useSelectLine } from "@lictory/platform/components/spaces/editor/line";

// The page's discussions beside the document, in document order: threads
// whose text is on screen first, then those whose text changed or was
// removed (with their quote), then comments on the whole page. Resolved
// threads are folded away until asked for. Discussions of the page's other
// lines are not shown against this text; the panel names those lines and
// switches to them. Every action is a command the
// server authorizes; the panel only offers what my access allows.

export type ThreadPlacement =
  // Anchored text found in what is on screen.
  | "here"
  // Anchored text not found: changed since, or another draft epoch.
  | "changed"
  | "otherDraft"
  // Written on the live draft while this view shows a commit.
  | "draft"
  | "detached"
  | "page";

export type ThreadView = {
  thread: PageThread;
  messages: readonly PageThreadMessage[];
  placement: ThreadPlacement;
  quote: string | null;
};

export type PendingComment = { anchor: PageThreadAnchor; quote: string | null };

export type CommentActions = {
  create: (
    anchor: PageThreadAnchor,
    body: string,
    blocking: boolean,
  ) => Promise<void>;
  reply: (threadId: string, body: string) => Promise<void>;
  resolve: (threadId: string, resolved: boolean) => Promise<void>;
  setBlocking: (threadId: string, blocking: boolean) => Promise<void>;
};

const message = (e: unknown) =>
  e instanceof Error ? e.message : "This could not be saved. Try again.";

export function CommentsPanel({
  threads,
  canComment,
  pending,
  onCancelPending,
  activeId,
  hoveredId,
  onHover,
  onActivate,
  actions,
  fileContext,
  versionHref,
  onClose,
  hint,
  blockingEffect,
  lineName,
  otherLines,
}: {
  threads: readonly ThreadView[];
  canComment: boolean;
  pending: PendingComment | null;
  onCancelPending: () => void;
  activeId: string | null;
  // The thread under the pointer (here or in the text): its card and its
  // passage are marked together.
  hoveredId: string | null;
  onHover: (threadId: string | null) => void;
  onActivate: (threadId: string) => void;
  actions: CommentActions;
  fileContext: FileContext;
  // Where the version a detached thread was removed in can be read.
  versionHref: (commitId: string) => { href: string; label: string } | null;
  onClose?: () => void;
  hint: string;
  // What an open blocking discussion holds back on this page.
  blockingEffect: string;
  // The line whose discussions these are, and the page's other lines with
  // open discussions.
  lineName: string;
  otherLines: readonly OtherLine[];
}) {
  const [showResolved, setShowResolved] = useState(false);
  const open = threads.filter((t) => t.thread.status === "open");
  const resolved = threads.filter((t) => t.thread.status === "resolved");
  const blocking = open.filter((t) => t.thread.blocking).length;
  const inline = open.filter((t) => t.placement !== "page");
  const onPage = open.filter((t) => t.placement === "page");
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // After switching lines from this panel, focus lands on the heading of the
  // destination's panel: the button that was pressed is gone, and the panel
  // may be rebuilt more than once while the line's editor opens. Focus is
  // only taken while it is lost or still in the panel.
  useEffect(() => {
    const request = headingFocusRequest;
    const heading = headingRef.current;
    if (!request || !heading) return;
    if (request.line !== lineName || Date.now() > request.until) return;
    const current = document.activeElement;
    const panel = heading.closest("section");
    if (current && current !== document.body && !panel?.contains(current))
      return;
    heading.focus({ preventScroll: true });
  }, [lineName]);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {/* Stays in view while the threads scroll beneath it. */}
      <div className="sticky top-0 z-10 -mx-4 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 truncate text-sm font-semibold outline-none"
        >
          Comments{" "}
          <span className="font-normal text-muted-foreground">
            on {lineName}
          </span>
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {open.length} open
          {blocking ? (
            <>
              <span className="sr-only">, </span>
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-foreground">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-destructive/80"
                />
                {blocking} blocking
              </span>
            </>
          ) : null}
        </span>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1.5 ml-auto"
            aria-label="Close comments"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>
      {blocking > 0 && (
        <p className="-mt-1 text-xs leading-5 text-muted-foreground">
          {blockingEffect}
        </p>
      )}
      {pending && canComment && (
        <NewThread
          key={JSON.stringify(pending.anchor)}
          pending={pending}
          onCancel={onCancelPending}
          onSubmit={(body, isBlocking) =>
            actions.create(pending.anchor, body, isBlocking)
          }
          fileContext={fileContext}
        />
      )}
      {open.length === 0 && !pending && (
        <p className="text-[13px] text-muted-foreground">{hint}</p>
      )}
      {inline.map((view) => (
        <ThreadCard
          key={view.thread.id}
          view={view}
          active={view.thread.id === activeId}
          hovered={view.thread.id === hoveredId}
          onHover={onHover}
          onActivate={onActivate}
          canComment={canComment}
          actions={actions}
          fileContext={fileContext}
          versionHref={versionHref}
        />
      ))}
      {onPage.length > 0 && (
        <SectionLabel className="mt-2">On the whole page</SectionLabel>
      )}
      {onPage.map((view) => (
        <ThreadCard
          key={view.thread.id}
          view={view}
          active={view.thread.id === activeId}
          hovered={view.thread.id === hoveredId}
          onHover={onHover}
          onActivate={onActivate}
          canComment={canComment}
          actions={actions}
          fileContext={fileContext}
          versionHref={versionHref}
        />
      ))}
      {otherLines.length > 0 && <OtherLines lines={otherLines} />}
      {resolved.length > 0 && (
        <button
          type="button"
          aria-expanded={showResolved}
          onClick={() => setShowResolved((v) => !v)}
          className="inline-flex items-center gap-1 self-start rounded-full px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {showResolved ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
          {showResolved ? "Hide" : "Show"} {resolved.length} resolved
        </button>
      )}
      {showResolved &&
        resolved.map((view) => (
          <ThreadCard
            key={view.thread.id}
            view={view}
            active={view.thread.id === activeId}
            hovered={view.thread.id === hoveredId}
            onHover={onHover}
            onActivate={onActivate}
            canComment={canComment}
            actions={actions}
            fileContext={fileContext}
            versionHref={versionHref}
          />
        ))}
      {canComment && (
        <PageComment
          onSubmit={(body, isBlocking) =>
            actions.create({ v: 1, kind: "page" }, body, isBlocking)
          }
          fileContext={fileContext}
        />
      )}
    </section>
  );
}

// The line whose panel heading should take focus, briefly after a switch.
let headingFocusRequest: { line: string; until: number } | null = null;

// The page's other lines with open discussions, each a way to switch to it
// (the panel stays open there).
function OtherLines({ lines }: { lines: readonly OtherLine[] }) {
  const selectLine = useSelectLine();
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <SectionLabel>On other branches</SectionLabel>
      <ul className="flex flex-col gap-1">
        {lines.map(({ branch, open, blocking }) => (
          <li key={branch.id}>
            <button
              type="button"
              onClick={() => {
                headingFocusRequest = {
                  line: branch.name,
                  until: Date.now() + 10_000,
                };
                selectLine(branch.isMain ? null : branch.id);
              }}
              className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <GitBranch
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              {/* Named by what it shows: "Switch to {branch} 2 open 1
                  blocking". */}
              <span className="min-w-0 flex-1 truncate font-medium">
                <span className="sr-only">Switch to </span>
                {branch.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {open} open
                {blocking ? (
                  <span className="ml-2 inline-flex items-center gap-1 font-medium text-foreground">
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-destructive/80"
                    />
                    {blocking} blocking
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useMentionable() {
  return useWorkspace().directory.members;
}

// The commented passage, drawn with the tint its text has in the page (a
// quote whose text is no longer on screen stays neutral and italic).
function QuoteBlock({
  quote,
  muted,
  blocking,
  onClick,
}: {
  quote: string;
  muted?: boolean;
  blocking?: boolean;
  onClick?: () => void;
}) {
  const content = <span className="line-clamp-4 text-left">{quote}</span>;
  const className = cn(
    "block w-full rounded-r-md border-l-2 px-2.5 py-1 text-[13px] leading-5 text-foreground/80",
    muted
      ? "border-foreground/15 bg-muted/60 text-muted-foreground italic"
      : blocking
        ? "border-destructive/50 bg-destructive/6"
        : "border-warning/60 bg-warning/8",
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      title="Show in the page"
      className={cn(
        className,
        "outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
      )}
    >
      {content}
    </button>
  ) : (
    <blockquote className={className}>{content}</blockquote>
  );
}

function ThreadCard({
  view,
  active,
  hovered,
  onHover,
  onActivate,
  canComment,
  actions,
  fileContext,
  versionHref,
}: {
  view: ThreadView;
  active: boolean;
  hovered: boolean;
  onHover: (threadId: string | null) => void;
  onActivate: (threadId: string) => void;
  canComment: boolean;
  actions: CommentActions;
  fileContext: FileContext;
  versionHref: (commitId: string) => { href: string; label: string } | null;
}) {
  const { memberName } = useWorkspace();
  const mentionable = useMentionable();
  const { thread, messages, placement, quote } = view;
  const isOpen = thread.status === "open";
  const [expanded, setExpanded] = useState(isOpen);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const detachedVersion =
    thread.anchor.kind === "detached"
      ? versionHref(thread.anchor.commitId)
      : null;
  const author = memberName(thread.authorId);
  const linked = placement === "here" && isOpen;
  return (
    <article
      ref={ref}
      data-thread-id={thread.id}
      aria-label={`${thread.blocking && isOpen ? "Blocking comment" : "Comment"} by ${author}`}
      onMouseEnter={linked ? () => onHover(thread.id) : undefined}
      onMouseLeave={linked ? () => onHover(null) : undefined}
      className={cn(
        "rounded-xl bg-card text-[13px] ring-1 ring-foreground/10 transition-[box-shadow] duration-150 ease-out",
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
            <span className="sr-only">
              {expanded ? "Collapse" : "Expand"} resolved comment
            </span>
          </button>
        ) : thread.blocking ? (
          <span title="Must be resolved before this page's changes can merge.">
            <Badge tone="danger">
              <CircleAlert className="size-3" aria-hidden /> Blocking
            </Badge>
          </span>
        ) : null}
        {placement === "otherDraft" && <span>Written on an earlier draft</span>}
        {placement === "changed" && <span>The quoted text changed</span>}
        {placement === "draft" && <span>On the unpublished draft</span>}
        {!isOpen && thread.resolvedById && (
          <span>by {memberName(thread.resolvedById)}</span>
        )}
      </header>
      {placement === "detached" && (
        <p className="px-3 pt-1.5 text-xs font-medium text-warning">
          Original text removed
          {detachedVersion && (
            <>
              {" "}
              in{" "}
              <Link
                href={detachedVersion.href}
                className="underline underline-offset-2"
              >
                {detachedVersion.label}
              </Link>
            </>
          )}
        </p>
      )}
      {quote && (
        <div className="px-3 pt-2">
          <QuoteBlock
            quote={quote}
            muted={placement !== "here"}
            blocking={isOpen && thread.blocking}
            onClick={
              placement === "here" ? () => onActivate(thread.id) : undefined
            }
          />
        </div>
      )}
      {(isOpen || expanded) && (
        <ol className="mt-1">
          {messages.map((m) => (
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
      )}
      {error && (
        <p role="alert" className="px-3 pb-1 text-xs text-destructive">
          {error}
        </p>
      )}
      {/* Reopening is offered on folded resolved threads too. */}
      {canComment && (
        <footer className="flex flex-wrap items-center gap-0.5 border-t px-1.5 py-1.5">
          {replying ? (
            <form
              className="flex w-full flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const body = reply.trim();
                if (!body) return;
                void run(async () => {
                  await actions.reply(thread.id, body);
                  setReply("");
                  setReplying(false);
                });
              }}
            >
              <MarkdownEditor
                autoFocus
                fileContext={fileContext}
                mentions={mentionable}
                value={reply}
                onValueChange={setReply}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                    e.currentTarget.form?.requestSubmit();
                  if (e.key === "Escape") setReplying(false);
                }}
                rows={2}
                aria-label={`Reply to ${author}`}
                placeholder="Reply… (⌘↵ to send)"
              />
              <div className="flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setReplying(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!reply.trim() || busy}
                >
                  Reply
                </Button>
              </div>
            </form>
          ) : (
            <>
              {(isOpen || expanded) && (
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2.5"
                  disabled={busy}
                  onClick={() =>
                    void run(() => actions.resolve(thread.id, true))
                  }
                >
                  <CircleCheck className="size-3.5" aria-hidden /> Resolve
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2.5"
                  disabled={busy}
                  onClick={() =>
                    void run(() => actions.resolve(thread.id, false))
                  }
                >
                  <RotateCcw className="size-3.5" aria-hidden /> Reopen
                </Button>
              )}
              {isOpen && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2.5"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      actions.setBlocking(thread.id, !thread.blocking),
                    )
                  }
                >
                  {thread.blocking ? "Mark non-blocking" : "Mark blocking"}
                </Button>
              )}
            </>
          )}
        </footer>
      )}
    </article>
  );
}

function Composer({
  label,
  placeholder,
  onSubmit,
  onCancel,
  fileContext,
  autoFocus,
  children,
  submitLabel,
}: {
  label: string;
  placeholder: string;
  onSubmit: (body: string, blocking: boolean) => Promise<void>;
  onCancel?: () => void;
  fileContext: FileContext;
  autoFocus?: boolean;
  children?: ReactNode;
  submitLabel: string;
}) {
  const mentionable = useMentionable();
  const [body, setBody] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const blockingId = useId();
  return (
    <form
      className="rounded-xl bg-card ring-1 ring-foreground/8"
      onSubmit={(e) => {
        e.preventDefault();
        const text = body.trim();
        if (!text || busy) return;
        setBusy(true);
        setError(undefined);
        onSubmit(text, blocking)
          .then(() => {
            setBody("");
            setBlocking(false);
          })
          .catch((err: unknown) => setError(message(err)))
          .finally(() => setBusy(false));
      }}
    >
      {children}
      <MarkdownEditor
        autoFocus={autoFocus}
        fileContext={fileContext}
        mentions={mentionable}
        value={body}
        onValueChange={setBody}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
            e.currentTarget.form?.requestSubmit();
          if (e.key === "Escape" && onCancel) onCancel();
        }}
        rows={2}
        aria-label={label}
        placeholder={placeholder}
        containerClassName="border-0"
      />
      {error && (
        <p role="alert" className="px-3 pb-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5">
        <label
          htmlFor={blockingId}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <input
            id={blockingId}
            type="checkbox"
            checked={blocking}
            onChange={(e) => setBlocking(e.target.checked)}
          />
          Blocking
        </label>
        <div className="ml-auto flex gap-1">
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!body.trim() || busy}>
            {busy ? "Posting…" : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

function NewThread({
  pending,
  onSubmit,
  onCancel,
  fileContext,
}: {
  pending: PendingComment;
  onSubmit: (body: string, blocking: boolean) => Promise<void>;
  onCancel: () => void;
  fileContext: FileContext;
}) {
  return (
    <Composer
      autoFocus
      label={pending.quote ? "Comment on the selected text" : "New comment"}
      placeholder="Add a comment… (⌘↵ to post)"
      submitLabel="Comment"
      onSubmit={async (body, blocking) => {
        await onSubmit(body, blocking);
        onCancel();
      }}
      onCancel={onCancel}
      fileContext={fileContext}
    >
      {pending.quote && (
        <div className="px-3 pt-2.5">
          <QuoteBlock quote={pending.quote} />
        </div>
      )}
    </Composer>
  );
}

function PageComment({
  onSubmit,
  fileContext,
}: {
  onSubmit: (body: string, blocking: boolean) => Promise<void>;
  fileContext: FileContext;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        <MessageSquare className="size-3.5" aria-hidden /> Comment on the page
      </Button>
    );
  return (
    <Composer
      autoFocus
      label="Comment on the page"
      placeholder="Comment on the whole page… (⌘↵ to post)"
      submitLabel="Comment"
      onSubmit={async (body, blocking) => {
        await onSubmit(body, blocking);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
      fileContext={fileContext}
    />
  );
}
