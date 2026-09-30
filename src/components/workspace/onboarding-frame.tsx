"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { Logo } from "~/components/logo";
import { cn } from "~/lib/utils";

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
    <main className="onboarding min-h-dvh bg-background">
      {title && <title>{title}</title>}
      <header className="flex items-center justify-between px-6 py-5 sm:px-8">
        <Logo className="gap-2 text-sm [&_svg]:size-6" />
        <Link
          href="/app/account"
          className="rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Account
        </Link>
      </header>
      <section className="mx-auto w-full max-w-[480px] px-6 pt-10 pb-16 sm:px-0 sm:pt-16">
        {labels.length > 0 && (
          <ol
            aria-label="Setup progress"
            className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-2"
          >
            {labels.map((label, i) => (
              <li
                key={label}
                aria-current={i === stage ? "step" : undefined}
                className="flex items-center gap-2 text-[11px]"
              >
                <span
                  className={cn(
                    i === stage
                      ? "font-medium text-foreground"
                      : "text-muted-foreground/70",
                  )}
                >
                  {label}
                </span>
                {i < labels.length - 1 && (
                  <ChevronRight
                    aria-hidden
                    className="size-3 text-muted-foreground/40"
                  />
                )}
              </li>
            ))}
          </ol>
        )}
        {children}
      </section>
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
    <div className="mb-6">
      <h1
        tabIndex={-1}
        className="text-xl font-semibold tracking-tight outline-none sm:text-2xl"
      >
        {title}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
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
        "onboarding-choice w-full rounded-lg border px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-foreground/25 bg-muted/50"
          : "border-border bg-card hover:border-foreground/20 hover:bg-muted/30",
      )}
    >
      <span className="flex items-center justify-between gap-3 text-[13px] font-medium">
        {title}
        {selected !== undefined && (
          <span className="flex size-4 shrink-0 items-center justify-center">
            {selected && <Check aria-hidden className="size-3.5" />}
          </span>
        )}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
        {children}
      </span>
    </button>
  );
}
