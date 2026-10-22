"use client";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Loader2, Mic, Square, ShieldCheck } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cn } from "@lictory/core/lib/utils";
import {
  applyEdit,
  begin,
  type Change,
  type Dictation,
  diff,
  discard,
  mapCaret,
  write,
} from "@lictory/platform/components/intelligence/chat/dictation-text";
import { dictationSupported, useDictation } from "@lictory/platform/components/intelligence/chat/use-dictation";

// Browser capabilities never change during a session.
const noSubscribe = () => () => undefined;
const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export type ComposerHandle = {
  focus: () => void;
  fill: (text: string) => void;
};

// Prompt box: grows with its content, Enter sends, Shift+Enter breaks the
// line, and the send button turns into Stop while an answer streams. With an
// `organizationId`, the mic button dictates: words stream in live at the caret
// where dictation started, and the person can keep editing while they talk.
export const Composer = forwardRef<
  ComposerHandle,
  {
    onSend: (text: string) => void;
    onStop?: () => void;
    busy?: boolean;
    disabled?: boolean;
    placeholder?: string;
    context?: string;
    autoFocus?: boolean;
    organizationId?: string;
  }
>(function Composer(
  {
    onSend,
    onStop,
    busy,
    disabled,
    placeholder,
    context,
    autoFocus,
    organizationId,
  },
  ref,
) {
  const [value, setValueState] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const current = useRef("");
  const setValue = (next: string) => {
    current.current = next;
    setValueState(next);
  };

  // Live dictation. The dictated range follows edits made around it.
  const dictation = useRef<Dictation | null>(null);
  const replaced = useRef("");
  const caret = useRef<[number, number] | null>(null);
  // Our own rewrites keep the person's caret where it logically was.
  const rewrite = (next: string, change: Change) => {
    const el = area.current;
    if (el && document.activeElement === el)
      caret.current = [
        mapCaret(el.selectionStart, change),
        mapCaret(el.selectionEnd, change),
      ];
    setValue(next);
  };
  const voice = useDictation(organizationId, {
    onText: (spoken, final) => {
      const d = dictation.current;
      if (!d) return;
      const result = write(current.current, d, spoken, final);
      if (!result) return;
      dictation.current = result.dictation;
      rewrite(result.value, result.change);
    },
    onEnd: (reason) => {
      const d = dictation.current;
      dictation.current = null;
      if (!d) return;
      // Errors keep dictated words; only an empty attempt is undone.
      if (reason !== "cancelled" && d.range.start !== d.range.end) return;
      const removed = discard(current.current, d);
      const value = removed?.value ?? current.current;
      const start = d.range.start;
      if (d.pristine && replaced.current) {
        const restored =
          value.slice(0, start) + replaced.current + value.slice(start);
        rewrite(restored, {
          at: d.range.start,
          removed: d.range.end - d.range.start,
          inserted: replaced.current.length,
        });
      } else if (removed) rewrite(removed.value, removed.change);
    },
  });
  const supported = useSyncExternalStore(
    noSubscribe,
    dictationSupported,
    () => false,
  );
  const canDictate = !!organizationId && supported;
  const dictating = voice.state !== "idle";
  const shortcut = useSyncExternalStore(
    noSubscribe,
    () => (isMac() ? "⌘⇧Space" : "Ctrl+Shift+Space"),
    () => "Ctrl+Shift+Space",
  );

  const toggleDictation = () => {
    if (!canDictate) return;
    if (voice.state === "connecting") return voice.cancel();
    if (dictating) return voice.stop();
    const el = area.current;
    const from = el?.selectionStart ?? current.current.length;
    const to = el?.selectionEnd ?? from;
    // Dictating over a selection replaces it; cancelling restores it.
    replaced.current = current.current.slice(from, to);
    if (to > from)
      rewrite(current.current.slice(0, from) + current.current.slice(to), {
        at: from,
        removed: to - from,
        inserted: 0,
      });
    dictation.current = begin(from);
    el?.focus();
    void voice.start();
  };

  const stopDictation = voice.stop;
  useEffect(() => {
    if (disabled && dictating) stopDictation();
  }, [disabled, dictating, stopDictation]);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    fill: (text) => {
      if (dictating) voice.cancel();
      setValue(text);
      requestAnimationFrame(() => {
        const el = area.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(text.length, text.length);
      });
    },
  }));
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    if (caret.current) {
      el.setSelectionRange(...caret.current);
      caret.current = null;
    }
  }, [value]);
  // Re-measure when the width changes (an opening panel, a resized window):
  // the same text wraps differently.
  useEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      el.style.height = "0px";
      el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const canSend = value.trim().length > 0 && !disabled && !busy && !dictating;
  const send = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className={cn(
        "group/composer relative rounded-2xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04),0_8px_24px_-12px_oklch(0_0_0/0.12)] transition-[border-color,box-shadow] duration-200",
        "focus-within:border-primary/40 focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_10%,transparent),0_8px_24px_-12px_oklch(0_0_0/0.16)]",
        disabled && "opacity-70",
      )}
    >
      <textarea
        ref={area}
        value={value}
        rows={1}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          if (dictation.current)
            dictation.current = applyEdit(
              dictation.current,
              diff(current.current, next),
            );
          if (voice.error) voice.clearError();
          setValue(next);
        }}
        onKeyDown={(e) => {
          if (
            e.code === "Space" &&
            e.shiftKey &&
            (e.metaKey || e.ctrlKey) &&
            canDictate
          ) {
            e.preventDefault();
            toggleDictation();
            return;
          }
          if (e.key === "Escape" && dictating) {
            e.preventDefault();
            voice.cancel();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={placeholder ?? "Ask Lictory or describe what to do…"}
        aria-label="Message Lictory Intelligence"
        className="block max-h-60 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-6 outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5">
        {voice.error ? (
          <span
            role="alert"
            className="min-w-0 truncate text-[11px] text-destructive"
            title={voice.error}
          >
            {voice.error}
          </span>
        ) : dictating ? (
          <span
            aria-live="polite"
            className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-red-500/10 px-2 text-[11px] text-red-700 dark:text-red-300"
          >
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-pulse"
            />
            <span className="truncate">
              {voice.state === "connecting"
                ? "Starting microphone…"
                : voice.state === "finishing"
                  ? "Finishing transcript…"
                  : "Listening · Esc to cancel"}
            </span>
          </span>
        ) : (
          context && (
            <span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-muted px-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{context}</span>
            </span>
          )
        )}
        <span className="ml-auto hidden text-[11px] text-muted-foreground/70 sm:inline">
          <kbd className="font-sans">⏎</kbd> to send ·{" "}
          <kbd className="font-sans">⇧⏎</kbd> new line
        </span>
        {canDictate && (
          <button
            type="button"
            onClick={toggleDictation}
            disabled={disabled && !dictating}
            aria-pressed={dictating}
            aria-label={dictating ? "Stop dictation" : `Dictate (${shortcut})`}
            title={
              dictating
                ? `Stop dictation (${shortcut})`
                : `Dictate (${shortcut})`
            }
            className={cn(
              "relative grid size-8 shrink-0 place-items-center rounded-full transition-[background-color,color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
              dictating
                ? "bg-red-500/12 text-red-600 dark:text-red-400"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {voice.state === "listening" && (
              <span
                aria-hidden
                className="absolute inset-0 rounded-full ring-2 ring-red-500/30 motion-safe:animate-ping"
              />
            )}
            {voice.state === "connecting" || voice.state === "finishing" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Mic className="size-4" aria-hidden />
            )}
          </button>
        )}
        <button
          type={busy ? "button" : "submit"}
          onClick={busy ? onStop : undefined}
          disabled={!busy && !canSend}
          aria-label={busy ? "Stop generating" : "Send message"}
          title={busy ? "Stop generating" : "Send"}
          className={cn(
            "relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full transition-[background-color,transform,opacity] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-95",
            busy || canSend
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground",
            !busy && !canSend && "cursor-not-allowed",
          )}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {busy ? (
              <motion.span
                key="stop"
                initial={{ scale: 0.4, opacity: 0, filter: "blur(2px)" }}
                animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
                exit={{ scale: 0.4, opacity: 0, filter: "blur(2px)" }}
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              >
                <Square className="size-3 fill-current" aria-hidden />
              </motion.span>
            ) : (
              <motion.span
                key="send"
                initial={{ scale: 0.4, opacity: 0, filter: "blur(2px)" }}
                animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
                exit={{ scale: 0.4, opacity: 0, filter: "blur(2px)" }}
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              >
                <ArrowUp className="size-4" strokeWidth={2.25} aria-hidden />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </form>
  );
});
