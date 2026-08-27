"use client";

import type { AskQuery, AskSourceKind } from "@lictory/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import {
  RevealItem,
  RevealStagger,
  ScanBeam,
} from "@/components/ai/primitives";
import { Markdown } from "@/components/notes/markdown";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  FileText,
  ImageIcon,
  Network,
  Sparkles,
  StickyNote,
} from "@/components/ui/icons";
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

function AskComposer({
  question,
  onQuestionChange,
  onSubmit,
  loading,
  prominent,
}: {
  question: string;
  onQuestionChange: (value: string) => void;
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

  const resize = (element: HTMLTextAreaElement) => {
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  };

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        if (!loading && question.trim().length >= 2) onSubmit();
      }}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-canvas-raised shadow-[0_24px_80px_-36px_rgb(var(--ember)/0.7)] transition-[border-color,box-shadow,transform] focus-within:border-[rgb(var(--ember)/0.5)] focus-within:shadow-[0_26px_90px_-34px_rgb(var(--ember)/0.9)]",
        prominent ? "border-hairline-strong" : "border-hairline",
      )}
    >
      {loading ? <ScanBeam /> : null}
      <div className="flex items-end gap-2 p-2.5 pl-4">
        <Sparkles className="mb-2.5 size-4 shrink-0 text-ember" />
        <textarea
          ref={textareaRef}
          autoFocus={prominent}
          value={question}
          onChange={(event) => {
            onQuestionChange(event.target.value);
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
          rows={1}
          maxLength={1_000}
          placeholder="Ask anything you remember…"
          aria-label="Ask your notes"
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-[0.9375rem] leading-6 text-foreground outline-none placeholder:text-subtle"
        />
        <Button
          type="submit"
          size="icon"
          variant="primary"
          disabled={loading || question.trim().length < 2}
          aria-label="Ask"
          className="shrink-0 rounded-xl"
        >
          <ArrowRight />
        </Button>
      </div>
      <div className="flex items-center justify-between border-t border-hairline px-4 py-2 text-[0.6875rem] text-subtle">
        <span>Searches every part of every note</span>
        <span className="hidden sm:inline">
          Enter to ask · Shift + Enter for a new line
        </span>
      </div>
    </form>
  );
}

function ThinkingState() {
  const label = "Reading across your notes…";
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[rgb(var(--ember)/0.25)] bg-[rgb(var(--ember)/0.035)] px-5 py-6"
      aria-live="polite"
    >
      <ScanBeam />
      <div className="relative flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl border border-[rgb(var(--ember)/0.25)] bg-[rgb(var(--ember)/0.1)] text-ember">
          <Sparkles className="size-4" />
        </span>
        <div>
          <span className="t-shimmer text-sm font-medium" data-text={label}>
            {label}
          </span>
          <p className="mt-1 text-xs text-subtle">
            Checking writing, transcripts, images, files and context
          </p>
        </div>
      </div>
    </div>
  );
}

function Answer({ query }: { query: AskQuery }) {
  return (
    <RevealStagger className="space-y-8">
      <RevealItem>
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-strong px-4 py-3 text-sm leading-6 text-foreground">
            {query.question}
          </p>
        </div>
      </RevealItem>

      <RevealItem>
        <div className="grid gap-4 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
          <span className="flex size-10 items-center justify-center rounded-xl border border-[rgb(var(--ember)/0.25)] bg-[rgb(var(--ember)/0.08)] text-ember shadow-[0_0_24px_rgb(var(--ember)/0.1)]">
            <Sparkles className="size-[1.125rem]" />
          </span>
          <Markdown className="min-w-0 pt-1 text-[0.9375rem] leading-7">
            {query.answerMarkdown}
          </Markdown>
        </div>
      </RevealItem>

      {query.citations.length > 0 ? (
        <RevealItem className="sm:pl-14">
          <div className="border-t border-hairline pt-5">
            <p className="mb-3 text-xs font-medium text-subtle">
              Sources from your notes
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {query.citations.map((citation, index) => (
                <Link
                  key={citation.noteId}
                  href={`/app/notes/${citation.noteId}`}
                  className="group min-w-0 rounded-xl border border-hairline bg-surface p-3.5 transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-hairline-strong hover:bg-surface-strong active:translate-y-0"
                >
                  <div className="mb-2 flex items-start gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--ember)/0.1)] text-[0.6875rem] font-semibold text-ember">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {citation.title ?? "Untitled note"}
                    </span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-subtle transition-colors group-hover:text-ember" />
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
        </RevealItem>
      ) : null}
    </RevealStagger>
  );
}

export function AskExperience({
  initialQueryId,
}: {
  initialQueryId: string | null;
}) {
  const api = useApi();
  const router = useRouter();
  const loaded = useResource(
    initialQueryId ? `ask:${initialQueryId}` : null,
    () => api.getAskQuery(initialQueryId ?? ""),
  );
  const [question, setQuestion] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<{
    routeId: string | null;
    created: AskQuery | null;
  }>({ routeId: initialQueryId, created: null });

  if (view.routeId !== initialQueryId) {
    setView({
      routeId: initialQueryId,
      created: view.created?.id === initialQueryId ? view.created : null,
    });
  }

  const query = view.created ?? loaded.data?.query ?? null;
  const waitingForHistory = Boolean(initialQueryId) && !query && loaded.loading;

  const submit = async () => {
    const value = question.trim();
    if (value.length < 2 || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.createAskQuery({ question: value });
      setView({ routeId: result.query.id, created: result.query });
      setQuestion("");
      router.replace(`/app/ask?id=${encodeURIComponent(result.query.id)}`, {
        scroll: false,
      });
      window.dispatchEvent(new Event("lictory:ask-history-changed"));
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Could not search your notes",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const empty = !query && !waitingForHistory && !submitting;

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
              Find an idea across writing, a phrase from a voice memo, a detail
              inside a file, or something seen in a photo.
            </p>
          </div>

          <AskComposer
            question={question}
            onQuestionChange={setQuestion}
            onSubmit={() => void submit()}
            loading={submitting}
            prominent
          />

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => {
                  setQuestion(starter);
                  window.dispatchEvent(new Event("lictory:focus-ask"));
                }}
                className="rounded-full border border-hairline px-3 py-2 text-xs text-subtle transition-[background-color,color,border-color] hover:border-hairline-strong hover:bg-surface hover:text-muted"
              >
                {starter}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="mb-8 flex items-center gap-2 text-xs text-subtle">
            <Sparkles className="size-3.5 text-ember" />
            Ask your memory
          </div>

          <div className="flex-1">
            {query ? <Answer query={query} /> : null}
            {submitting || waitingForHistory ? <ThinkingState /> : null}
            {loaded.error ? (
              <div className="rounded-xl border border-[rgb(var(--danger)/0.3)] bg-[rgb(var(--danger)/0.05)] p-4 text-sm text-danger">
                That question could not be loaded. It may have been deleted.
              </div>
            ) : null}
          </div>

          <div className="sticky bottom-0 z-10 mt-10 bg-gradient-to-t from-canvas via-canvas pb-2 pt-8">
            <AskComposer
              question={question}
              onQuestionChange={setQuestion}
              onSubmit={() => void submit()}
              loading={submitting}
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
