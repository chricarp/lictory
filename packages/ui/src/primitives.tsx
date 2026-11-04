import type { ReactNode } from "react";
import {
  StateIllustration,
  type IllustrationKind,
} from "@lictory/ui/state-illustration";
import { cn } from "@lictory/core/lib/utils";

export { Avatar } from "@lictory/ui/avatar";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border bg-card px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-xs">
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
        // Soft status pills: a tint, a hairline of the same hue, no fill.
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        tone === "good" && "bg-success/8 text-success ring-success/20",
        tone === "warning" && "bg-warning/8 text-warning ring-warning/25",
        tone === "danger" &&
          "bg-destructive/8 text-destructive ring-destructive/20",
        tone === "info" && "bg-ring/8 text-ring ring-ring/20",
        tone === "neutral" &&
          "bg-muted text-muted-foreground ring-foreground/8",
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
        // Metadata labels: small mono capitals, like an instrument panel.
        "font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </h3>
  );
}
