import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Loader2, Mic, Square, ShieldCheck } from "lucide-react";
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cn } from "@lictory/core/lib/utils";
import { useOptionalWorkspace } from "@lictory/platform/components/workspace/provider";
import { Kbd } from "@lictory/ui/primitives";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@lictory/ui/ai/input-group";
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
import {
  dictationSupported,
  useDictation,
} from "@lictory/platform/components/intelligence/chat/use-dictation";

// Browser capabilities never change during a session.
const noSubscribe = () => () => undefined;
const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

export type ComposerHandle = {
  focus: () => void;
  fill: (text: string) => void;
  // Adds text after the current draft instead of replacing it.
  append: (text: string) => void;
};

// Prompt Input (AI Elements): grows with its content, Enter sends, Shift+Enter breaks the
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
    // What the next message carries (Prompt Input's attachments row).
    attachments?: ReactNode;
    // Litto waits for an answer above: the field pauses and offers to cancel.
    onCancelWaiting?: () => void;
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
    attachments,
    onCancelWaiting,
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
  // The server offers dictation only when its operator configured it, live
  // (audio straight to OpenAI) or by recorded clips (through this server to
  // the configured provider).
  const ai = useOptionalWorkspace()?.directory.ai;
  const dictationMode = ai?.dictationMode ?? "realtime";
  const voice = useDictation(
    organizationId,
    {
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
    },
    dictationMode,
  );
  const supported = useSyncExternalStore(
    noSubscribe,
    () => dictationSupported(dictationMode),
    () => false,
  );
  const configured = ai?.dictation ?? false;
  const canDictate = !!organizationId && supported && configured;
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

  const put = (text: string) => {
    if (dictating) voice.cancel();
    setValue(text);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  };
  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    append: (text) => {
      const draft = current.current.trimEnd();
      put(draft ? `${draft}\n\n${text}` : text);
    },
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

  // While Litto waits for an answer above, the field gives its room to a
  // compact bar: where the request is, and how to end the turn instead.
  if (disabled && onCancelWaiting && !dictating)
    return (
      <div
        role="status"
        className="flex min-h-12 items-center gap-2 rounded-[1.25rem] bg-card py-1.5 pr-1.5 pl-4 text-[13px] shadow-(--shadow-border)"
      >
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-warning motion-safe:animate-pulse"
        />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          <span className="max-sm:hidden">
            Litto is waiting for your answer
          </span>
          <span className="sm:hidden">Waiting for you</span>
        </span>
        <button
          type="button"
          onClick={() => {
            const request = document.querySelector<HTMLElement>(
              "[data-litto-waiting]",
            );
            request?.scrollIntoView({ block: "center", behavior: "smooth" });
            request?.focus({ preventScroll: true });
          }}
          className="h-8 shrink-0 rounded-full px-3 font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none touch:h-11"
        >
          View request
        </button>
        <button
          type="button"
          onClick={onCancelWaiting}
          className="h-8 shrink-0 rounded-full px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none touch:h-11"
        >
          Cancel this turn
        </button>
      </div>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <InputGroup>
        {attachments && (
          <InputGroupAddon align="block-start" className="flex-wrap gap-1.5">
            {attachments}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
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
            // Esc stops an answer in progress, as the Stop button does.
            if (e.key === "Escape" && busy && onStop) {
              e.preventDefault();
              onStop();
              return;
            }
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder ?? "Ask Litto or describe what to do…"}
          aria-label="Message Litto"
        />
        <InputGroupAddon align="block-end">
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
              <span
                title="Litto uses your permissions and asks before decisions such as approvals and merges."
                className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-muted px-2 text-[11px] text-muted-foreground max-sm:hidden"
              >
                <ShieldCheck className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{context}</span>
              </span>
            )
          )}
          <span
            className={cn(
              "ml-auto hidden shrink-0 items-center gap-3 text-[11px] text-muted-foreground transition-opacity duration-150 sm:inline-flex",
              value.trim() && !busy ? "opacity-100" : "opacity-0",
            )}
            aria-hidden
          >
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd> send
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>⇧↵</Kbd> new line
            </span>
          </span>
          {canDictate && (
            <InputGroupButton
              onClick={toggleDictation}
              disabled={disabled && !dictating}
              aria-pressed={dictating}
              aria-label={
                dictating ? "Stop dictation" : `Dictate (${shortcut})`
              }
              title={
                dictating
                  ? `Stop dictation (${shortcut})`
                  : `Dictate (${shortcut})`
              }
              className={cn(
                "ml-auto sm:ml-0",
                dictating &&
                  "bg-red-500/12 text-red-600 hover:bg-red-500/15 hover:text-red-600 dark:text-red-400",
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
            </InputGroupButton>
          )}
          <InputGroupButton
            type={busy ? "button" : "submit"}
            onClick={busy ? onStop : undefined}
            disabled={!busy && !canSend}
            aria-label={busy ? "Stop generating" : "Send message"}
            title={busy ? "Stop generating (Esc)" : "Send"}
            variant={busy || canSend ? "primary" : "muted"}
            className={cn(!canDictate && "ml-auto sm:ml-0")}
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
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
});
