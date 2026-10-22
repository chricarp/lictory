import type { ReactNode } from "react";
import {
  StateIllustration,
  type IllustrationKind,
} from "@lictory/ui/state-illustration";
import { cn } from "@lictory/core/lib/utils";

export { Avatar } from "@lictory/ui/avatar";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border bg-muted px-1 font-sans text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger" | "info";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium whitespace-nowrap",
        tone === "good" &&
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "warning" &&
          "bg-amber-500/12 text-amber-800 dark:text-amber-300",
        tone === "danger" && "bg-red-500/10 text-red-700 dark:text-red-400",
        tone === "info" && "bg-primary/10 text-primary",
        tone === "neutral" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
  illustration,
}: {
  illustration?: IllustrationKind;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-sm px-4 py-12 text-center sm:py-16">
      {illustration && <StateIllustration kind={illustration} />}
      <h2 className="text-sm font-medium">{title}</h2>
      {children && (
        <div className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
          {children}
        </div>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "text-[11px] font-medium tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </h3>
  );
}
