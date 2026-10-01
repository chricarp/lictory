import { Gather } from "loading-dev";
import { cn } from "~/lib/utils";

// Loading placeholder for content that is on its way. The animation is
// decorative; the label is what assistive technology announces.
export function Spinner({
  label,
  size = 16,
  className,
}: {
  label: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex text-muted-foreground", className)}
    >
      <Gather size={size} />
    </span>
  );
}

// Fills a pane and centers the spinner, for views that have nothing to show yet.
export function LoadingState({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "route-skeleton flex h-full min-h-32 items-center justify-center",
        className,
      )}
    >
      <Spinner label={label} size={20} />
    </div>
  );
}
