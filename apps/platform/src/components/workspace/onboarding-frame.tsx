"use client";

import { useId, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Logo } from "@lictory/ui/logo";
import { cn } from "@lictory/core/lib/utils";

// One easing for the whole flow: a quick start that settles softly.
export const ease = [0.23, 1, 0.32, 1] as const;

export function OnboardingFrame({
  children,
  stage = 0,
  labels = [],
  title,
}: {
  children: ReactNode;
  stage?: number;
  labels?: string[];
  title?: string;
}) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease }}>
      <main className="onboarding min-h-dvh bg-background">
        {title && <title>{title}</title>}
        <header className="flex items-center justify-between px-6 py-5 sm:px-8">
          <Logo className="[&>span]:h-6" />
          <Link
            href="/app/account"
            className="rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Account
          </Link>
        </header>
        <section className="relative mx-auto w-full max-w-[460px] px-6 pt-8 pb-16 sm:px-0 sm:pt-16">
          {labels.length > 0 && <Progress labels={labels} stage={stage} />}
          {children}
        </section>
      </main>
    </MotionConfig>
  );
}

function Progress({ labels, stage }: { labels: string[]; stage: number }) {
  return (
    <div className="mb-10">
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
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-3 sm:grid-cols-2"
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
              !selected && "hover:border-foreground/20",
            )}
          >
            {selected && (
              <motion.span
                layoutId={`${group}-selected`}
                aria-hidden
                className="absolute -inset-px rounded-xl border-2 border-foreground"
              />
            )}
            <span
              className={cn(
                "grid size-9 place-items-center rounded-lg transition-colors duration-200 [&_svg]:size-4",
                selected
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground",
              )}
            >
              {o.icon}
            </span>
            <span>
              <span className="block text-sm font-medium">{o.title}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {o.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
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
      <div
        role="radiogroup"
        aria-labelledby={`${group}-label`}
        className="flex rounded-lg bg-muted p-1"
      >
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={cn(
                "relative h-8 flex-1 rounded-md px-2 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {selected && (
                <motion.span
                  layoutId={`${group}-pill`}
                  aria-hidden
                  className="absolute inset-0 rounded-md bg-background shadow-[0_1px_2px_oklch(0_0_0/0.08),0_0_0_1px_oklch(0_0_0/0.04)]"
                />
              )}
              <span className="relative">{o.label}</span>
            </button>
          );
        })}
      </div>
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
