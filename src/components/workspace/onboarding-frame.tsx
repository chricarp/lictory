"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  FilePenLine,
  MessageSquareMore,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
import { Logo } from "~/components/logo";
import { cn } from "~/lib/utils";

export function OnboardingFrame({
  children,
  stage = 0,
  labels = ["Discover", "Your workspace", "Ready to begin"],
  title,
}: {
  children: ReactNode;
  stage?: number;
  labels?: string[];
  title?: string;
}) {
  return (
    <main className="onboarding min-h-dvh bg-background">
      {title && <title>{title}</title>}
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 sm:px-10">
        <Logo />
        <Link
          href="/app/account"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Your account <ArrowUpRight className="ml-1 inline size-3.5" />
        </Link>
      </header>
      <div className="mx-auto grid max-w-7xl gap-12 px-6 pt-6 pb-12 sm:px-10 lg:grid-cols-[0.85fr_1fr] lg:gap-24 lg:pt-14">
        <aside className="lg:sticky lg:top-12 lg:self-start">
          <p className="mb-5 text-xs font-medium tracking-[0.18em] text-primary uppercase">
            From intent to agreed behavior
          </p>
          <h2 className="max-w-md text-4xl leading-[1.12] font-medium tracking-[-0.045em] sm:text-5xl">
            Great work starts
            <br />
            with a shared
            <br />
            <span className="text-primary">understanding.</span>
          </h2>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-muted-foreground">
            Give product, engineering, and QA a place to turn a rough idea into
            something everyone can confidently build.
          </p>
          <div
            className="onboarding-preview mt-9 hidden max-w-sm rounded-2xl bg-card p-5 shadow-[0_0_0_1px_var(--border),0_12px_32px_oklch(0_0_0/0.05)] sm:block"
            aria-label="How refinement works"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>SPECIFICATION · REVISION 3</span>
              <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">
                In review
              </span>
            </div>
            <p className="mt-5 font-medium">A clearer path to checkout</p>
            <div className="mt-3 h-1.5 w-5/6 rounded-full bg-muted" />
            <div className="mt-2 h-1.5 w-2/3 rounded-full bg-muted" />
            <div className="mt-5 rounded-xl bg-primary/5 p-3 text-xs leading-relaxed">
              <MessageSquareMore className="mr-2 inline size-4 text-primary" />
              QA asks: “What happens if payment times out?”
            </div>
            <div className="mt-4 flex gap-2 text-xs">
              <span className="rounded-full bg-muted px-2 py-1">Product</span>
              <span className="rounded-full bg-muted px-2 py-1">
                Engineering
              </span>
              <span className="rounded-full bg-muted px-2 py-1">QA</span>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs text-muted-foreground">
            {[
              [FilePenLine, "Draft together"],
              [MessageSquareMore, "Review in context"],
              [ShieldCheck, "Build with evidence"],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Check;
              return (
                <span className="flex items-center gap-2" key={label as string}>
                  <I className="size-4" />
                  {label as string}
                </span>
              );
            })}
          </div>
        </aside>
        <section className="min-w-0 lg:pt-1">
          <ol aria-label="Setup progress" className="mb-9 flex gap-2">
            {labels.map((label, i) => (
              <li
                key={label}
                aria-current={i === stage ? "step" : undefined}
                className="flex-1"
              >
                <div
                  className={cn(
                    "mb-2 h-1 rounded-full transition-[background-color] duration-150",
                    i <= stage ? "bg-primary" : "bg-border",
                  )}
                />
                <span
                  className={cn(
                    "text-[11px] sm:text-xs",
                    i === stage
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {i < stage && <Check className="mr-1 inline size-3" />}
                  {label}
                </span>
              </li>
            ))}
          </ol>
          {children}
        </section>
      </div>
    </main>
  );
}

export function OnboardingHeading({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-7">
      <h1
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
      >
        {title}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

export function Choice({
  selected,
  title,
  children,
  onClick,
}: {
  selected?: boolean;
  title: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected ?? false}
      onClick={onClick}
      className={cn(
        "onboarding-choice w-full rounded-xl border p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary bg-primary/5 shadow-[0_0_0_1px_var(--primary)]"
          : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span className="flex items-center justify-between gap-3 text-sm font-medium">
        {title}
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border",
          )}
        >
          {selected && <Check className="size-3" />}
        </span>
      </span>
      <span className="mt-1.5 block pr-6 text-sm leading-relaxed text-muted-foreground">
        {children}
      </span>
    </button>
  );
}
