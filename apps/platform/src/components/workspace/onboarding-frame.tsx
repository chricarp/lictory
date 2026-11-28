import { useId, type ReactNode } from "react";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { Link } from "@lictory/platform/lib/navigation";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { LogoMark } from "@lictory/ui/logo";
import { cn } from "@lictory/core/lib/utils";
import {
  frameGroundClass,
  frameMarkClass,
} from "@lictory/platform/components/auth/auth-layout";

// The steps of setting up a new organization, counted from its first form
// (the workspace and its project) to the last, wherever setup starts.
export const setupLabels = [
  "Workspace",
  "Delivery",
  "Lictory Intelligence",
  "People",
];

// One easing for the whole flow: a quick start that settles softly.
export const ease = [0.23, 1, 0.32, 1] as const;

export function OnboardingFrame({
  children,
  stage = 0,
  labels = [],
  title,
  accountLink = true,
}: {
  children: ReactNode;
  stage?: number;
  labels?: string[];
  title?: string;
  // Account settings need a handle, so the handle step has none.
  accountLink?: boolean;
}) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease }}>
      {/* The same frame as signing in (ground, mark, the card's top edge),
          so creating an account and setting up read as one flow. */}
      <main className={cn("onboarding relative", frameGroundClass)}>
        {title && <title>{title}</title>}
        {accountLink && (
          <Link
            href="/account"
            className="absolute top-5 right-6 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:right-8"
          >
            Account
          </Link>
        )}
        <span aria-hidden className={frameMarkClass}>
          <LogoMark className="size-9" />
        </span>
        <div className="w-full pb-6">
          <section className="lictory-enter relative mx-auto w-full max-w-[540px] rounded-[1.75rem] bg-card px-6 py-8 shadow-(--shadow-panel) sm:px-10 sm:py-10">
            {labels.length > 0 && <Progress labels={labels} stage={stage} />}
            {children}
          </section>
        </div>
      </main>
    </MotionConfig>
  );
}

function Progress({ labels, stage }: { labels: string[]; stage: number }) {
  return (
    <div className="mb-8">
      <ol aria-label="Setup progress" className="flex gap-1.5">
        {labels.map((label, i) => (
          <li
            key={label}
            aria-current={i === stage ? "step" : undefined}
            className="relative h-1 flex-1 overflow-hidden rounded-full bg-border"
          >
            <span className="sr-only">{label}</span>
            <motion.span
              aria-hidden
              className="absolute inset-0 origin-left rounded-full bg-foreground"
              initial={false}
              animate={{ scaleX: i <= stage ? 1 : 0 }}
              transition={{ duration: 0.4, ease }}
            />
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">{labels[stage]}</span>
        <span className="mx-1.5 text-muted-foreground/50">·</span>
        {stage + 1} of {labels.length}
      </p>
    </div>
  );
}

/** Slides between keyed steps in the direction of travel. */
export function Steps({
  step,
  direction,
  children,
}: {
  step: string | number;
  direction: number;
  children: ReactNode;
}) {
  return (
    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
      <motion.div
        key={step}
        custom={direction}
        className="onboarding-step"
        variants={{
          enter: (d: number) => ({ opacity: 0, x: d * 16 }),
          center: { opacity: 1, x: 0 },
          exit: (d: number) => ({ opacity: 0, x: d * -16 }),
        }}
        initial="enter"
        animate="center"
        exit="exit"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Expands and collapses dependent fields instead of popping them in. */
export function Reveal({
  show,
  children,
}: {
  show: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function OnboardingHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8">
      <h1
        tabIndex={-1}
        className="text-2xl font-semibold tracking-[-0.02em] text-balance outline-none"
      >
        {title}
      </h1>
      {children && (
        <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
          {children}
        </p>
      )}
    </div>
  );
}

/** A navigational option: picking it moves the flow forward. */
export function Choice({
  title,
  children,
  icon,
  onClick,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-xl border bg-card px-4 py-4 text-left outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
    >
      {icon && (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground [&_svg]:size-4">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {children}
        </span>
      </span>
      <ArrowRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
      />
    </button>
  );
}

/** A single-select group of large cards with a sliding selection outline. */
export function CardOptions<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | "";
  onChange: (value: T) => void;
  options: { value: T; title: string; description: string; icon: ReactNode }[];
}) {
  const group = useId();
  return (
    <RadioGroup
      aria-label={label}
      value={value || null}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      {options.map((o) => (
        <Radio
          key={o.value}
          value={o.value}
          aria-label={o.title}
          className="group relative flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] data-unchecked:hover:border-foreground/20"
        >
          {value === o.value && (
            <motion.span
              layoutId={`${group}-selected`}
              aria-hidden
              className="absolute -inset-px rounded-xl border-2 border-foreground"
            />
          )}
          <span className="grid size-9 place-items-center rounded-lg bg-muted text-foreground transition-colors duration-200 group-data-checked:bg-foreground group-data-checked:text-background [&_svg]:size-4">
            {o.icon}
          </span>
          <span>
            <span className="block text-sm font-medium">{o.title}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {o.description}
            </span>
          </span>
        </Radio>
      ))}
    </RadioGroup>
  );
}

/** Compact single-select with a pill that glides to the selection. */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T | "";
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  hint?: ReactNode;
}) {
  const group = useId();
  return (
    <div>
      <p id={`${group}-label`} className="mb-2 text-sm font-medium">
        {label}
      </p>
      <RadioGroup
        aria-labelledby={`${group}-label`}
        value={value || null}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        className="flex flex-row gap-0 rounded-lg bg-muted p-1"
      >
        {options.map((o) => (
          <Radio
            key={o.value}
            value={o.value}
            className="relative h-8 flex-1 rounded-md px-2 text-[13px] whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-checked:font-medium data-checked:text-foreground"
          >
            {value === o.value && (
              <motion.span
                layoutId={`${group}-pill`}
                aria-hidden
                className="absolute inset-0 rounded-md bg-background shadow-[0_1px_2px_oklch(0_0_0/0.08),0_0_0_1px_oklch(0_0_0/0.04)]"
              />
            )}
            <span className="relative">{o.label}</span>
          </Radio>
        ))}
      </RadioGroup>
      {hint && (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={value}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-2 text-xs leading-relaxed text-muted-foreground"
          >
            {hint}
          </motion.p>
        </AnimatePresence>
      )}
    </div>
  );
}
