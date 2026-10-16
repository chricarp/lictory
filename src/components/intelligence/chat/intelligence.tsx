"use client";
import { useChat } from "@ai-sdk/react";
import type { Chat } from "@ai-sdk/react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  AlertTriangle,
  ArrowDown,
  FileText,
  ListChecks,
  MessageSquareDashed,
  PanelLeft,
  RotateCcw,
  Search,
  SquarePen,
  Zap,
} from "lucide-react";
import { IntelligenceMark } from "~/components/logo";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "~/components/ui/button";
import { useWorkspace } from "~/components/workspace/provider";
import type { ChatMessage } from "~/intelligence/chat/shared";
import { ASK_QUESTIONS, RECOMMEND_ACTION } from "~/intelligence/chat/shared";
import { paths } from "~/lib/paths";
import { cn } from "~/lib/utils";
import { ChatList, chatLabel } from "./chat-list";
import { Composer, type ComposerHandle } from "./composer";
import { MessageView } from "./message";
import { ChatsProvider, useChats } from "./provider";

const ease = [0.23, 1, 0.32, 1] as const;

// Lictory Intelligence: conversation history beside the active conversation.
// Rendered by the route layout so the composer and a streaming answer keep
// their state while the URL moves from the new-chat page to the chat.
export function Intelligence() {
  return (
    <ChatsProvider>
      <IntelligenceShell />
    </ChatsProvider>
  );
}

function IntelligenceShell() {
  const { activeId, newChat } = useChats();
  const [listOpen, setListOpen] = useState(false);
  const [listHidden, setListHidden] = useState(false);

  // ⌘⇧O / Ctrl+Shift+O starts a new conversation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o"
      ) {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  return (
    <div className="flex h-full min-h-0">
      <AnimatePresence initial={false}>
        {!listHidden && (
          <motion.aside
            key="list"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 264, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease }}
            className="hidden shrink-0 overflow-hidden border-r bg-sidebar/40 md:block"
          >
            <div className="h-full w-[264px]">
              <ChatList />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {listOpen && (
          <motion.div
            className="fixed inset-0 z-40 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              aria-label="Close conversations"
              className="absolute inset-0 bg-black/30"
              onClick={() => setListOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", duration: 0.35, bounce: 0 }}
              className="absolute inset-y-0 left-0 w-[280px] border-r bg-background shadow-xl"
            >
              <ChatList onNavigate={() => setListOpen(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <section className="relative flex min-w-0 flex-1 flex-col">
        <LayoutGroup>
          {activeId ? (
            <Conversation
              key={activeId}
              id={activeId}
              toolbar={
                <ListToggles
                  hidden={listHidden}
                  onToggle={() => setListHidden((h) => !h)}
                  onOpenMobile={() => setListOpen(true)}
                />
              }
            />
          ) : (
            <NewConversation
              toolbar={
                <ListToggles
                  hidden={listHidden}
                  onToggle={() => setListHidden((h) => !h)}
                  onOpenMobile={() => setListOpen(true)}
                />
              }
            />
          )}
        </LayoutGroup>
      </section>
    </div>
  );
}

function ListToggles({
  hidden,
  onToggle,
  onOpenMobile,
}: {
  hidden: boolean;
  onToggle: () => void;
  onOpenMobile: () => void;
}) {
  const cls =
    "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";
  return (
    <>
      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="Show conversations"
        className={cn(cls, "md:hidden")}
      >
        <PanelLeft className="size-4" />
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-label={hidden ? "Show conversations" : "Hide conversations"}
        title={hidden ? "Show conversations" : "Hide conversations"}
        className={cn(cls, "hidden md:grid")}
      >
        <PanelLeft className="size-4" />
      </button>
    </>
  );
}

function Header({
  children,
  toolbar,
}: {
  children?: ReactNode;
  toolbar: ReactNode;
}) {
  const { newChat } = useChats();
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      {toolbar}
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        variant="ghost"
        size="sm"
        onClick={newChat}
        title="New conversation (⌘⇧O)"
      >
        <SquarePen className="size-3.5" /> New chat
      </Button>
    </header>
  );
}

function useAiState() {
  const { directory, isAdmin, organization } = useWorkspace();
  const { enabled, available } = directory.ai;
  if (!available)
    return {
      ok: false as const,
      message:
        "Lictory Intelligence is not configured on this server. Ask an administrator to set OPENAI_API_KEY.",
      action: null,
    };
  if (!enabled)
    return {
      ok: false as const,
      message: isAdmin
        ? "Lictory Intelligence is turned off for this organization. Turn it on to start chatting; organization content is sent to the configured AI provider only after you opt in."
        : "Lictory Intelligence is turned off for this organization. Ask an administrator to enable it in Settings.",
      action: isAdmin
        ? {
            label: "Open Lictory Intelligence settings",
            href: `${paths.settings(organization.slug)}#ai`,
          }
        : null,
    };
  return { ok: true as const, message: null, action: null };
}

function greeting(name: string) {
  const hour = new Date().getHours();
  const part =
    hour < 5
      ? "evening"
      : hour < 12
        ? "morning"
        : hour < 18
          ? "afternoon"
          : "evening";
  const first = name.split(" ")[0];
  return `Good ${part}${first ? `, ${first}` : ""}`;
}

function NewConversation({ toolbar }: { toolbar: ReactNode }) {
  const { start } = useChats();
  const { directory, userId, projects, delivery, organization } =
    useWorkspace();
  const ai = useAiState();
  const reduce = useReducedMotion();
  const composer = useRef<ComposerHandle>(null);
  const me = directory.members.find((m) => m.id === userId);
  const project = projects[0];
  const team = [...delivery.teams.values()].find(
    (t) => !t.archivedAt && t.memberIds.includes(userId),
  );
  const suggestions = [
    {
      icon: <FileText className="size-4" />,
      title: "Draft a story",
      prompt: project
        ? `Draft a new story in ${project.key} for `
        : "Draft a new story for ",
    },
    {
      icon: <ListChecks className="size-4" />,
      title: "What needs my review?",
      prompt: "What is waiting for my review, and what is blocking it?",
    },
    {
      icon: <Zap className="size-4" />,
      title: team ? `How is ${team.name} doing?` : "Sprint status",
      prompt: team
        ? `Summarize the active iteration for ${team.name}: progress, risks and blocked items.`
        : "Summarize the active iteration: progress, risks and blocked items.",
    },
    {
      icon: <Search className="size-4" />,
      title: "Find gaps in a spec",
      prompt: "Find missing acceptance criteria and failure behavior in ",
    },
  ];
  const stagger = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 8, filter: "blur(4px)" },
          animate: { opacity: 1, y: 0, filter: "blur(0px)" },
          transition: { duration: 0.5, ease, delay: 0.05 + i * 0.06 },
        };

  return (
    <>
      <Header toolbar={toolbar} />
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-16">
        <div
          aria-hidden
          className="pointer-events-none absolute top-[18%] left-1/2 size-[420px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_65%)] blur-2xl motion-safe:animate-[intelligence-orb_8s_ease-in-out_infinite]"
        />
        <div className="relative w-full max-w-2xl">
          <motion.div
            {...stagger(0)}
            className="mb-6 flex flex-col items-center text-center"
          >
            <span className="mb-4 grid size-11 place-items-center rounded-2xl border bg-card shadow-sm">
              <IntelligenceMark className="size-5 text-primary" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting(me?.name ?? "")}
            </h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              Ask about your work, or tell Lictory what to create, refine or
              update.
            </p>
          </motion.div>
          {ai.ok ? (
            <motion.div
              layoutId="intelligence-composer"
              transition={{ type: "spring", duration: 0.5, bounce: 0.1 }}
            >
              <Composer
                ref={composer}
                autoFocus
                onSend={start}
                organizationId={organization.id}
                context={`Acts as you in ${organization.name}`}
              />
            </motion.div>
          ) : (
            <AiUnavailable message={ai.message} action={ai.action} />
          )}
          {ai.ok && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {suggestions.map((s, i) => (
                <motion.button
                  key={s.title}
                  type="button"
                  {...stagger(i + 1)}
                  whileTap={reduce ? undefined : { scale: 0.98 }}
                  onClick={() => composer.current?.fill(s.prompt)}
                  className="group flex items-center gap-3 rounded-xl border bg-card/60 px-3 py-2.5 text-left text-[13px] transition-colors hover:border-foreground/15 hover:bg-card"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-primary">
                    {s.icon}
                  </span>
                  <span className="font-medium">{s.title}</span>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function AiUnavailable({
  message,
  action,
}: {
  message: string;
  action: { label: string; href: string } | null;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 text-center">
      <p className="text-[13px] text-muted-foreground">{message}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-3 inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

function Conversation({ id, toolbar }: { id: string; toolbar: ReactNode }) {
  const { chatFor, loadError, chats, freshTitles } = useChats();
  const chat = chatFor(id);
  const summary = chats.find((c) => c.id === id);
  const reduce = useReducedMotion();
  const error = loadError(id);
  return (
    <>
      <Header toolbar={toolbar}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.h1
            key={summary?.title ?? "untitled"}
            initial={
              freshTitles.has(id) && !reduce
                ? { opacity: 0, y: 6, filter: "blur(4px)" }
                : false
            }
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.35, ease }}
            className={cn(
              "truncate text-[13px] font-medium",
              !summary?.title && "text-muted-foreground",
            )}
          >
            {summary ? chatLabel(summary) : "Conversation"}
          </motion.h1>
        </AnimatePresence>
      </Header>
      {chat ? (
        <ChatThread chat={chat} />
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <MessageSquareDashed
            className="size-6 text-muted-foreground"
            aria-hidden
          />
          <p className="text-[13px] text-muted-foreground">{error}</p>
        </div>
      ) : (
        <div
          className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 pt-8"
          aria-busy
        >
          <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-muted" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}
    </>
  );
}

function ChatThread({ chat }: { chat: Chat<ChatMessage> }) {
  const { organization } = useWorkspace();
  const ai = useAiState();
  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    regenerate,
    addToolOutput,
    addToolApprovalResponse,
    clearError,
  } = useChat<ChatMessage>({ chat, experimental_throttle: 40 });
  const busy = status === "submitted" || status === "streaming";
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // Follow the answer while the reader is at the bottom; stop following once
  // they scroll up.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [messages, pinned, status]);
  const toBottom = () =>
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });

  const pendingQuestion = messages
    .at(-1)
    ?.parts.some(
      (p) =>
        (p.type === `tool-${ASK_QUESTIONS}` ||
          p.type === `tool-${RECOMMEND_ACTION}`) &&
        "state" in p &&
        p.state === "input-available",
    );

  return (
    <>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl space-y-7 px-4 pt-8 pb-10">
          {messages.map((message, i) => (
            <MessageView
              key={message.id}
              message={message}
              streaming={busy}
              isLast={i === messages.length - 1}
              onAnswer={(toolCallId, output) =>
                void addToolOutput({
                  tool: ASK_QUESTIONS as never,
                  toolCallId,
                  output,
                })
              }
              onDecide={(toolCallId, output) =>
                void addToolOutput({
                  tool: RECOMMEND_ACTION as never,
                  toolCallId,
                  output,
                })
              }
              onApprove={(approvalId, approved) =>
                void addToolApprovalResponse({ id: approvalId, approved })
              }
              onRegenerate={
                i === messages.length - 1 && !busy
                  ? () => void regenerate()
                  : undefined
              }
            />
          ))}
          {status === "submitted" && messages.at(-1)?.role === "user" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              <MessageView
                message={{ id: "pending", role: "assistant", parts: [] }}
                streaming
                isLast
                onAnswer={() => undefined}
                onDecide={() => undefined}
                onApprove={() => undefined}
              />
            </motion.div>
          )}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px]"
                role="alert"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden
                />
                <p className="min-w-0 flex-1">{readableError(error)}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    clearError();
                    void regenerate();
                  }}
                >
                  <RotateCcw className="size-3.5" /> Retry
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="relative shrink-0 px-4 pb-4">
        <AnimatePresence>
          {!pinned && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.9 }}
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              onClick={toBottom}
              aria-label="Scroll to latest"
              className="absolute -top-11 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border bg-card shadow-md hover:bg-muted"
            >
              <ArrowDown className="size-4" />
            </motion.button>
          )}
        </AnimatePresence>
        <motion.div
          layoutId="intelligence-composer"
          transition={{ type: "spring", duration: 0.5, bounce: 0.1 }}
          className="mx-auto w-full max-w-3xl"
        >
          {ai.ok ? (
            <Composer
              autoFocus
              busy={busy}
              disabled={pendingQuestion}
              placeholder={
                pendingQuestion
                  ? "Answer above to continue"
                  : "Reply to Lictory…"
              }
              onSend={(text) => void sendMessage({ text })}
              onStop={() => void stop()}
              organizationId={organization.id}
              context={`Acts as you in ${organization.name}`}
            />
          ) : (
            <AiUnavailable message={ai.message} action={ai.action} />
          )}
          <p className="mt-2 text-center text-[11px] text-muted-foreground/80">
            Lictory Intelligence can be wrong. Decisions, approvals and
            publishing always stay with people.
          </p>
        </motion.div>
      </div>
    </>
  );
}

function readableError(error: Error) {
  try {
    const parsed = JSON.parse(error.message) as {
      error?: { message?: string };
    };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON: already a message.
  }
  return error.message || "The assistant stopped unexpectedly. Try again.";
}
