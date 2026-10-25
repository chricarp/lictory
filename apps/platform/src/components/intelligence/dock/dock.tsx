import type { Chat } from "@ai-sdk/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowUpRight,
  ChevronDown,
  Loader2,
  LocateFixed,
  MessagesSquare,
  Quote,
  RotateCcw,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";
import {
  useParams,
  usePathname,
  useRouter,
} from "@lictory/platform/lib/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { Button } from "@lictory/ui/button";
import { Badge, Kbd } from "@lictory/ui/primitives";
import {
  counts,
  ScoreRing,
  severityMeta,
} from "@lictory/platform/components/review/ai-review";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import type {
  ChatContext,
  ChatMessage,
} from "@lictory/core/intelligence/chat/shared";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { relativeTime } from "@lictory/core/lib/work-items";
import { aiScoreBand } from "@lictory/core/contracts/ai";
import type { EntityOf } from "@lictory/core/contracts/protocol";
import { createChat } from "@lictory/platform/components/intelligence/chat/chat-instance";
import {
  Composer,
  type ComposerHandle,
} from "@lictory/platform/components/intelligence/chat/composer";
import {
  ThreadMessages,
  useThread,
  useThreadMood,
  type Thread,
} from "@lictory/platform/components/intelligence/chat/thread";
import {
  pageOf,
  pageSuggestions,
  type Suggestion,
} from "@lictory/platform/components/intelligence/dock/page";
import {
  useDock,
  useDockState,
  type DockItem,
  type DockReview,
  type DockSelection,
} from "@lictory/platform/components/intelligence/dock/store";

type Run = EntityOf<"aiRun">;
type SendExtra = {
  reviewRunId?: string;
  // Overrides the attached selection (the bar sends the live one).
  selection?: DockSelection | null;
};

// Strong ease-out: immediate response, soft landing.
const ease = [0.23, 1, 0.32, 1] as const;
const noSubscribe = () => () => undefined;
const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

// The item review a dock shows: the newest run, and the newest completed one
// (the score stays visible while a new run is queued).
function reviewState(review: DockReview) {
  const [latest] = review.runs;
  const completed = review.runs.find((r) => r.status === "completed");
  const active =
    !!latest && (latest.status === "queued" || latest.status === "running");
  const failed = latest?.status === "failed" ? latest : undefined;
  return { latest, completed, active, failed };
}

function itemSuggestions(item: DockItem): Suggestion[] {
  if (item.review?.viewing)
    return [
      {
        label: "Walk me through this review",
        prompt:
          "Walk me through this review: what should I fix first, and which findings need a human decision?",
      },
      {
        label: "Which findings can I ignore?",
        prompt:
          "Which findings of this review are low value or already covered, and why?",
      },
    ];
  if (item.review)
    return [
      {
        label: "What is still unclear?",
        prompt: `What is still ambiguous or missing in ${item.key}? List the questions engineering and QA would ask.`,
      },
      {
        label: "Draft acceptance criteria",
        prompt: `Propose acceptance criteria for ${item.key}, including failure behavior, as a suggestion I can review.`,
      },
      {
        label: "Summarize the discussion",
        prompt: `Summarize the discussions on ${item.key}: what is decided, what is blocking, and who needs to answer.`,
      },
    ];
  return [
    {
      label: "Where does this stand?",
      prompt: `Summarize ${item.key} and where it stands.`,
    },
    {
      label: "Break it down",
      prompt: `Propose subtasks for ${item.key}.`,
    },
  ];
}

const selectionSuggestions: Suggestion[] = [
  {
    label: "What does this mean?",
    prompt:
      "What does this mean, in the context of the rest of the specification?",
  },
  {
    label: "What is missing here?",
    prompt: "What is missing, ambiguous or untestable in this part?",
  },
  {
    label: "Suggest clearer wording",
    prompt:
      "Propose clearer wording for this part as a suggestion I can review.",
  },
];

// Litto on every workspace page: a small bar that follows what
// the person is doing (the page, the open item, the text they select) and
// opens into a conversation that knows that context. Conversations are saved
// unlisted and can continue on the Intelligence page.
export function IntelligenceDock() {
  const { directory, organization, projects } = useWorkspace();
  const store = useDock();
  const { item, selection, request } = useDockState();
  const pathname = usePathname();
  const params = useParams<{ project?: string }>();
  const router = useRouter();
  const reduce = useReducedMotion();
  const page = pageOf(pathname);
  const project = projects.find((p) => p.key === params.project?.toUpperCase());
  const available = directory.ai.available && directory.ai.enabled;
  const hidden = !store || !available || page.kind === "intelligence";
  const openItem = page.kind === "item" ? item : null;

  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<Chat<ChatMessage> | null>(null);
  // The selection travels with the next message, even after the page loses
  // it to the composer's focus.
  const [attached, setAttached] = useState<DockSelection | null>(null);
  const [assessing, setAssessing] = useState<{
    pending: boolean;
    error: string | null;
  } | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const shortcut = useSyncExternalStore(
    noSubscribe,
    () => (isMac() ? "⌘J" : "Ctrl J"),
    () => "Ctrl J",
  );

  // A new selection while the dock is open replaces the attached one; leaving
  // the item drops it.
  const [seenSelection, setSeenSelection] = useState(selection);
  if (seenSelection !== selection) {
    setSeenSelection(selection);
    if (open && selection) setAttached(selection);
  }
  const itemId = openItem?.id;
  const [seenItem, setSeenItem] = useState(itemId);
  if (seenItem !== itemId) {
    setSeenItem(itemId);
    setAssessing(null);
    if (attached && attached.itemId !== itemId) setAttached(null);
  }

  const context = useCallback(
    (extra: SendExtra = {}): ChatContext => {
      const quoted = extra.selection !== undefined ? extra.selection : attached;
      return {
        page: {
          label: openItem ? `${openItem.key} ${openItem.title}` : page.label,
          path: pathname,
        },
        project: project
          ? { id: project.id, key: project.key, name: project.name }
          : null,
        item: openItem
          ? { id: openItem.id, key: openItem.key, title: openItem.title }
          : null,
        selection:
          quoted && quoted.itemId === openItem?.id
            ? { quote: quoted.quote, section: quoted.section }
            : null,
        reviewRunId: extra.reviewRunId ?? openItem?.review?.viewing ?? null,
      };
    },
    [openItem, page.label, pathname, project, attached],
  );

  const ensureChat = useCallback(() => {
    if (chat) return chat;
    const next = createChat({
      id: crypto.randomUUID(),
      organizationId: organization.id,
      surface: "dock",
    });
    setChat(next);
    return next;
  }, [chat, organization.id]);

  const send = useCallback(
    (text: string, extra?: SendExtra) => {
      const target = ensureChat();
      void target.sendMessage({
        parts: [
          { type: "data-context", data: context(extra) },
          { type: "text", text },
        ],
      });
      setAttached(null);
      setOpen(true);
    },
    [context, ensureChat],
  );

  const assess = useCallback(async () => {
    const review = openItem?.review;
    if (!review || review.blocked) return;
    setOpen(true);
    setAssessing({ pending: true, error: null });
    try {
      await review.request();
      setAssessing({ pending: false, error: null });
    } catch (error) {
      setAssessing({
        pending: false,
        error:
          error instanceof Error
            ? error.message
            : "The assessment could not start.",
      });
    }
  }, [openItem]);

  // Requests from the page: the selection toolbar, the command palette.
  useEffect(() => {
    if (!request || !store) return;
    store.consume(request.id);
    if (hidden) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setOpen(true);
    const current = store.get().selection;
    if (current) setAttached(current);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (request.assess) void assess();
    if (request.prompt) {
      if (request.send) send(request.prompt);
      else requestAnimationFrame(() => composer.current?.fill(request.prompt!));
    } else requestAnimationFrame(() => composer.current?.focus());
  }, [request, store, hidden, assess, send]);

  // ⌘J / Ctrl+J opens and minimizes the dock from anywhere.
  useEffect(() => {
    if (hidden) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "j"
      ) {
        event.preventDefault();
        if (open) setOpen(false);
        else {
          const current = store?.get().selection;
          if (current) setAttached(current);
          setOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden, open, store]);

  const openDock = () => {
    if (selection) setAttached(selection);
    setOpen(true);
  };

  const newChat = () => {
    void chat?.stop();
    setChat(null);
    setAssessing(null);
    requestAnimationFrame(() => composer.current?.focus());
  };

  const continueOnPage = async (id: string) => {
    // The page also lists it on its next message if this fails.
    await fetch(
      `/api/intelligence/chats/${encodeURIComponent(id)}?organizationId=${encodeURIComponent(organization.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listed: true }),
      },
    ).catch(() => undefined);
    setOpen(false);
    setChat(null);
    router.push(paths.intelligenceChat(organization.slug, id));
  };

  if (hidden) return null;
  const liveSelection =
    selection && selection.itemId === openItem?.id ? selection : null;

  return (
    // Bar and panel share one grid cell anchored to the bottom center: the
    // panel grows out of the bar's place instead of morphing from it.
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 grid items-end justify-items-center px-3 pb-3 sm:pb-4">
      <Bar
        reduce={!!reduce}
        hidden={open}
        item={openItem}
        selection={liveSelection}
        chat={chat}
        shortcut={shortcut}
        onOpen={openDock}
        onAsk={(prompt) => send(prompt, { selection: liveSelection })}
        onAssess={() => void assess()}
        onShowReview={() => {
          setAssessing({ pending: false, error: null });
          setOpen(true);
        }}
      />
      <AnimatePresence initial={false}>
        {open && (
          <Panel
            key="panel"
            reduce={!!reduce}
            chat={chat}
            item={openItem}
            pageLabel={page.label}
            suggestions={
              attached
                ? selectionSuggestions
                : openItem
                  ? itemSuggestions(openItem)
                  : pageSuggestions(page.kind, project)
            }
            attached={attached}
            onDetach={() => setAttached(null)}
            assessing={assessing}
            onAssess={() => void assess()}
            onDismissAssessment={() => setAssessing(null)}
            composer={composer}
            onSend={send}
            onNewChat={newChat}
            onContinue={(id) => void continueOnPage(id)}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Width of an element's content, kept current, so a container can animate
// to it without scaling (and distorting) what is inside.
function useContentWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// Content swaps inside the bar: a quick blur-in, no movement.
const swap = {
  initial: { opacity: 0, filter: "blur(4px)" },
  animate: { opacity: 1, filter: "blur(0px)" },
  transition: { duration: 0.2, ease },
} as const;

// Collapsed: one line that changes with what the person is doing. It stays
// mounted while the panel is open, so closing never replays its entrance.
function Bar({
  reduce,
  hidden,
  item,
  selection,
  chat,
  shortcut,
  onOpen,
  onAsk,
  onAssess,
  onShowReview,
}: {
  reduce: boolean;
  hidden: boolean;
  item: DockItem | null;
  selection: DockSelection | null;
  chat: Chat<ChatMessage> | null;
  shortcut: string;
  onOpen: () => void;
  onAsk: (prompt: string) => void;
  onAssess: () => void;
  onShowReview: () => void;
}) {
  const label = selection
    ? "Ask about the selection"
    : chat
      ? "Continue the conversation"
      : item
        ? `Ask about ${item.key}`
        : "Ask Litto";
  // Buttons keep the page's text selection when pressed.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const [content, width] = useContentWidth();
  const motionProps = reduce ? { initial: false as const } : swap;
  return (
    <motion.div
      initial={false}
      animate={{
        opacity: hidden ? 0 : 1,
        transform:
          hidden && !reduce
            ? "translateY(4px) scale(0.96)"
            : "translateY(0px) scale(1)",
        width: width ?? "auto",
      }}
      transition={{
        opacity: {
          duration: hidden ? 0.12 : 0.2,
          ease,
          delay: hidden ? 0 : 0.06,
        },
        transform: {
          duration: hidden ? 0.12 : 0.2,
          ease,
          delay: hidden ? 0 : 0.06,
        },
        width: { duration: 0.28, ease },
      }}
      inert={hidden}
      aria-hidden={hidden || undefined}
      style={{ gridArea: "1 / 1", transformOrigin: "bottom center" }}
      className={cn(
        "box-content max-w-full overflow-hidden rounded-full border bg-popover/95 shadow-[0_1px_2px_oklch(0_0_0/0.06),0_12px_32px_-12px_oklch(0_0_0/0.25)] backdrop-blur supports-[backdrop-filter]:bg-popover/80",
        !hidden && "pointer-events-auto",
      )}
      data-intelligence-dock="bar"
    >
      <div ref={content} className="flex w-max items-center gap-1 p-1">
        <button
          type="button"
          onMouseDown={keep}
          onClick={onOpen}
          aria-label={`${label} (${shortcut})`}
          className="group flex h-8 min-w-0 items-center gap-2 rounded-full pr-2 pl-2.5 text-[13px] text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.97]"
        >
          <DockMark chat={chat} review={item?.review} />
          <motion.span key={label} {...motionProps} className="truncate">
            {label}
          </motion.span>
          <span className="hidden sm:inline-flex">
            <Kbd>{shortcut}</Kbd>
          </span>
        </button>
        {selection ? (
          <motion.div
            key="selection"
            {...motionProps}
            className="flex items-center gap-1"
          >
            {selectionSuggestions.slice(0, 2).map((s) => (
              <BarChip
                key={s.label}
                onMouseDown={keep}
                onClick={() => onAsk(s.prompt)}
              >
                {s.label}
              </BarChip>
            ))}
          </motion.div>
        ) : item?.review ? (
          <motion.div key={`review-${item.id}`} {...motionProps}>
            <ReviewChip
              item={item}
              review={item.review}
              onAssess={onAssess}
              onShow={onShowReview}
            />
          </motion.div>
        ) : null}
      </div>
    </motion.div>
  );
}

function BarChip({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 text-[12px] font-medium whitespace-nowrap transition-[background-color,transform] duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}

const bandDot = {
  good: "bg-success",
  fair: "bg-amber-500",
  poor: "bg-destructive",
} as const;

// The item's assessment at a glance: start one, follow it, or open it.
function ReviewChip({
  item,
  review,
  onAssess,
  onShow,
}: {
  item: DockItem;
  review: DockReview;
  onAssess: () => void;
  onShow: () => void;
}) {
  const { completed, active, failed } = reviewState(review);
  if (active)
    return (
      <BarChip onClick={onShow} aria-live="polite">
        <Loader2 className="size-3.5 animate-spin text-primary motion-reduce:animate-none" />
        Assessing {item.key}…
      </BarChip>
    );
  if (completed && !completed.staleAt && !failed)
    return (
      <BarChip
        onClick={onShow}
        title={`Lictory Intelligence assessment of ${item.key}`}
      >
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            bandDot[aiScoreBand(completed.score ?? 0)],
          )}
        />
        <span className="tabular-nums">{completed.score ?? 0}</span>
        <span className="text-muted-foreground">
          ·{" "}
          {completed.findings.length
            ? `${completed.findings.length} ${completed.findings.length === 1 ? "finding" : "findings"}`
            : "No findings"}
        </span>
      </BarChip>
    );
  return (
    <BarChip
      onClick={onAssess}
      disabled={!!review.blocked}
      title={
        review.blocked ??
        "Check this item and its parent and child items for missing information, ambiguity and gaps."
      }
    >
      <Sparkles className="size-3.5 text-primary" aria-hidden />
      {completed ? `Re-assess ${item.key}` : `Assess ${item.key}`}
    </BarChip>
  );
}

function Panel({
  reduce,
  chat,
  item,
  pageLabel,
  suggestions,
  attached,
  onDetach,
  assessing,
  onAssess,
  onDismissAssessment,
  composer,
  onSend,
  onNewChat,
  onContinue,
  onClose,
}: {
  reduce: boolean;
  chat: Chat<ChatMessage> | null;
  item: DockItem | null;
  pageLabel: string;
  suggestions: Suggestion[];
  attached: DockSelection | null;
  onDetach: () => void;
  assessing: { pending: boolean; error: string | null } | null;
  onAssess: () => void;
  onDismissAssessment: () => void;
  composer: React.RefObject<ComposerHandle | null>;
  onSend: (text: string, extra?: SendExtra) => void;
  onNewChat: () => void;
  onContinue: (id: string) => void;
  onClose: () => void;
}) {
  const { organization } = useWorkspace();
  // Esc minimizes; the conversation stays.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      onClose();
    }
  };
  const itemReview = item?.review;
  const review =
    item && itemReview && (assessing !== null || !chat) ? (
      <ReviewCard
        item={item}
        review={itemReview}
        assessing={assessing}
        onAssess={onAssess}
        onOpenFindings={(runId) => {
          itemReview.open(runId);
          onClose();
        }}
        onDismiss={chat ? onDismissAssessment : undefined}
        onDiscuss={(reviewRunId) =>
          onSend(
            "Walk me through this assessment: what should I fix first, and which findings need a human decision?",
            { reviewRunId },
          )
        }
      />
    ) : null;
  return (
    <motion.div
      initial={
        reduce
          ? { opacity: 0 }
          : { opacity: 0, transform: "translateY(12px) scale(0.97)" }
      }
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.12 } }
          : {
              opacity: 0,
              transform: "translateY(8px) scale(0.98)",
              transition: { duration: 0.14, ease },
            }
      }
      transition={{ duration: 0.22, ease, opacity: { duration: 0.12, ease } }}
      style={{ gridArea: "1 / 1", transformOrigin: "bottom center" }}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-label="Litto"
      data-intelligence-dock="panel"
      className={cn(
        "pointer-events-auto flex max-h-[min(680px,calc(100dvh-5rem))] w-[min(600px,100%)] flex-col overflow-hidden rounded-[18px] border bg-popover shadow-[0_1px_2px_oklch(0_0_0/0.06),0_24px_64px_-16px_oklch(0_0_0/0.35)]",
        // A conversation keeps one height while it streams.
        chat && "h-[min(680px,calc(100dvh-5rem))]",
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
        <DockMark chat={chat} review={item?.review} />
        <div className="mr-auto min-w-0">
          <p className="truncate text-[13px] font-medium">Litto</p>
          <p className="truncate text-[10px] text-muted-foreground">
            Powered by Lictory Intelligence
          </p>
        </div>
        {chat && <ChatActions chat={chat} onContinue={onContinue} />}
        {chat && (
          <HeaderButton label="New conversation" onClick={onNewChat}>
            <SquarePen className="size-4" />
          </HeaderButton>
        )}
        <HeaderButton label="Minimize (Esc)" onClick={onClose}>
          <ChevronDown className="size-4" />
        </HeaderButton>
      </header>
      {chat ? (
        <Conversation chat={chat} top={review}>
          {(thread) => (
            <Footer
              thread={thread}
              item={item}
              pageLabel={pageLabel}
              attached={attached}
              onDetach={onDetach}
              composer={composer}
              onSend={onSend}
              organizationId={organization.id}
            />
          )}
        </Conversation>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {review}
            <div>
              <p className="mb-2 text-[12px] font-medium text-muted-foreground">
                {attached
                  ? "About the selection"
                  : item
                    ? `About ${item.key}`
                    : `On ${pageLabel}`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s, i) => (
                  <motion.button
                    key={s.label}
                    type="button"
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{
                      duration: 0.2,
                      ease,
                      delay: 0.06 + i * 0.03,
                    }}
                    onClick={() => onSend(s.prompt)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-[12.5px] transition-[background-color,border-color,transform] duration-150 hover:border-foreground/15 hover:bg-muted active:scale-[0.97]"
                  >
                    {s.label}
                  </motion.button>
                ))}
              </div>
            </div>
          </div>
          <Footer
            thread={null}
            item={item}
            pageLabel={pageLabel}
            attached={attached}
            onDetach={onDetach}
            composer={composer}
            onSend={onSend}
            organizationId={organization.id}
          />
        </>
      )}
    </motion.div>
  );
}

// The dock's face follows the conversation, and works along while the item's
// review runs.
function DockMark({
  chat,
  review,
}: {
  chat: Chat<ChatMessage> | null;
  review?: DockReview | null;
}) {
  const reviewing = !!review && reviewState(review).active;
  if (chat) return <ChatMark chat={chat} reviewing={reviewing} />;
  return (
    <IntelligenceMark
      mood={reviewing ? "working" : "idle"}
      className="size-4 shrink-0 text-primary"
    />
  );
}

function ChatMark({
  chat,
  reviewing,
}: {
  chat: Chat<ChatMessage>;
  reviewing: boolean;
}) {
  const mood = useThreadMood(useThread(chat));
  return (
    <IntelligenceMark
      mood={reviewing && mood === "idle" ? "working" : mood}
      className="size-4 shrink-0 text-primary"
    />
  );
}

function HeaderButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ChatActions({
  chat,
  onContinue,
}: {
  chat: Chat<ChatMessage>;
  onContinue: (id: string) => void;
}) {
  const { busy, messages } = useThread(chat);
  if (!messages.length) return null;
  return (
    <HeaderButton
      label={busy ? "Open in Litto when the answer finishes" : "Open in Litto"}
      disabled={busy}
      onClick={() => onContinue(chat.id)}
    >
      <ArrowUpRight className="size-4" />
    </HeaderButton>
  );
}

function Conversation({
  chat,
  top,
  children,
}: {
  chat: Chat<ChatMessage>;
  top: ReactNode;
  children: (thread: Thread) => ReactNode;
}) {
  const thread = useThread(chat);
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const onScroll = () => {
    const el = scroller.current;
    if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [thread.messages, pinned, thread.status]);
  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto"
        >
          <div className="space-y-6 px-4 pt-4 pb-6 [&_.chat-prose]:text-[13.5px] [&_.chat-prose]:leading-6">
            {top}
            <ThreadMessages thread={thread} />
          </div>
        </div>
        <AnimatePresence>
          {!pinned && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.9 }}
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              onClick={() =>
                scroller.current?.scrollTo({
                  top: scroller.current.scrollHeight,
                  behavior: "smooth",
                })
              }
              aria-label="Scroll to latest"
              className="absolute bottom-2 left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-full border bg-card shadow-md hover:bg-muted"
            >
              <ArrowDown className="size-3.5" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      {children(thread)}
    </>
  );
}

// The context the next message carries, then the composer.
function Footer({
  thread,
  item,
  pageLabel,
  attached,
  onDetach,
  composer,
  onSend,
  organizationId,
}: {
  thread: Thread | null;
  item: DockItem | null;
  pageLabel: string;
  attached: DockSelection | null;
  onDetach: () => void;
  composer: React.RefObject<ComposerHandle | null>;
  onSend: (text: string) => void;
  organizationId: string;
}) {
  return (
    <div className="shrink-0 space-y-2 border-t bg-popover p-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-0.5">
        <span
          className="inline-flex h-6 max-w-[60%] min-w-0 items-center gap-1.5 rounded-full bg-muted px-2 text-[11px] text-muted-foreground"
          title="Sent with your next message"
        >
          <LocateFixed className="size-3 shrink-0" aria-hidden />
          <span className="truncate">
            {item ? `${item.key} · ${item.title}` : pageLabel}
          </span>
        </span>
        <AnimatePresence initial={false}>
          {attached && (
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              className="inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full bg-primary/10 pr-0.5 pl-2 text-[11px] text-primary"
            >
              <Quote className="size-3 shrink-0" aria-hidden />
              <span className="max-w-[260px] truncate">{attached.quote}</span>
              <button
                type="button"
                onClick={onDetach}
                aria-label="Remove the selection from the message"
                className="grid size-5 place-items-center rounded-full hover:bg-primary/15"
              >
                <X className="size-3" />
              </button>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <Composer
        ref={composer}
        autoFocus
        busy={thread?.busy}
        disabled={thread?.pendingQuestion}
        placeholder={
          thread?.pendingQuestion
            ? "Answer above to continue"
            : attached
              ? "Ask about the selection…"
              : item
                ? `Ask about ${item.key}, or what to change…`
                : "Ask Litto or describe what to do…"
        }
        onSend={(text) => onSend(text)}
        onStop={() => void thread?.stop()}
        organizationId={organizationId}
      />
    </div>
  );
}

// The item's Lictory Intelligence review inside the dock: start it, follow
// it, read the gist, then open the findings in the item or talk them through.
function ReviewCard({
  item,
  review,
  assessing,
  onAssess,
  onOpenFindings,
  onDismiss,
  onDiscuss,
}: {
  item: DockItem;
  review: DockReview;
  assessing: { pending: boolean; error: string | null } | null;
  onAssess: () => void;
  onOpenFindings: (runId: string) => void;
  onDismiss?: () => void;
  onDiscuss: (runId: string) => void;
}) {
  const { memberName } = useWorkspace();
  const { completed, active, failed, latest } = reviewState(review);
  const error = assessing?.error ?? (failed ? failed.error : null);
  const shown: Run | undefined = completed;
  return (
    <section
      aria-label={`Assessment of ${item.key}`}
      className="relative rounded-xl border bg-card p-3"
    >
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide the assessment"
          className="absolute top-2 right-2 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        {active || assessing?.pending ? (
          <motion.div
            key="running"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
            aria-live="polite"
            className="flex items-start gap-2.5 pr-6 text-[13px]"
          >
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
            <div className="min-w-0">
              <p className="font-medium">
                {latest?.status === "running" ? "Assessing" : "Queued:"}{" "}
                {item.key} with its parent and child items…
              </p>
              <p className="text-xs text-muted-foreground">
                Keep working; the result appears here and in the bar below.
              </p>
            </div>
          </motion.div>
        ) : shown ? (
          <motion.div
            key={shown.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-2.5"
          >
            <div className="flex items-start gap-3 pr-6">
              <ScoreRing score={shown.score ?? 0} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">
                  {shown.findings.length
                    ? `${shown.findings.length} ${shown.findings.length === 1 ? "finding" : "findings"} in ${item.key}`
                    : `No gaps found in ${item.key}`}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {shown.staleAt
                    ? `Outdated: ${shown.staleReason ?? "content changed"}`
                    : `${memberName(shown.requestedById)} · ${relativeTime(shown.completedAt ?? shown.createdAt)}`}
                </p>
                {counts(shown.findings).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {counts(shown.findings).map(([s, n]) => (
                      <Badge key={s} tone={severityMeta[s].tone}>
                        {n} {severityMeta[s].label.toLowerCase()}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {shown.findings.length > 0 && (
              <ul className="space-y-1 text-[12.5px]">
                {shown.findings.slice(0, 3).map((f) => (
                  <li key={f.id} className="flex gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        f.severity === "blocker"
                          ? "bg-destructive"
                          : f.severity === "major"
                            ? "bg-amber-500"
                            : "bg-muted-foreground/50",
                      )}
                    />
                    <span className="min-w-0">{f.title}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onOpenFindings(shown.id)}
              >
                Open findings
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDiscuss(shown.id)}
              >
                <MessagesSquare className="size-3.5" /> Talk it through
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={!!review.blocked || active}
                title={review.blocked ?? undefined}
                onClick={onAssess}
              >
                <RotateCcw className="size-3.5" /> Assess again
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="start"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-wrap items-center gap-3 pr-6"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">Assess {item.key}</p>
              <p className="text-xs text-muted-foreground">
                {review.blocked ??
                  "Finds missing information, ambiguity and gaps across this item and its child items, like a refinement session would."}
              </p>
            </div>
            <Button size="sm" disabled={!!review.blocked} onClick={onAssess}>
              Assess
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      {error && !active && !assessing?.pending && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {failed && !assessing?.error ? "The last assessment failed: " : ""}
          {error}
        </p>
      )}
    </section>
  );
}
