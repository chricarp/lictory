import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@lictory/core/lib/utils";

// Trace (shadcn/ui AI Elements, MIT): the shape of every step an agent takes
// inside a turn. Reasoning, tool calls, chains of thought and sources are all
// lines of a trace: an icon, a title in the tense of the step, an optional
// description, and a panel that opens for detail.

export function Trace({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="trace"
      className={cn(
        "flex w-full min-w-0 flex-col gap-1.5 *:has-[>[data-slot=trace-line]]:flex *:has-[>[data-slot=trace-line]]:w-fit *:has-[>[data-slot=trace-line]]:max-w-full *:has-[>[data-slot=trace-line]]:min-w-0 *:has-[>[data-slot=trace-line]]:rounded-md *:has-[>[data-slot=trace-line]]:text-left *:has-[>[data-slot=trace-line]]:outline-none *:has-[>[data-slot=trace-line]]:focus-visible:ring-2 *:has-[>[data-slot=trace-line]]:focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

export type TraceStatus = "running" | "error" | "pending" | "waiting";

export function TraceLine({
  className,
  status,
  ...props
}: ComponentProps<"span"> & { status?: TraceStatus }) {
  return (
    <span
      data-slot="trace-line"
      data-status={status}
      className={cn(
        "flex min-h-6 w-fit max-w-full min-w-0 items-center gap-2 text-[13px] text-muted-foreground transition-colors in-[a,button]:cursor-pointer in-[a:hover,button:hover]:text-foreground data-[status=error]:text-destructive data-[status=error]:in-[a:hover,button:hover]:text-destructive data-[status=pending]:opacity-60 data-[status=running]:*:data-[slot=trace-title]:shimmer data-[status=waiting]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TraceIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-icon"
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 [[data-slot=trace-title]~&]:-ml-1",
        className,
      )}
      {...props}
    />
  );
}

export function TraceTitle({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-title"
      className={cn("min-w-0 truncate", className)}
      {...props}
    />
  );
}

export function TraceDescription({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-description"
      className={cn(
        "shrink-0 text-muted-foreground/70 tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

type CollapsibleRootProps = Omit<
  ComponentProps<typeof Collapsible.Root>,
  "open" | "onOpenChange"
> &
  (
    | { open?: undefined; onOpenChange?: undefined }
    | { open: boolean; onOpenChange: (open: boolean) => void }
  );

export function TraceCollapsible({
  className,
  open,
  onOpenChange,
  ...props
}: CollapsibleRootProps) {
  return (
    <Collapsible.Root
      data-slot="trace-collapsible"
      className={cn("flex w-full min-w-0 flex-col", className)}
      {...(open === undefined
        ? {}
        : { open, onOpenChange: (next: boolean) => onOpenChange(next) })}
      {...props}
    />
  );
}

export function TraceCollapsibleTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Collapsible.Trigger>) {
  return (
    <Collapsible.Trigger
      data-slot="trace-collapsible-trigger"
      className={cn(
        // The hit area reaches past the compact line (28 px tall) without
        // spacing the lines further apart.
        "group/trace-trigger relative flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md text-left text-muted-foreground transition-colors outline-none after:absolute after:-inset-x-1 after:-inset-y-0.5 after:content-[''] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 has-[[data-status=error]]:text-destructive touch:after:-inset-y-2",
        className,
      )}
      {...props}
    >
      {children}
      <TraceIcon className="opacity-60 transition-[transform,opacity] duration-200 group-hover/trace-trigger:opacity-100 group-aria-expanded/trace-trigger:rotate-90">
        <ChevronRight />
      </TraceIcon>
    </Collapsible.Trigger>
  );
}

export function TraceCollapsibleContent({
  className,
  children,
  ...props
}: ComponentProps<typeof Collapsible.Panel>) {
  return (
    <Collapsible.Panel
      data-slot="trace-collapsible-content"
      className="h-(--collapsible-panel-height) min-w-0 overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none"
      {...props}
    >
      <div
        data-slot="trace-collapsible-content-inner"
        className={cn(
          "mt-1.5 mb-1 ml-[calc(--spacing(2)-1px)] min-w-0 border-l pr-1 pl-4 text-[13px] leading-relaxed wrap-break-word text-muted-foreground",
          className,
        )}
      >
        {children}
      </div>
    </Collapsible.Panel>
  );
}
