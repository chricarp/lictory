import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowUpRight,
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
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { Button } from "@lictory/ui/button";
import { Badge } from "@lictory/ui/primitives";
import {
  counts,
  severityMeta,
} from "@lictory/platform/components/review/ai-review";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import type { ChatContext } from "@lictory/core/intelligence/chat/shared";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { relativeTime } from "@lictory/core/lib/work-items";
import type { EntityOf } from "@lictory/core/contracts/protocol";
import {
  createChat,
  type LittoChat,
} from "@lictory/platform/components/intelligence/chat/chat-instance";
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
  pageSelectionSuggestions,
  pageSuggestions,
  spacePageSuggestions,
  type Suggestion,
} from "@lictory/platform/components/intelligence/dock/page";
import {
  useDock,
  useDockState,
  reviewState,
  type DockItem,
  type DockPage,
  type DockReview,
  type DockSelection,
} from "@lictory/platform/components/intelligence/dock/store";
import { useSpaces } from "@lictory/platform/components/spaces/store";
import {
  PaneResizer,
  usePaneResize,
  type PaneSpec,
} from "@lictory/platform/components/workspace/pane-resizer";

type Run = EntityOf<"aiRun">;
type SendExtra = {
  reviewRunId?: string;
  // Overrides the attached selection (the bar sends the live one).
  selection?: DockSelection | null;
};

// Strong ease-out: immediate response, soft landing.
const ease = [0.23, 1, 0.32, 1] as const;

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
const wideQuery = "(min-width: 1024px)";

// The side sheet: 360px, 400px from 1440px windows, 420px from 2200px.
const littoPane: PaneSpec = {
  pane: "litto",
  label: "Litto",
  edge: "start",
  min: 320,
  max: 720,
  share: { fraction: 0.32, floor: 360, of: "viewport" },
  preferred: ({ viewport }) =>
    viewport >= 2200 ? 420 : viewport >= 1440 ? 400 : 360,
  neighbour: () => document.querySelector("[data-app-frame]"),
  keep: 600,
};
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(wideQuery);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(wideQuery).matches,
    () => true,
  );
}

export function IntelligenceDock() {
  const { directory, organization, projects } = useWorkspace();
  const store = useDock();
  const { item, page: dockPage, selection, request } = useDockState();
  const { spaces, index: spaceIndex } = useSpaces();
  const pathname = usePathname();
  const params = useParams<{ project?: string }>();
  const router = useRouter();
  const reduce = useReducedMotion();
  const page = pageOf(pathname);
  const project = projects.find((p) => p.key === params.project?.toUpperCase());
  const available = directory.ai.available && directory.ai.enabled;
  const hidden = !store || !available || page.kind === "intelligence";
  const openItem = page.kind === "item" ? item : null;
  // A page of Lictory Spaces: what the reader publishes (exact version,
  // mentioned items), or on its history the page the address names.
  const routeSpace = page.space
    ? spaces.find((s) => s.slug === page.space)
    : undefined;
  const summary = page.pageId ? spaceIndex.pageById.get(page.pageId) : null;
  const openPage = useMemo((): DockPage | null => {
    if (page.kind !== "space-page" && page.kind !== "page-history") return null;
    if (page.kind === "space-page" && dockPage?.pageId === page.pageId)
      return dockPage;
    return summary
      ? {
          spaceId: summary.spaceId,
          pageId: summary.id,
          title: summary.title,
          items: [],
        }
      : null;
  }, [page.kind, page.pageId, dockPage, summary]);
  const pageLabel = (
    openPage
      ? page.kind === "page-history"
        ? `${openPage.title} · History`
        : openPage.title
      : routeSpace
        ? page.kind === "space"
          ? routeSpace.name
          : `${routeSpace.name} · ${page.label}`
        : page.label
  ).slice(0, 120);

  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<LittoChat | null>(null);
  // Launchers in the page chrome show whether the sheet is open.
  const expanded = open && !hidden;
  useEffect(() => {
    store?.setExpanded(expanded);
    return () => store?.setExpanded(false);
  }, [store, expanded]);
  // The selection travels with the next message, even after the page loses
  // it to the composer's focus.
  const [attached, setAttached] = useState<DockSelection | null>(null);
  const [assessing, setAssessing] = useState<{
    pending: boolean;
    error: string | null;
  } | null>(null);
  const composer = useRef<ComposerHandle>(null);

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
    if (attached?.itemId && attached.itemId !== itemId) setAttached(null);
  }
  const openPageId = openPage?.pageId;
  const [seenPage, setSeenPage] = useState(openPageId);
  if (seenPage !== openPageId) {
    setSeenPage(openPageId);
    if (attached?.pageId && attached.pageId !== openPageId) setAttached(null);
  }

  const context = useCallback(
    (extra: SendExtra = {}): ChatContext => {
      const quoted = extra.selection !== undefined ? extra.selection : attached;
      return {
        page: {
          label: openItem ? `${openItem.key} ${openItem.title}` : pageLabel,
          path: pathname,
        },
        project: project
          ? { id: project.id, key: project.key, name: project.name }
          : null,
        item: openItem
          ? { id: openItem.id, key: openItem.key, title: openItem.title }
          : null,
        selection:
          quoted?.itemId && quoted.itemId === openItem?.id
            ? { quote: quoted.quote, section: quoted.section }
            : null,
        reviewRunId: extra.reviewRunId ?? openItem?.review?.viewing ?? null,
        document: openPage
          ? {
              kind: "page",
              spaceId: openPage.spaceId,
              pageId: openPage.pageId,
              ...(openPage.branchId ? { branchId: openPage.branchId } : {}),
              ...(openPage.commitId ? { commitId: openPage.commitId } : {}),
              ...(quoted?.pageId && quoted.pageId === openPage.pageId
                ? {
                    selection: {
                      blockId: quoted.blockId,
                      quote: quoted.quote,
                    },
                  }
                : {}),
            }
          : null,
      };
    },
    [openItem, openPage, pageLabel, pathname, project, attached],
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
    if (request.toggle && open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (request.showReview) setAssessing({ pending: false, error: null });
    const current = store.get().selection;
    if (current) setAttached(current);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (request.assess) void assess();
    if (request.prompt) {
      if (request.send) send(request.prompt);
      else requestAnimationFrame(() => composer.current?.fill(request.prompt!));
    } else requestAnimationFrame(() => composer.current?.focus());
  }, [request, store, hidden, open, assess, send]);

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

  const newChat = () => {
    const current = chat;
    const reset = () => {
      setChat(null);
      setAssessing(null);
      requestAnimationFrame(() => composer.current?.focus());
    };
    // Stop the saved run before dropping it. A failed ack stays on screen.
    if (!current) {
      reset();
      return;
    }
    void current.stop().then(reset, () => undefined);
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

  return (
    // A side sheet beside the framed page on wide screens (the page narrows
    // instead of being covered); a sheet over the page on small ones.
    <AnimatePresence initial={false}>
      {open && (
        // Small screens: the page dims behind the sheet; tapping it closes.
        <motion.button
          key="scrim"
          type="button"
          aria-label="Close Litto"
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.16, ease }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/25 lg:hidden"
        />
      )}
      {open && (
        <Panel
          key="panel"
          reduce={!!reduce}
          chat={chat}
          item={openItem}
          pageLabel={pageLabel}
          suggestions={
            attached?.pageId
              ? pageSelectionSuggestions
              : attached
                ? selectionSuggestions
                : openItem
                  ? itemSuggestions(openItem)
                  : openPage && page.kind === "space-page"
                    ? spacePageSuggestions(openPage)
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
  chat: LittoChat | null;
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
  // Wide screens: a complementary sheet beside the page. Small screens: a
  // modal over it, so the page behind is inert and focus stays in the sheet.
  const modal = !useWide();
  const sheet = useRef<HTMLElement>(null);
  const resize = usePaneResize<HTMLElement>(littoPane);
  const { attach } = resize.pane;
  useEffect(() => {
    if (!modal) return;
    const page = document.querySelector<HTMLElement>("[data-app-frame]");
    if (!page) return;
    page.inert = true;
    return () => {
      page.inert = false;
    };
  }, [modal]);
  // Esc closes; the conversation stays. Focus returns to the launcher that
  // is on screen (the page header's, or the top bar's on small screens).
  const dismiss = () => {
    onClose();
    requestAnimationFrame(() => {
      // The page stops being inert before the sheet finishes leaving.
      const page = document.querySelector<HTMLElement>("[data-app-frame]");
      if (page) page.inert = false;
      [...document.querySelectorAll<HTMLElement>("[data-litto-launcher]")]
        .find((el) => el.offsetParent !== null)
        ?.focus();
    });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      dismiss();
      return;
    }
    if (modal && e.key === "Tab" && sheet.current) {
      const focusable = [
        ...sheet.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
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
    <motion.aside
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.12 } }
          : { opacity: 0, x: 8, transition: { duration: 0.14, ease } }
      }
      transition={{ duration: 0.2, ease, opacity: { duration: 0.12, ease } }}
      ref={(element) => {
        sheet.current = element;
        attach(element);
      }}
      id={resize.pane.id}
      style={resize.pane.style}
      onKeyDown={onKeyDown}
      role={modal ? "dialog" : "complementary"}
      aria-modal={modal || undefined}
      aria-label="Litto"
      data-intelligence-dock="panel"
      className={cn(
        "flex flex-col overflow-hidden bg-background",
        // Small screens: a sheet over the page, anchored to the bottom.
        "fixed inset-x-2 bottom-2 z-40 max-h-[min(640px,calc(100dvh-4rem))] rounded-[1.25rem] shadow-(--shadow-panel)",
        chat && "h-[min(640px,calc(100dvh-4rem))]",
        // Wide screens: a second framed surface beside the page, as wide as
        // the person dragged it or the default for the window. The default
        // tiers use `min-[…]` alone: Tailwind orders those by value, but
        // emits `lg:` after them, so a `lg:` width would win at every size.
        "min-[1440px]:rounded-[20px] lg:relative lg:inset-auto lg:z-auto lg:h-auto lg:max-h-none lg:shrink-0 lg:rounded-2xl lg:shadow-(--shadow-border) lg:dark:shadow-(--shadow-border-hover)",
        resize.pane.sized
          ? "lg:w-(--pane-w)"
          : "min-[1024px]:w-[360px] min-[1440px]:w-[400px] min-[2200px]:w-[420px]",
      )}
    >
      {!modal && (
        <PaneResizer
          resize={resize.handle}
          inset
          className="absolute inset-y-0 left-0"
        />
      )}
      <header className="flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
        <DockMark chat={chat} review={item?.review} />
        <div className="mr-auto flex min-w-0 items-baseline gap-2">
          <p className="text-[13px] font-semibold">Litto</p>
          {/* What Litto is looking at, so answers are read in context. */}
          {item && (
            <p className="truncate font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              {item.key}
            </p>
          )}
        </div>
        {chat && <ChatActions chat={chat} onContinue={onContinue} />}
        {chat && (
          <HeaderButton label="New conversation" onClick={onNewChat}>
            <SquarePen className="size-4" />
          </HeaderButton>
        )}
        <HeaderButton label="Close Litto (Esc)" onClick={dismiss}>
          <X className="size-4" />
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
    </motion.aside>
  );
}

// The dock's face follows the conversation, and works along while the item's
// review runs.
function DockMark({
  chat,
  review,
}: {
  chat: LittoChat | null;
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
  chat: LittoChat;
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
  chat: LittoChat;
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
  chat: LittoChat;
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
        onStop={() => {
          void thread?.stop().catch(() => undefined);
        }}
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
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">
                <IntelligenceMark className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="mb-0.5 font-mono text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                  AI assessment · proposal
                </p>
                <p className="text-[13px] font-medium">
                  {shown.findings.length
                    ? `${shown.findings.length} proposed ${shown.findings.length === 1 ? "concern" : "concerns"} in ${item.key}`
                    : `No proposed concerns in ${item.key}`}
                </p>
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium ring-1 ring-inset",
                      shown.staleAt
                        ? "bg-warning/8 text-warning ring-warning/25"
                        : "bg-success/8 text-success ring-success/20",
                    )}
                  >
                    {shown.staleAt ? "Outdated" : "Current"}
                  </span>
                  <span className="truncate">
                    {shown.staleAt
                      ? (shown.staleReason ?? "content changed")
                      : [
                          item.review?.revisionOf(shown) != null
                            ? `Read revision ${item.review.revisionOf(shown)}`
                            : null,
                          relativeTime(shown.completedAt ?? shown.createdAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </span>
                </p>
                {counts(shown.findings).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {counts(shown.findings).map(([s, n]) => (
                      <Badge key={s} tone={severityMeta[s].tone}>
                        {n} proposed {severityMeta[s].label.toLowerCase()}
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
                            ? "bg-warning"
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
