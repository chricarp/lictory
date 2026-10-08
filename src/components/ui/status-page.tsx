import type { ComponentType, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { StateIllustration, type IllustrationKind } from "./state-illustration";

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

const wells = {
  neutral: "bg-muted text-muted-foreground",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive",
} as const;

export function StatusPage({
  brand,
  icon: Icon,
  tone = "neutral",
  kicker,
  title,
  illustration,
  children,
  actions,
  detail,
}: {
  brand?: ReactNode;
  icon: Icon;
  tone?: keyof typeof wells;
  kicker?: string;
  title: string;
  illustration?: IllustrationKind;
  children?: ReactNode;
  actions?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {brand && (
        <header className="mx-auto flex h-18 w-full max-w-6xl items-center px-5 sm:px-8">
          {brand}
        </header>
      )}
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16 text-center">
        {illustration && <StateIllustration kind={illustration} />}
        <div
          className={cn(
            "lictory-enter mx-auto mb-6 grid size-14 place-items-center rounded-2xl",
            wells[tone],
          )}
        >
          <Icon className="size-7" strokeWidth={1.75} />
        </div>
        {kicker && (
          <p className="lictory-enter lictory-enter-delay-1 mb-2 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            {kicker}
          </p>
        )}
        <h1 className="lictory-enter lictory-enter-delay-1 text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {children && (
          <div className="lictory-enter lictory-enter-delay-2 mt-2 text-sm leading-6 text-muted-foreground">
            {children}
          </div>
        )}
        {detail && (
          <p
            role="alert"
            className="lictory-enter lictory-enter-delay-2 mt-4 rounded-xl bg-muted px-3 py-2 text-left text-[13px] leading-5 text-muted-foreground"
          >
            {detail}
          </p>
        )}
        {actions && (
          <div className="lictory-enter lictory-enter-delay-3 mt-8 flex flex-wrap justify-center gap-2">
            {actions}
          </div>
        )}
      </main>
    </div>
  );
}

export function MissingState({
  icon: Icon,
  tone = "neutral",
  title,
  illustration,
  children,
  action,
}: {
  icon: Icon;
  tone?: keyof typeof wells;
  title: string;
  illustration?: IllustrationKind;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-full place-items-center px-6 py-16">
      <div className="mx-auto max-w-sm text-center">
        {illustration && <StateIllustration kind={illustration} />}
        <div
          className={cn(
            "mx-auto mb-4 grid size-10 place-items-center rounded-[10px]",
            wells[tone],
          )}
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </div>
        <h1 className="text-sm font-medium">{title}</h1>
        {children && (
          <div className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
            {children}
          </div>
        )}
        {action && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
