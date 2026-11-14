import { CircleHelp, MessageSquareReply, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Questionnaire as Form,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireChoiceTitle,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@lictory/ui/ai/questionnaire";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@lictory/ui/ai/trace";
import type {
  AskQuestionsInput,
  AskQuestionsOutput,
} from "@lictory/core/intelligence/chat/shared";
import { cn } from "@lictory/core/lib/utils";

// Clarifying questions Litto asks before it acts (Questionnaire, shadcn/ui):
// one question at a time, letters pick an answer, Enter continues, optional
// questions can be skipped, and "Answer in the chat instead" dismisses the
// whole set. Nothing is sent until the last question is submitted.
export function Questionnaire({
  input,
  onSubmit,
}: {
  input: AskQuestionsInput;
  onSubmit: (output: AskQuestionsOutput) => Promise<void>;
}) {
  const questions = input.questions;
  const titleId = useId();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const skipped = useRef(new Set<string>());
  const [sent, setSent] = useState(false);
  // A single choice answers its question: move on after a beat, so the
  // selection registers (not when a typed answer may follow it).
  const [active, setActive] = useState(questions[0]!.id);
  const advance = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(advance.current), []);
  const items = questions.map((q) => ({
    name: q.id,
    required: q.required,
    choices: q.options.map((o) => ({ value: o.value })),
  }));
  const last = questions.length - 1;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sent) return;
    const data = new FormData(event.currentTarget);
    setSent(true);
    // Still on screen once sent: it was not applied, so the answers stay and
    // can be submitted again.
    void onSubmit({
      answers: questions.map((q) => {
        const known = new Set(q.options.map((o) => o.value));
        const values = data
          .getAll(q.id)
          .filter((v): v is string => typeof v === "string" && known.has(v));
        const text = (texts[q.id] ?? "").trim() || null;
        return {
          id: q.id,
          values,
          labels: values.map(
            (v) => q.options.find((o) => o.value === v)?.label ?? v,
          ),
          text,
          skipped: skipped.current.has(q.id) || (!values.length && !text),
        };
      }),
    }).then(() => setSent(false));
  };

  return (
    <section
      role="group"
      data-litto-waiting
      tabIndex={-1}
      aria-labelledby={titleId}
      className="activity-enter min-w-0 overflow-hidden rounded-2xl border bg-card wrap-anywhere shadow-[0_10px_30px_-18px_oklch(0_0_0/0.3)]"
    >
      <Form
        items={items}
        item={active}
        onItemChange={(next) => {
          clearTimeout(advance.current);
          setActive(next);
        }}
        shortcuts="letters"
        onSubmit={submit}
        className="gap-0"
      >
        <header className="flex items-center gap-2 border-b px-4 py-2.5">
          <CircleHelp className="size-4 shrink-0 text-primary" aria-hidden />
          <p id={titleId} className="min-w-0 flex-1 text-[13px] font-medium">
            {input.title}
          </p>
          {questions.length > 1 && <QuestionnaireProgress />}
          <button
            type="button"
            disabled={sent}
            onClick={() => {
              setSent(true);
              void onSubmit({ dismissed: true }).then(() => setSent(false));
            }}
            aria-label="Dismiss questions"
            title="Dismiss and answer in the chat instead"
            className="-mr-2 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground touch:size-11"
          >
            <X className="size-3.5" />
          </button>
        </header>
        <div className="px-4 pt-4 pb-3">
          {questions.map((q, index) => (
            <QuestionnaireItem
              key={q.id}
              name={q.id}
              required={q.required}
              multiple={q.kind === "multiple"}
              onStatusChange={(status) => {
                if (status === "skipped") skipped.current.add(q.id);
                else skipped.current.delete(q.id);
              }}
            >
              <QuestionnaireTitle>
                {q.prompt}
                {!q.required && (
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    Optional
                  </span>
                )}
              </QuestionnaireTitle>
              {q.description && (
                <QuestionnaireDescription>
                  {q.description}
                </QuestionnaireDescription>
              )}
              {q.kind !== "text" && q.options.length > 0 && (
                <QuestionnaireChoices>
                  {q.options.map((option) => (
                    <QuestionnaireChoice
                      key={option.value}
                      value={option.value}
                      onChange={() => {
                        const next = questions[index + 1];
                        if (q.kind !== "single" || q.allowOther || !next)
                          return;
                        clearTimeout(advance.current);
                        advance.current = setTimeout(
                          () => setActive(next.id),
                          320,
                        );
                      }}
                    >
                      <QuestionnaireChoiceTitle>
                        {option.label}
                      </QuestionnaireChoiceTitle>
                      {option.description && (
                        <QuestionnaireChoiceDescription>
                          {option.description}
                        </QuestionnaireChoiceDescription>
                      )}
                    </QuestionnaireChoice>
                  ))}
                </QuestionnaireChoices>
              )}
              {(q.kind === "text" || q.allowOther) && (
                <QuestionnaireInput
                  multiline={q.kind === "text"}
                  value={texts[q.id] ?? ""}
                  onChange={(e) =>
                    setTexts((all) => ({ ...all, [q.id]: e.target.value }))
                  }
                  aria-label={
                    q.kind === "text"
                      ? q.prompt
                      : `Another answer to: ${q.prompt}`
                  }
                  placeholder={
                    q.kind === "text" ? "Type your answer…" : "Something else…"
                  }
                />
              )}
              <QuestionnaireError>
                {q.kind === "text"
                  ? "Write an answer to continue."
                  : "Choose an answer to continue."}
              </QuestionnaireError>
              <span className="sr-only">
                Question {index + 1} of {questions.length}
              </span>
            </QuestionnaireItem>
          ))}
        </div>
        <QuestionnaireActions className="border-t bg-muted/30 px-4 py-2.5">
          <QuestionnairePrevious />
          <span className="mr-auto hidden text-[11px] text-muted-foreground sm:inline">
            Letters choose · Enter continues
          </span>
          <QuestionnaireSkip />
          <QuestionnaireNext />
          <QuestionnaireSubmit disabled={sent}>
            {last > 0 ? "Submit answers" : "Submit"}
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Form>
    </section>
  );
}

// What was answered, kept in the transcript as one line that opens.
export function AnsweredQuestions({
  input,
  output,
}: {
  input: AskQuestionsInput;
  output: AskQuestionsOutput;
}) {
  if ("dismissed" in output)
    return (
      <TraceLine>
        <TraceIcon>
          <CircleHelp />
        </TraceIcon>
        <TraceTitle>Questions dismissed: {input.title}</TraceTitle>
      </TraceLine>
    );
  return (
    <TraceCollapsible defaultOpen>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon>
            <MessageSquareReply />
          </TraceIcon>
          <TraceTitle>You answered: {input.title}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <dl className="space-y-1.5 text-[12.5px]">
          {output.answers.map((answer) => {
            const question = input.questions.find((q) => q.id === answer.id);
            const value = [...answer.labels, answer.text]
              .filter(Boolean)
              .join(", ");
            return (
              <div key={answer.id}>
                <dt>{question?.prompt ?? answer.id}</dt>
                <dd
                  className={cn(
                    "font-medium whitespace-pre-wrap text-foreground",
                    answer.skipped &&
                      "font-normal text-muted-foreground italic",
                  )}
                >
                  {answer.skipped ? "Skipped" : value}
                </dd>
              </div>
            );
          })}
        </dl>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
