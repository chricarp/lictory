import { cn } from "@lictory/core/lib/utils";

// A small mark for people and things that live in Slack. Decorative: what it
// marks says "Slack" in words (a label, a tooltip).
export function SlackMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn("size-3 shrink-0", className)}
      fill="currentColor"
    >
      <rect x="5" y="1" width="2.6" height="7" rx="1.3" />
      <rect x="8.4" y="8" width="2.6" height="7" rx="1.3" />
      <rect x="8" y="5" width="7" height="2.6" rx="1.3" />
      <rect x="1" y="8.4" width="7" height="2.6" rx="1.3" />
    </svg>
  );
}
