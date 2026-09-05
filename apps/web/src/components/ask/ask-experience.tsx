"use client";

import type {
  AskCitation,
  AskConversation,
  AskMessage,
  AskSourceKind,
} from "@lictory/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  AskContextSummary,
  AskRecommendations,
  AskThinkingTrace,
  ContextScopeIcons,
} from "@/components/ask/ask-ai-elements";
import { Markdown } from "@/components/notes/markdown";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  Copy,
  FileText,
  ImageIcon,
  Network,
  Pencil,
  Plus,
  RotateCw,
  Sparkles,
  StickyNote,
  X,
} from "@/components/ui/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useApi, useResource } from "@/lib/api";
import { cn } from "@/lib/utils";

const STARTERS = [
  "What have I written about recently?",
  "Where did I mention my next trip?",
  "What decisions are still waiting on me?",
];

const SOURCE_META: Record<
  AskSourceKind,
  { label: string; icon: typeof StickyNote }
> = {
  body: { label: "Written", icon: StickyNote },
  audio: { label: "Audio", icon: AudioLines },
  image: { label: "Image", icon: ImageIcon },
  document: { label: "File", icon: FileText },
  context: { label: "Context", icon: Network },
};

async function writeClipboard(value: string) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const element = document.createElement("textarea");
  element.value = value;
  element.style.position = "fixed";
  element.style.opacity = "0";
  document.body.append(element);
  element.select();
  const copied = document.execCommand("copy");
  element.remove();
  if (!copied) throw new Error("Clipboard access is unavailable");
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <button
      type="button"
      onClick={() => {
        void writeClipboard(content)
          .then(() => {
            setCopied(true);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setCopied(false), 1_600);
          })
          .catch(() => toast.error("Could not copy that message"));
      }}
      className="flex size-8 items-center justify-center rounded-md text-subtle transition-[background-color,color] hover:bg-surface-strong hover:text-foreground"
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy"}
    >
      <span className="t-icon-swap" data-state={copied ? "b" : "a"}>
        <span className="t-icon" data-icon="a">
          <Copy className="size-3.5" />
        </span>
        <span className="t-icon text-success" data-icon="b">
          <Check className="size-3.5" />
        </span>
      </span>
    </button>
  );
}

function AskComposer({
  message,
  onMessageChange,
  onSubmit,
  loading,
  prominent,
}: {
  message: string;
  onMessageChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  prominent: boolean;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    const focus = () => textareaRef.current?.focus();
    window.addEventListener("lictory:focus-ask", focus);
    return () => window.removeEventListener("lictory:focus-ask", focus);
  }, []);

  React.useEffect(() => {
    if (!message && textareaRef.current) textareaRef.current.style.height = "";
  }, [message]);

  const resize = (element: HTMLTextAreaElement) => {
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  };

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        if (!loading && message.trim().length >= 2) onSubmit();
      }}
      className={cn(
        "relative isolate overflow-hidden rounded-[1.125rem] border bg-canvas-raised shadow-[0_24px_80px_-42px_rgb(var(--ember)/0.7)] transition-[border-color,box-shadow,transform] focus-within:border-[rgb(var(--ember)/0.5)] focus-within:shadow-[0_26px_90px_-38px_rgb(var(--ember)/0.8)]",
        prominent ? "border-hairline-strong" : "border-hairline",
      )}
    >
      <textarea
        ref={textareaRef}
        autoFocus={prominent}
        value={message}
        onChange={(event) => {
          onMessageChange(event.target.value);
          resize(event.target);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            formRef.current?.requestSubmit();
          }
        }}
        rows={prominent ? 2 : 1}
        maxLength={1_000}
        placeholder={
          prominent ? "Ask anything you remember…" : "Ask a follow-up…"
        }
        aria-label="Ask your notes"
        className={cn(
          "max-h-40 w-full resize-none bg-transparent px-4 pt-4 text-[0.9375rem] leading-6 text-foreground outline-none placeholder:text-subtle",
          prominent ? "min-h-[5.25rem]" : "min-h-[3.75rem]",
        )}
      />

      <div className="flex items-center gap-2 p-2 pt-1">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-8 items-center gap-2 rounded-lg px-2 text-xs font-medium text-muted transition-[background-color,color] hover:bg-surface-strong hover:text-foreground"
              aria-label="Show searched context"
            >
              <ContextScopeIcons />
              <span>All context</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-64 p-2">
            <p className="px-2 pb-2 pt-1 text-xs font-medium text-foreground">
              Searches the whole note
            </p>
            {Object.values(SOURCE_META).map((source) => {
              const Icon = source.icon;
              return (
                <div
                  key={source.label}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted"
                >
                  <Icon className="size-3.5 text-subtle" />
                  {source.label}
                  <Check className="ml-auto size-3 text-success" />
                </div>
              );
            })}
          </PopoverContent>
        </Popover>

        <span className="ml-auto hidden text-[0.6875rem] text-subtle sm:inline">
          {message.length > 0
            ? `${message.length.toLocaleString()} / 1,000`
            : "Enter to send · Shift + Enter for a new line"}
        </span>

        <button
          type="submit"
          disabled={loading || message.trim().length < 2}
          aria-label="Send message"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-canvas transition-[opacity,transform,background-color] enabled:hover:bg-ember enabled:active:scale-[0.94] disabled:opacity-25"
        >
          <ArrowRight className="size-4 -rotate-90" />
        </button>
      </div>
    </form>
  );
}

function Citations({ citations }: { citations: AskCitation[] }) {
  if (citations.length === 0) return null;
  const kinds = [
    ...new Set(
      citations.flatMap((citation) =>
        citation.sourceKinds.map((kind) => SOURCE_META[kind].label),
      ),
    ),
  ];
  return (
    <div className="mt-6 border-t border-hairline pt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">Context used</p>
        <AskContextSummary count={citations.length} kinds={kinds} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {citations.map((citation, index) => (
          <Link
            key={`${citation.noteId}:${index}`}
            href={`/app/notes/${citation.noteId}`}
            className="ask-context-enter group/source min-w-0 rounded-xl border border-hairline bg-surface p-3.5 transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-hairline-strong hover:bg-surface-strong active:translate-y-0"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <div className="mb-2 flex items-start gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--ember)/0.1)] text-[0.6875rem] font-semibold text-ember">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {citation.title ?? "Untitled note"}
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-subtle transition-colors group-hover/source:text-ember" />
            </div>
            <p className="line-clamp-3 text-xs leading-5 text-muted">
              {citation.excerpt}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {citation.sourceKinds.map((kind) => {
                const meta = SOURCE_META[kind];
                const Icon = meta.icon;
                return (
                  <span
                    key={kind}
                    className="inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-1 text-[0.625rem] text-subtle"
                  >
                    <Icon className="size-2.5" />
                    {meta.label}
                  </span>
                );
              })}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

type EditState = { messageId: string; draft: string } | null;

function UserMessage({
  message,
  editState,
  onEditStateChange,
  onSave,
  working,
}: {
  message: AskMessage;
  editState: EditState;
  onEditStateChange: (state: EditState) => void;
  onSave: (value: string) => void;
  working: boolean;
}) {
  const editing = editState?.messageId === message.id;
  return (
    <div className="group/message flex justify-end">
      <div className="max-w-[92%] sm:max-w-[85%]">
        {editing ? (
          <div className="rounded-2xl rounded-br-md border border-[rgb(var(--ember)/0.4)] bg-surface-strong p-2 shadow-[0_0_0_1px_rgb(var(--ember)/0.08)]">
            <textarea
              autoFocus
              rows={3}
              maxLength={1_000}
              value={editState.draft}
              onChange={(event) =>
                onEditStateChange({
                  messageId: message.id,
                  draft: event.target.value,
                })
              }
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  if (editState.draft.trim().length >= 2)
                    onSave(editState.draft);
                }
              }}
              className="max-h-48 min-h-24 w-full resize-y bg-transparent px-2 py-1 text-sm leading-6 text-foreground outline-none"
              aria-label="Edit sent message"
            />
            <p className="px-2 pb-2 text-[0.6875rem] text-subtle">
              Saving replaces the responses and follow-ups after this message.
            </p>
            <div className="flex justify-end gap-2 border-t border-hairline pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={working}
                onClick={() => onEditStateChange(null)}
              >
                <X /> Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={working}
                disabled={editState.draft.trim().length < 2}
                onClick={() => onSave(editState.draft)}
              >
                Save and regenerate
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-strong px-4 py-3 text-sm leading-6 text-foreground">
            {message.contentMarkdown}
          </p>
        )}

        {!editing ? (
          <div className="mt-1 flex justify-end gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/message:opacity-100 sm:group-focus-within/message:opacity-100">
            <CopyButton content={message.contentMarkdown} />
            <button
              type="button"
              onClick={() =>
                onEditStateChange({
                  messageId: message.id,
                  draft: message.contentMarkdown,
                })
              }
              disabled={working}
              className="flex size-8 items-center justify-center rounded-md text-subtle transition-[background-color,color] hover:bg-surface-strong hover:text-foreground disabled:opacity-50"
              aria-label="Edit sent message"
              title="Edit"
            >
              <Pencil className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  onRegenerate,
  onRecommendation,
  showRecommendations,
  working,
}: {
  message: AskMessage;
  onRegenerate: () => void;
  onRecommendation: (value: string) => void;
  showRecommendations: boolean;
  working: boolean;
}) {
  return (
    <div className="group/message grid gap-4 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
      <span className="flex size-10 items-center justify-center rounded-xl border border-[rgb(var(--ember)/0.25)] bg-[rgb(var(--ember)/0.08)] text-ember shadow-[0_0_24px_rgb(var(--ember)/0.1)]">
        <Sparkles className="size-[1.125rem]" />
      </span>
      <div className="min-w-0 pt-1">
        <Markdown className="ask-answer-enter text-[0.9375rem] leading-7">
          {message.contentMarkdown}
        </Markdown>
        <Citations citations={message.citations} />
        <div className="mt-2 flex gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/message:opacity-100 sm:group-focus-within/message:opacity-100">
          <CopyButton content={message.contentMarkdown} />
          <button
            type="button"
            onClick={onRegenerate}
            disabled={working}
            className="flex size-8 items-center justify-center rounded-md text-subtle transition-[background-color,color] hover:bg-surface-strong hover:text-foreground disabled:opacity-50"
            aria-label="Regenerate response"
            title="Regenerate"
          >
            <RotateCw className={cn("size-3.5", working && "animate-spin")} />
          </button>
        </div>
        {showRecommendations ? (
          <AskRecommendations
            className="mt-6"
            heading="Continue exploring"
            onSelect={onRecommendation}
          />
        ) : null}
      </div>
    </div>
  );
}

export function AskExperience({
  initialConversationId,
}: {
  initialConversationId: string | null;
}) {
  const api = useApi();
  const router = useRouter();
  const loaded = useResource(
    initialConversationId ? `ask:${initialConversationId}` : null,
    () => api.getAskConversation(initialConversationId ?? ""),
  );
  const [message, setMessage] = React.useState("");
  const [pendingMessage, setPendingMessage] = React.useState<string | null>(
    null,
  );
  const [operation, setOperation] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [editState, setEditState] = React.useState<EditState>(null);
  const [view, setView] = React.useState<{
    routeId: string | null;
    local: AskConversation | null;
  }>({ routeId: initialConversationId, local: null });
  const endRef = React.useRef<HTMLDivElement>(null);

  if (view.routeId !== initialConversationId) {
    setView({
      routeId: initialConversationId,
      local: view.local?.id === initialConversationId ? view.local : null,
    });
    if (editState) setEditState(null);
  }

  const conversation = view.local ?? loaded.data?.conversation ?? null;
  const waitingForHistory =
    Boolean(initialConversationId) && !conversation && loaded.loading;
  const busy = operation !== null;

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation?.updatedAt, pendingMessage]);

  const announceConversationChange = () =>
    window.dispatchEvent(new Event("lictory:ask-history-changed"));

  const submit = async () => {
    const value = message.trim();
    if (value.length < 2 || busy) return;
    setOperation("submit");
    setPendingMessage(value);
    setMessage("");
    setSubmitError(null);
    try {
      const result = conversation
        ? await api.createAskMessage(conversation.id, { message: value })
        : await api.createAskConversation({ message: value });
      setView({
        // Keep the route key aligned with the current prop until Next commits
        // the URL replacement; otherwise render-time key synchronization would
        // discard this just-created conversation for one frame.
        routeId: initialConversationId,
        local: result.conversation,
      });
      if (!conversation) {
        router.replace(
          `/app/ask?id=${encodeURIComponent(result.conversation.id)}`,
          { scroll: false },
        );
      }
      announceConversationChange();
    } catch (error) {
      setMessage(value);
      setSubmitError(
        error instanceof Error ? error.message : "Could not ask your notes",
      );
    } finally {
      setPendingMessage(null);
      setOperation(null);
    }
  };

  const saveEdit = async (messageId: string, value: string) => {
    if (!conversation || busy) return;
    const next = value.trim();
    if (next.length < 2) return;
    setOperation(`edit:${messageId}`);
    setSubmitError(null);
    try {
      const result = await api.updateAskMessage(conversation.id, messageId, {
        message: next,
      });
      setView({ routeId: conversation.id, local: result.conversation });
      setEditState(null);
      announceConversationChange();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Could not update that message",
      );
    } finally {
      setOperation(null);
    }
  };

  const regenerate = async (messageId: string) => {
    if (!conversation || busy) return;
    setOperation(`regenerate:${messageId}`);
    setSubmitError(null);
    try {
      const result = await api.regenerateAskMessage(conversation.id, messageId);
      setView({ routeId: conversation.id, local: result.conversation });
      setEditState(null);
      announceConversationChange();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Could not regenerate that response",
      );
    } finally {
      setOperation(null);
    }
  };

  const empty =
    !initialConversationId &&
    !conversation &&
    !waitingForHistory &&
    !pendingMessage;
  const latestAssistantId = [...(conversation?.messages ?? [])]
    .reverse()
    .find((item) => item.role === "assistant")?.id;

  const chooseRecommendation = (value: string) => {
    setMessage(value);
    window.dispatchEvent(new Event("lictory:focus-ask"));
  };

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7.5rem)] w-full max-w-3xl flex-col">
      {empty ? (
        <div className="flex flex-1 flex-col justify-center pb-[12vh]">
          <div className="mb-8 text-center">
            <span className="relative mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-[rgb(var(--ember)/0.3)] bg-[rgb(var(--ember)/0.08)] text-ember shadow-[0_0_60px_rgb(var(--ember)/0.16)]">
              <span className="absolute inset-2 animate-pulse rounded-xl border border-[rgb(var(--ember)/0.18)]" />
              <Sparkles className="relative size-6" />
            </span>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
              Ask your memory
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted">
              Start a conversation grounded in your writing, voice memos,
              images, files and context.
            </p>
          </div>

          <AskComposer
            message={message}
            onMessageChange={setMessage}
            onSubmit={() => void submit()}
            loading={busy}
            prominent
          />

          <AskRecommendations
            className="mx-auto mt-5 w-full max-w-2xl"
            recommendations={STARTERS}
            onSelect={chooseRecommendation}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="mb-8 flex min-w-0 items-center gap-3 border-b border-hairline pb-4">
            <Sparkles className="size-4 shrink-0 text-ember" />
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {conversation?.title ?? "Ask your memory"}
            </h1>
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/ask">
                <Plus /> New
              </Link>
            </Button>
          </div>

          <div className="flex-1 space-y-10">
            {conversation?.messages.map((item) =>
              item.role === "user" ? (
                <UserMessage
                  key={item.id}
                  message={item}
                  editState={editState}
                  onEditStateChange={setEditState}
                  onSave={(value) => void saveEdit(item.id, value)}
                  working={operation === `edit:${item.id}`}
                />
              ) : (
                <AssistantMessage
                  key={item.id}
                  message={item}
                  onRegenerate={() => void regenerate(item.id)}
                  onRecommendation={chooseRecommendation}
                  showRecommendations={item.id === latestAssistantId}
                  working={operation === `regenerate:${item.id}`}
                />
              ),
            )}
            {pendingMessage ? (
              <>
                <div className="flex justify-end">
                  <p className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-strong px-4 py-3 text-sm leading-6 text-foreground sm:max-w-[85%]">
                    {pendingMessage}
                  </p>
                </div>
                <AskThinkingTrace />
              </>
            ) : null}
            {waitingForHistory ? (
              <AskThinkingTrace label="Opening conversation" />
            ) : null}
            {loaded.error ? (
              <div className="rounded-xl border border-[rgb(var(--danger)/0.3)] bg-[rgb(var(--danger)/0.05)] p-4 text-sm text-danger">
                That conversation could not be loaded. It may have been deleted.
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="sticky bottom-0 z-10 mt-10 bg-gradient-to-t from-canvas via-canvas pb-2 pt-8">
            <AskComposer
              message={message}
              onMessageChange={setMessage}
              onSubmit={() => void submit()}
              loading={busy}
              prominent={false}
            />
          </div>
        </div>
      )}

      {submitError ? (
        <p className="mt-3 text-center text-xs text-danger" role="alert">
          {submitError}
        </p>
      ) : null}
    </div>
  );
}
