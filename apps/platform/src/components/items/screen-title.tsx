import type { ReactNode } from "react";
import { cn } from "@lictory/core/lib/utils";

// The title of a screen that takes the specification's place inside an
// item: its branches, a branch, a pull request, an AI review. The item's
// bar stays the page's header (where it is, the way back); this names what
// the screen shows, as the item's own title does on the specification.
export function ItemScreenTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h1
      className={cn(
        "text-xl font-semibold tracking-[-0.01em] wrap-break-word",
        className,
      )}
    >
      {children}
    </h1>
  );
}
