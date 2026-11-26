import { Button } from "@ui-sdk/react/button";
import { Checkbox, CheckboxGroup } from "@ui-sdk/react/checkbox";
import { Input } from "@ui-sdk/react/input";
import { Progress } from "@ui-sdk/react/progress";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { Textarea } from "@ui-sdk/react/textarea";
import { Check } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

import { cn } from "@lictory/core/lib/utils";

// Questionnaire: one question at a time, answered with ui-sdk radios,
// checkboxes and fields. Letters pick an answer, Enter continues, optional
// questions can be skipped, and a question that still needs an answer says
// so. The answers submit with the form; the host owns what happens to them.

export type QuestionnaireItemStatus = "unanswered" | "answered" | "skipped";
export type QuestionnaireItemDefinition = {
  name: string;
  required?: boolean;
  choices?: readonly { value: string }[];
};

type Answer = {
  values: string[];
  // Whether the typed answer holds any text.
  filled: boolean;
  skipped: boolean;
  // Asked to continue at least once: only then is a missing answer an error.
  touched: boolean;
};
const blank: Answer = {
  values: [],
  filled: false,
  skipped: false,
  touched: false,
};

const statusOf = (answer: Answer): QuestionnaireItemStatus =>
  answer.skipped
    ? "skipped"
    : answer.values.length > 0 || answer.filled
      ? "answered"
      : "unanswered";
const settled = (answer: Answer, required: boolean) =>
  answer.skipped ? !required : statusOf(answer) === "answered";

type Root = {
  items: readonly QuestionnaireItemDefinition[];
  active: string | undefined;
  index: number;
  answers: Record<string, Answer>;
  change: (name: string, next: (answer: Answer) => Answer) => void;
  shortcut: (name: string, value: string) => string | undefined;
  // How each question checks a choice, for its letter.
  pickers: RefObject<Map<string, (value: string) => void>>;
  previous: () => void;
  next: () => void;
  skip: () => void;
};
const RootContext = createContext<Root | null>(null);
function useRoot() {
  const root = useContext(RootContext);
  if (!root) throw new Error("Questionnaire parts must be in a Questionnaire.");
  return root;
}

type Item = {
  name: string;
  multiple: boolean;
  invalid: boolean;
  answer: Answer;
  titleId: string;
  descriptionId: string;
  errorId: string;
  setDescribed: (described: boolean) => void;
};
const ItemContext = createContext<Item | null>(null);
function useItem() {
  const item = useContext(ItemContext);
  if (!item)
    throw new Error("Questionnaire parts must be in a QuestionnaireItem.");
  return item;
}

const action =
  "inline-flex h-8 touch:h-11 touch:px-4 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-150 ease-out outline-none select-none focus-ring enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${action} bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.12)] hover:bg-(--primary-hover)`;
const quiet = `${action} text-muted-foreground hover:bg-muted hover:text-foreground`;

const typing = (target: Element) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

// The first answer of the shown question, for a person who must still give
// one; the question itself otherwise, so its text is read first.
type FocusTarget = "question" | "answer";
function focusQuestion(form: HTMLFormElement | null, target: FocusTarget) {
  const question = form?.querySelector<HTMLElement>("fieldset[data-active]");
  const answer =
    target === "answer"
      ? (question?.querySelector<HTMLElement>(
          '[role="radio"][tabindex="0"], [role="checkbox"], input:not([aria-hidden]), textarea',
        ) ?? question?.querySelector<HTMLElement>('[role="radio"]'))
      : null;
  (answer ?? question)?.focus();
}

export function Questionnaire({
  items,
  item,
  onItemChange,
  onSkip,
  shortcuts,
  onSubmit,
  onKeyDown,
  className,
  children,
  ...props
}: Omit<ComponentProps<"form">, "onSubmit"> & {
  // Every question in order, with the choices its letters pick.
  items: readonly QuestionnaireItemDefinition[];
  // The question shown. Pass it with `onItemChange` to control it.
  item?: string;
  onItemChange?: (item: string) => void;
  // A question was skipped: what the host kept for it (typed text) goes too.
  onSkip?: (item: string) => void;
  shortcuts?: "letters";
  // Runs once every question is answered or skipped.
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [own, setOwn] = useState(items[0]?.name);
  const active = item ?? own;
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const index = Math.max(
    0,
    items.findIndex((i) => i.name === active),
  );
  const current = items[index];
  const last = index === items.length - 1;

  const change: Root["change"] = (name, next) =>
    setAnswers((all) => ({ ...all, [name]: next(all[name] ?? blank) }));
  const complete = (definition: QuestionnaireItemDefinition) =>
    settled(answers[definition.name] ?? blank, !!definition.required);

  const arriving = useRef<FocusTarget>("question");
  const shown = useRef(active);
  useEffect(() => {
    if (shown.current === active) return;
    shown.current = active;
    focusQuestion(form.current, arriving.current);
    arriving.current = "question";
  }, [active]);
  const go = (name: string, target: FocusTarget = "question") => {
    if (name === active) return focusQuestion(form.current, target);
    arriving.current = target;
    setOwn(name);
    onItemChange?.(name);
  };
  const refuse = (definition: QuestionnaireItemDefinition) => {
    change(definition.name, (answer) => ({ ...answer, touched: true }));
    go(definition.name, "answer");
  };

  const previous = () => {
    const before = items[index - 1];
    if (before) go(before.name);
  };
  const next = () => {
    if (!current) return;
    if (!complete(current)) return refuse(current);
    const after = items[index + 1];
    if (after) go(after.name);
  };
  // Enter: the next question, or the answers once this is the last one.
  const proceed = () => {
    if (!current) return;
    if (!complete(current)) return refuse(current);
    if (last) form.current?.requestSubmit();
    else next();
  };
  const skip = () => {
    if (!current || current.required) return;
    // Committed first: the form reads the cleared answer when it submits.
    flushSync(() => {
      change(current.name, (answer) => ({
        ...answer,
        values: [],
        filled: false,
        skipped: true,
        touched: false,
      }));
      onSkip?.(current.name);
    });
    const after = items[index + 1];
    if (after) go(after.name);
    else form.current?.requestSubmit();
  };

  const letters = (name: string) =>
    (items.find((i) => i.name === name)?.choices ?? []).slice(0, 26);
  const pickers = useRef(new Map<string, (value: string) => void>());
  const shortcut: Root["shortcut"] = (name, value) => {
    if (!shortcuts) return undefined;
    const at = letters(name).findIndex((choice) => choice.value === value);
    return at < 0 ? undefined : String.fromCharCode(65 + at);
  };

  const keyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    onKeyDown?.(event);
    const target = event.target;
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      !(target instanceof Element) ||
      event.altKey
    )
      return;
    if (event.metaKey || event.ctrlKey) {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (!event.repeat) proceed();
      return;
    }
    const choice = target.closest("[data-questionnaire-choice]");
    if (event.key === "Enter") {
      // A line break in a long answer; a button presses itself.
      if (target instanceof HTMLTextAreaElement) return;
      if (!choice && !(target instanceof HTMLInputElement)) return;
      event.preventDefault();
      const given = choice
        ? choice.getAttribute("aria-checked") === "true"
        : (target as HTMLInputElement).value.trim().length > 0;
      if (given && !event.repeat) proceed();
      return;
    }
    if (typing(target)) return;
    // Radios move between themselves with the arrow keys.
    if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      target.getAttribute("role") !== "radio"
    ) {
      event.preventDefault();
      if (event.repeat) return;
      if (event.key === "ArrowLeft") previous();
      else if (
        current &&
        statusOf(answers[current.name] ?? blank) !== "unanswered"
      )
        next();
      return;
    }
    if (!shortcuts || !current || !/^[a-z]$/i.test(event.key)) return;
    const letter = event.key.toUpperCase();
    const picked = letters(current.name)[letter.charCodeAt(0) - 65];
    if (!picked) return;
    event.preventDefault();
    if (event.repeat) return;
    form.current
      ?.querySelector<HTMLElement>(
        `fieldset[data-active] [data-questionnaire-shortcut="${letter}"]`,
      )
      ?.focus();
    pickers.current.get(current.name)?.(picked.value);
  };

  return (
    <RootContext.Provider
      value={{
        items,
        active,
        index,
        answers,
        change,
        shortcut,
        pickers,
        previous,
        next,
        skip,
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keys bubble from the question's own controls: a letter picks an answer, Enter continues */}
      <form
        ref={form}
        noValidate
        data-slot="questionnaire"
        className={cn("flex w-full min-w-0 flex-col gap-4", className)}
        onKeyDown={keyDown}
        onSubmit={(event) => {
          const missing = items.find((definition) => !complete(definition));
          if (missing) {
            event.preventDefault();
            refuse(missing);
            return;
          }
          onSubmit?.(event);
        }}
        {...props}
      >
        {children}
      </form>
    </RootContext.Provider>
  );
}

export function QuestionnaireProgress({ className }: { className?: string }) {
  const { index, items } = useRoot();
  if (items.length < 2) return null;
  const label = `Question ${index + 1} of ${items.length}`;
  return (
    <Progress
      value={index + 1}
      min={1}
      max={items.length}
      getValueLabel={() => label}
      aria-label="Questionnaire progress"
      aria-live="polite"
      className={cn(
        "block w-auto min-w-0 text-[11.5px] font-medium text-muted-foreground tabular-nums",
        className,
      )}
    >
      {label}
    </Progress>
  );
}

export function QuestionnaireItem({
  name,
  required = false,
  multiple = false,
  onStatusChange,
  className,
  children,
  ...props
}: Omit<ComponentProps<"fieldset">, "name"> & {
  name: string;
  required?: boolean;
  // Several choices may be checked.
  multiple?: boolean;
  onStatusChange?: (status: QuestionnaireItemStatus) => void;
}) {
  const root = useRoot();
  const id = useId();
  const [described, setDescribed] = useState(false);
  const answer = root.answers[name] ?? blank;
  const active = root.active === name;
  const invalid = answer.touched && !settled(answer, required);
  const status = statusOf(answer);
  const reported = useRef(status);
  useLayoutEffect(() => {
    if (reported.current === status) return;
    reported.current = status;
    onStatusChange?.(status);
  }, [status, onStatusChange]);
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  return (
    <ItemContext.Provider
      value={{
        name,
        multiple,
        invalid,
        answer,
        titleId: `${id}-title`,
        descriptionId,
        errorId,
        setDescribed,
      }}
    >
      <fieldset
        data-slot="questionnaire-item"
        data-active={active ? "" : undefined}
        hidden={!active}
        inert={!active}
        tabIndex={-1}
        aria-invalid={invalid || undefined}
        aria-describedby={
          [described && descriptionId, invalid && errorId]
            .filter(Boolean)
            .join(" ") || undefined
        }
        className={cn(
          "flex min-w-0 flex-col gap-3 border-0 p-0 outline-none data-active:motion-safe:animate-[questionnaire-in_220ms_cubic-bezier(0.23,1,0.32,1)]",
          className,
        )}
        {...props}
      >
        {children}
      </fieldset>
    </ItemContext.Provider>
  );
}

export function QuestionnaireTitle({
  className,
  ...props
}: ComponentProps<"legend">) {
  const { titleId } = useItem();
  return (
    <legend
      id={titleId}
      data-slot="questionnaire-title"
      className={cn(
        "float-left w-full text-[15px] leading-snug font-medium text-pretty",
        className,
      )}
      {...props}
    />
  );
}

export function QuestionnaireDescription({
  className,
  ...props
}: ComponentProps<"p">) {
  const { descriptionId, setDescribed } = useItem();
  useLayoutEffect(() => {
    setDescribed(true);
    return () => setDescribed(false);
  }, [setDescribed]);
  return (
    <p
      id={descriptionId}
      data-slot="questionnaire-description"
      className={cn(
        "-mt-1.5 text-[13px] text-pretty text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function QuestionnaireChoices({
  className,
  onValueChange,
  children,
}: {
  className?: string;
  // Runs when the person checks or unchecks a choice.
  onValueChange?: (values: string[]) => void;
  children?: ReactNode;
}) {
  const { change, pickers } = useRoot();
  const { name, multiple, answer, titleId } = useItem();
  const choose = (values: string[]) => {
    change(name, (before) => ({ ...before, values, skipped: false }));
    onValueChange?.(values);
  };
  const pick = (value: string) => {
    if (!multiple) return choose([value]);
    const checked = answer.values.includes(value);
    choose(
      checked
        ? answer.values.filter((v) => v !== value)
        : [...answer.values, value],
    );
  };
  useEffect(() => {
    const all = pickers.current;
    all.set(name, pick);
    return () => {
      all.delete(name);
    };
  });
  const group = {
    name,
    "aria-labelledby": titleId,
    className: cn("grid min-w-0 gap-1.5", className),
  };
  return multiple ? (
    <CheckboxGroup {...group} value={answer.values} onValueChange={choose}>
      {children}
    </CheckboxGroup>
  ) : (
    <RadioGroup
      {...group}
      value={answer.values[0] ?? null}
      onValueChange={(value) => choose(value === null ? [] : [value])}
    >
      {children}
    </RadioGroup>
  );
}

export function QuestionnaireChoice({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children?: ReactNode;
}) {
  const { shortcut } = useRoot();
  const { name, multiple, invalid } = useItem();
  const letter = shortcut(name, value);
  const Choice = multiple ? Checkbox : Radio;
  return (
    <Choice
      value={value}
      data-questionnaire-choice=""
      data-questionnaire-shortcut={letter}
      data-type={multiple ? "checkbox" : "radio"}
      data-invalid={invalid ? "" : undefined}
      aria-keyshortcuts={letter}
      className={cn(
        "group/choice relative m-0 flex min-h-10 w-full cursor-pointer items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-start text-[13px] text-foreground transition-[background-color,border-color,scale] duration-150 outline-none select-none hover:border-foreground/15 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.995] data-checked:border-primary/50 data-checked:bg-primary/5 data-invalid:border-destructive/60",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none relative mt-px flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-input transition-colors group-data-checked/choice:border-primary group-data-checked/choice:bg-primary group-data-checked/choice:text-primary-foreground group-data-[type=radio]/choice:rounded-full"
      >
        <span className="hidden size-1.5 rounded-full bg-primary-foreground group-data-[type=radio]/choice:group-data-checked/choice:block" />
        <Check
          className="hidden size-3 group-data-[type=checkbox]/choice:group-data-checked/choice:block"
          strokeWidth={3}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug">
        {children}
      </span>
      {letter && (
        <span
          aria-hidden="true"
          className="pointer-events-none ms-auto inline-flex size-5 shrink-0 items-center justify-center rounded-md border bg-background font-mono text-[10px] leading-none font-medium text-muted-foreground"
        >
          {letter}
        </span>
      )}
    </Choice>
  );
}

export function QuestionnaireChoiceTitle({
  className,
  ...props
}: ComponentProps<"span">) {
  return <span className={cn("font-medium", className)} {...props} />;
}

export function QuestionnaireChoiceDescription({
  className,
  ...props
}: ComponentProps<"span">) {
  return <span className={cn("text-muted-foreground", className)} {...props} />;
}

// A typed answer. `multiline` makes it a textarea where Enter breaks the
// line; Cmd/Ctrl+Enter still continues. Beside single choices it is the
// other answer: writing one unchecks the choice.
export function QuestionnaireInput({
  className,
  multiline,
  value,
  onValueChange,
  ...props
}: {
  multiline?: boolean;
  value: string;
  onValueChange: (text: string) => void;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const { change } = useRoot();
  const { name, multiple, invalid } = useItem();
  const field = {
    value,
    // One handler for the host's text and the answer's state: a second
    // render between them would put the old text back in the field.
    onValueChange: (text: string) => {
      onValueChange(text);
      const filled = text.trim().length > 0;
      change(name, (answer) =>
        filled
          ? {
              ...answer,
              filled,
              skipped: false,
              values: multiple ? answer.values : [],
            }
          : { ...answer, filled },
      );
    },
    "aria-invalid": invalid || undefined,
    className: cn(
      "w-full min-w-0 rounded-xl border border-input bg-background px-3 text-[13px] transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/10 aria-invalid:border-destructive/60 touch:text-base",
      multiline ? "resize-none py-2 leading-5" : "h-10",
      className,
    ),
    ...props,
  };
  return multiline ? <Textarea rows={3} {...field} /> : <Input {...field} />;
}

export function QuestionnaireError({
  className,
  ...props
}: ComponentProps<"p">) {
  const { invalid, errorId } = useItem();
  return (
    <p
      id={errorId}
      role={invalid ? "alert" : undefined}
      hidden={!invalid}
      data-slot="questionnaire-error"
      className={cn("text-xs text-destructive", className)}
      {...props}
    />
  );
}

export function QuestionnaireActions({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="questionnaire-actions"
      className={cn("flex min-h-8 w-full items-center gap-1.5", className)}
      {...props}
    />
  );
}

type StepProps = Omit<ComponentProps<typeof Button>, "className"> & {
  className?: string;
};

export function QuestionnairePrevious({
  className,
  children,
  ...props
}: StepProps) {
  const { index, previous } = useRoot();
  return (
    <Button
      hidden={index === 0}
      onClick={previous}
      className={cn(quiet, className)}
      {...props}
    >
      {children ?? "Previous"}
    </Button>
  );
}

export function QuestionnaireSkip({
  className,
  children,
  ...props
}: StepProps) {
  const { items, index, skip } = useRoot();
  return (
    <Button
      hidden={!items[index] || !!items[index].required}
      onClick={skip}
      className={cn(quiet, className)}
      {...props}
    >
      {children ?? "Skip"}
    </Button>
  );
}

export function QuestionnaireNext({
  className,
  children,
  ...props
}: StepProps) {
  const { items, index, next } = useRoot();
  return (
    <Button
      hidden={index >= items.length - 1}
      onClick={next}
      className={cn(primary, className)}
      {...props}
    >
      {children ?? "Next"}
    </Button>
  );
}

export function QuestionnaireSubmit({
  className,
  children,
  ...props
}: StepProps) {
  const { items, index } = useRoot();
  return (
    <Button
      type="submit"
      hidden={index !== items.length - 1}
      className={cn(primary, className)}
      {...props}
    >
      {children ?? "Submit"}
    </Button>
  );
}
