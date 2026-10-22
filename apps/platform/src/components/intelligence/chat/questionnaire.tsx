"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleHelp, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@lictory/ui/button";
import type {
  AskQuestionsInput,
  AskQuestionsOutput,
  Question,
} from "@lictory/core/intelligence/chat/shared";
import { cn } from "@lictory/core/lib/utils";

type Answer = { values: string[]; text: string; skipped: boolean };
const empty: Answer = { values: [], text: "", skipped: false };
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// The step counter rolls like an odometer in the direction of travel.
const roll = {
  enter: (direction: number) => ({ y: `${direction * 100}%` }),
  center: { y: "0%" },
  exit: (direction: number) => ({ y: `${direction * -100}%` }),
};

function answered(q: Question, a: Answer) {
  return a.values.length > 0 || a.text.trim().length > 0;
}

// Multi-step clarification asked by the assistant: single choice, multiple
// choice and free text, one question at a time, with letter shortcuts.
export function Questionnaire({
  input,
  onSubmit,
}: {
  input: AskQuestionsInput;
  onSubmit: (output: AskQuestionsOutput) => void;
}) {
  const questions = input.questions;
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const advance = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(advance.current), []);
  const baseId = useId();
  const q = questions[step]!;
  const a = answers[q.id] ?? empty;
  const last = step === questions.length - 1;

  const set = (patch: Partial<Answer>) => {
    setError(null);
    setAnswers((all) => ({
      ...all,
      [q.id]: { ...(all[q.id] ?? empty), ...patch, skipped: false },
    }));
  };
  const toggle = (value: string) => {
    if (q.kind === "multiple")
      set({
        values: a.values.includes(value)
          ? a.values.filter((v) => v !== value)
          : [...a.values, value],
      });
    else {
      set({ values: [value], text: "" });
      // A single choice answers the question: move on after a beat, so the
      // selection registers. The last question still waits for Submit.
      if (!last) {
        clearTimeout(advance.current);
        advance.current = setTimeout(() => go(step + 1), 320);
      }
    }
  };

  const finish = (all: Record<string, Answer>) =>
    onSubmit({
      answers: questions.map((question) => {
        const x = all[question.id] ?? { ...empty, skipped: true };
        return {
          id: question.id,
          values: x.values,
          labels: x.values.map(
            (v) => question.options.find((o) => o.value === v)?.label ?? v,
          ),
          text: x.text.trim() || null,
          skipped: x.skipped || !answered(question, x),
        };
      }),
    });

  const go = (to: number) => {
    clearTimeout(advance.current);
    setDirection(to > step ? 1 : -1);
    setStep(to);
    setError(null);
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>("[data-autofocus]")
        ?.focus({ preventScroll: true }),
    );
  };
  const next = () => {
    if (q.required && !answered(q, a)) {
      setError(
        q.kind === "text"
          ? "Write an answer to continue."
          : "Choose an answer to continue.",
      );
      return;
    }
    if (last) finish(answers);
    else go(step + 1);
  };
  const skip = () => {
    const all = { ...answers, [q.id]: { ...empty, skipped: true } };
    setAnswers(all);
    if (last) finish(all);
    else go(step + 1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const typing =
      e.target instanceof HTMLInputElement && e.target.type === "text";
    const isTextArea = e.target instanceof HTMLTextAreaElement;
    if (e.key === "Enter" && !e.shiftKey && !isTextArea) {
      e.preventDefault();
      next();
      return;
    }
    if (typing || isTextArea || e.metaKey || e.ctrlKey || e.altKey) return;
    const index = letters.indexOf(e.key.toUpperCase());
    if (e.key.length === 1 && index >= 0 && index < q.options.length) {
      e.preventDefault();
      toggle(q.options[index]!.value);
    }
  };

  const progress = useMemo(
    () => ((step + (answered(q, a) ? 1 : 0)) / questions.length) * 100,
    [step, q, a, questions.length],
  );

  return (
    <motion.div
      ref={root}
      onKeyDown={onKeyDown}
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", duration: 0.45, bounce: 0.12 }}
      className="overflow-hidden rounded-2xl border bg-card shadow-[0_8px_30px_-12px_oklch(0_0_0/0.18)]"
      role="group"
      aria-labelledby={`${baseId}-title`}
    >
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <CircleHelp className="size-4 text-primary" aria-hidden />
        <p
          id={`${baseId}-title`}
          className="min-w-0 flex-1 truncate text-[13px] font-medium"
        >
          {input.title}
        </p>
        {questions.length > 1 && (
          <span
            className="inline-flex items-center text-[11px] text-muted-foreground tabular-nums"
            aria-label={`Question ${step + 1} of ${questions.length}`}
          >
            <span className="relative inline-grid h-[1.2em] overflow-hidden">
              <AnimatePresence initial={false} custom={direction}>
                <motion.span
                  key={step}
                  custom={direction}
                  variants={roll}
                  initial={reduce ? false : "enter"}
                  animate="center"
                  exit={reduce ? undefined : "exit"}
                  transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                  className="col-start-1 row-start-1 leading-[1.2em]"
                  aria-hidden
                >
                  {step + 1}
                </motion.span>
              </AnimatePresence>
            </span>
            <span aria-hidden>&nbsp;/ {questions.length}</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => onSubmit({ dismissed: true })}
          aria-label="Dismiss questions"
          title="Dismiss — answer in the chat instead"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div
        className="h-0.5 bg-muted"
        role="progressbar"
        aria-label="Questions answered"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className="h-full bg-primary"
          animate={{ width: `${progress}%` }}
          transition={{ type: "spring", duration: 0.5, bounce: 0 }}
        />
      </div>
      <div className="relative px-4 pt-4 pb-3">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.fieldset
            key={q.id}
            custom={direction}
            initial={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, x: 24 * direction, filter: "blur(4px)" }
            }
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, x: -24 * direction, filter: "blur(4px)" }
            }
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${baseId}-error` : undefined}
          >
            <legend className="text-[15px] font-medium">
              {q.prompt}
              {!q.required && (
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  Optional
                </span>
              )}
            </legend>
            {q.description && (
              <p className="mt-1 text-[13px] text-muted-foreground">
                {q.description}
              </p>
            )}
            <div className="mt-3 space-y-1.5">
              {q.kind !== "text" &&
                q.options.map((option, i) => {
                  const selected = a.values.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "group/choice flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-[13px] transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.99]",
                        selected
                          ? "border-primary/50 bg-primary/5"
                          : "hover:border-foreground/15 hover:bg-muted/50",
                      )}
                    >
                      <input
                        type={q.kind === "multiple" ? "checkbox" : "radio"}
                        name={`${baseId}-${q.id}`}
                        value={option.value}
                        checked={selected}
                        onChange={() => toggle(option.value)}
                        data-autofocus={i === 0 ? true : undefined}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 grid size-5 shrink-0 place-items-center border text-[10px] font-semibold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60",
                          q.kind === "multiple" ? "rounded-md" : "rounded-full",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {selected ? (
                          <Check className="size-3" strokeWidth={3} />
                        ) : (
                          letters[i]
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="block text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              {q.kind === "text" ? (
                <textarea
                  value={a.text}
                  onChange={(e) => set({ text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      next();
                    }
                  }}
                  rows={3}
                  data-autofocus
                  aria-label={q.prompt}
                  placeholder="Type your answer…"
                  className="w-full resize-none rounded-xl border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
                />
              ) : (
                q.allowOther && (
                  <input
                    type="text"
                    value={a.text}
                    onChange={(e) =>
                      set({
                        text: e.target.value,
                        values:
                          q.kind === "single" && e.target.value ? [] : a.values,
                      })
                    }
                    aria-label={`Another answer to: ${q.prompt}`}
                    placeholder="Something else…"
                    className="h-10 w-full rounded-xl border bg-background px-3 text-[13px] outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
                  />
                )
              )}
            </div>
            <AnimatePresence>
              {error && (
                <motion.p
                  id={`${baseId}-error`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 text-xs text-destructive"
                  role="alert"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.fieldset>
        </AnimatePresence>
      </div>
      <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2.5">
        {step > 0 && (
          <Button variant="ghost" size="sm" onClick={() => go(step - 1)}>
            Previous
          </Button>
        )}
        <span className="mr-auto hidden text-[11px] text-muted-foreground sm:inline">
          {q.kind !== "text" && q.options.length > 0
            ? `Press ${letters[0]}–${letters[Math.min(q.options.length, 26) - 1]} to choose`
            : "⌘⏎ to continue"}
        </span>
        {!q.required && (
          <Button
            variant="ghost"
            size="sm"
            onClick={skip}
            className="ml-auto sm:ml-0"
          >
            Skip
          </Button>
        )}
        <Button
          size="sm"
          onClick={next}
          className={cn(q.required && "ml-auto sm:ml-0")}
        >
          {last ? "Submit answers" : "Next"}
        </Button>
      </div>
    </motion.div>
  );
}

// Read-only record of what was answered, kept in the transcript.
export function AnsweredQuestions({
  input,
  output,
}: {
  input: AskQuestionsInput;
  output: AskQuestionsOutput;
}) {
  if ("dismissed" in output)
    return (
      <p className="text-[13px] text-muted-foreground italic">
        Questions dismissed: {input.title}
      </p>
    );
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-2.5 text-[13px]">
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <CircleHelp className="size-3.5" aria-hidden /> {input.title}
      </p>
      <dl className="space-y-1">
        {output.answers.map((answer) => {
          const question = input.questions.find((q) => q.id === answer.id);
          const value = [...answer.labels, answer.text]
            .filter(Boolean)
            .join(", ");
          return (
            <div key={answer.id} className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">
                {question?.prompt ?? answer.id}
              </dt>
              <dd
                className={cn(
                  "min-w-0 font-medium",
                  answer.skipped && "font-normal text-muted-foreground italic",
                )}
              >
                {answer.skipped ? "Skipped" : value}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
