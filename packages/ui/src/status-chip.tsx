import type { ReactNode } from "react";
import { cn } from "@lictory/core/lib/utils";

// The five meanings a state can have. Color only when it means something:
// attention for what waits on a person, danger for what failed or blocks,
// success for what is done, info for what is in motion. Everything else is
// neutral.
export type StatusTone =
  "neutral" | "info" | "attention" | "success" | "danger";

export const statusToneClass: Record<StatusTone, string> = {
  // Text leans a fifth toward the foreground, so 12px labels keep 4.5:1 on
  // their tint and on hovered rows in every theme.
  neutral: "bg-muted text-muted-foreground ring-foreground/8",
  info: "bg-ring/8 text-[color-mix(in_oklab,var(--ring)_80%,var(--foreground))] ring-ring/25",
  attention:
    "bg-warning/10 text-[color-mix(in_oklab,var(--warning)_80%,var(--foreground))] ring-warning/30",
  success:
    "bg-success/8 text-[color-mix(in_oklab,var(--success)_80%,var(--foreground))] ring-success/20",
  danger:
    "bg-destructive/8 text-[color-mix(in_oklab,var(--destructive)_80%,var(--foreground))] ring-destructive/20",
};

// One shape for every state: 20px tall, 6px corners, sans 12px medium, an
// icon and a label. The label is the state; the icon repeats it for a
// glance, so the chip never relies on color alone.
export function StatusChip({
  tone = "neutral",
  icon,
  children,
  title,
  className,
}: {
  tone?: StatusTone;
  // A 12px lucide icon (or a dot). Decorative: the label names the state.
  icon?: ReactNode;
  children: ReactNode;
  // A longer meaning, shown on hover ("The agent asked a question…").
  title?: string;
  className?: string;
}) {
  return (
    <span
      data-status-chip={tone}
      title={title}
      className={cn(
        "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-md px-1.5 text-xs leading-none font-medium whitespace-nowrap ring-1 ring-inset",
        statusToneClass[tone],
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden
          className="grid size-3 shrink-0 place-items-center [&_svg]:size-3"
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

// A small dot in the chip's color, for states without a natural icon.
export function StatusDot({ pulse = false }: { pulse?: boolean }) {
  return (
    <span
      className={cn(
        "size-1.5 rounded-full bg-current",
        pulse && "animate-pulse motion-reduce:animate-none",
      )}
    />
  );
}
