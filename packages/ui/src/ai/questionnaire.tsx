import { Questionnaire as Primitive } from "@shadcn/react/questionnaire";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@lictory/core/lib/utils";

// Questionnaire (shadcn/ui, MIT): one question at a time with native radios
// and checkboxes, answer shortcuts, freeform answers, explicit skips,
// validation and progress. The host owns what happens to the answers.

const action =
  "inline-flex h-8 touch:h-11 touch:px-4 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-150 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${action} bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.12)] hover:bg-(--primary-hover)`;
const quiet = `${action} text-muted-foreground hover:bg-muted hover:text-foreground`;

export function Questionnaire({
  className,
  ...props
}: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      data-slot="questionnaire"
      className={cn("flex w-full min-w-0 flex-col gap-4", className)}
      {...props}
    />
  );
}

export function QuestionnaireProgress({
  className,
  ...props
}: ComponentProps<typeof Primitive.Progress>) {
  return (
    <Primitive.Progress
      data-slot="questionnaire-progress"
      className={cn(
        "text-[11.5px] font-medium text-muted-foreground tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export function QuestionnaireItem({
  className,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      data-slot="questionnaire-item"
      className={cn(
        "flex min-w-0 flex-col gap-3 border-0 p-0 outline-none data-active:motion-safe:animate-[questionnaire-in_220ms_cubic-bezier(0.23,1,0.32,1)]",
        className,
      )}
      {...props}
    />
  );
}

export function QuestionnaireTitle({
  className,
  ...props
}: ComponentProps<typeof Primitive.Title>) {
  return (
    <Primitive.Title
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
}: ComponentProps<typeof Primitive.Description>) {
  return (
    <Primitive.Description
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
  ...props
}: ComponentProps<typeof Primitive.Choices>) {
  return (
    <Primitive.Choices
      data-slot="questionnaire-choices"
      className={cn("grid min-w-0 gap-1.5", className)}
      {...props}
    />
  );
}

export function QuestionnaireChoice({
  children,
  className,
  ...props
}: ComponentProps<typeof Primitive.Choice>) {
  return (
    <Primitive.Choice
      data-slot="questionnaire-choice"
      className={cn(
        "group/choice relative flex min-h-10 cursor-pointer items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-start text-[13px] transition-[background-color,border-color,scale] duration-150 outline-none select-none hover:border-foreground/15 hover:bg-muted/50 active:scale-[0.995] has-[>input:focus-visible]:ring-2 has-[>input:focus-visible]:ring-ring/50 data-checked:border-primary/50 data-checked:bg-primary/5 data-invalid:border-destructive/60",
        className,
      )}
      {...props}
    >
      <Primitive.ChoiceInput className="sr-only" />
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
      <Primitive.ChoiceLabel className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug">
        {children}
      </Primitive.ChoiceLabel>
      <Primitive.ChoiceShortcut className="pointer-events-none ms-auto hidden size-5 shrink-0 items-center justify-center rounded-md border bg-background font-mono text-[10px] leading-none font-medium text-muted-foreground group-data-[shortcut]/choice:inline-flex" />
    </Primitive.Choice>
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

// A freeform answer. `multiline` makes it a textarea where Enter breaks the
// line; Cmd/Ctrl+Enter still continues.
export function QuestionnaireInput({
  className,
  multiline,
  onKeyDown,
  ...props
}: ComponentProps<typeof Primitive.Input> & { multiline?: boolean }) {
  return (
    <Primitive.Input
      data-slot="questionnaire-input"
      render={multiline ? <textarea rows={3} /> : undefined}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          multiline &&
          event.key === "Enter" &&
          !event.metaKey &&
          !event.ctrlKey
        )
          event.stopPropagation();
      }}
      className={cn(
        "w-full min-w-0 rounded-xl border bg-background px-3 text-[13px] transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary/40 focus-visible:ring-4 focus-visible:ring-primary/10 aria-invalid:border-destructive/60 touch:text-base",
        multiline ? "resize-none py-2 leading-5" : "h-10",
        className,
      )}
      {...props}
    />
  );
}

export function QuestionnaireError({
  className,
  ...props
}: ComponentProps<typeof Primitive.Error>) {
  return (
    <Primitive.Error
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

export function QuestionnairePrevious({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Previous>) {
  return (
    <Primitive.Previous className={cn(quiet, className)} {...props}>
      {children ?? "Previous"}
    </Primitive.Previous>
  );
}

export function QuestionnaireSkip({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Skip>) {
  return (
    <Primitive.Skip className={cn(quiet, className)} {...props}>
      {children ?? "Skip"}
    </Primitive.Skip>
  );
}

export function QuestionnaireNext({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Next>) {
  return (
    <Primitive.Next className={cn(primary, className)} {...props}>
      {children ?? "Next"}
    </Primitive.Next>
  );
}

export function QuestionnaireSubmit({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Submit>) {
  return (
    <Primitive.Submit className={cn(primary, className)} {...props}>
      {children ?? "Submit"}
    </Primitive.Submit>
  );
}
