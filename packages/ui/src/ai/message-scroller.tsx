import {
  MessageScroller as Primitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";
import { ArrowDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@lictory/core/lib/utils";

// Message Scroller (shadcn/ui, MIT): the transcript's scroll behaviour. A new
// turn settles near the top with a peek of the previous one, the reply grows
// into the room below it, the view follows only while the reader is at the
// live edge, and a saved thread reopens at its last question. Scroll state
// lives outside React, so streaming never re-renders the rows.

export function MessageScrollerProvider(
  props: ComponentProps<typeof Primitive.Provider>,
) {
  return <Primitive.Provider {...props} />;
}

export function MessageScroller({
  className,
  ...props
}: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

export function MessageScrollerViewport({
  className,
  ...props
}: ComponentProps<typeof Primitive.Viewport>) {
  return (
    <Primitive.Viewport
      data-slot="message-scroller-viewport"
      aria-label="Conversation"
      className={cn(
        "size-full min-h-0 min-w-0 scroll-fade-b [scrollbar-width:thin] [scrollbar-gutter:stable] overflow-y-auto overscroll-contain contain-content outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset data-pending-scroll:invisible",
        className,
      )}
      {...props}
    />
  );
}

export function MessageScrollerContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Content
      data-slot="message-scroller-content"
      className={cn(
        "flex h-max min-h-full flex-col gap-8 max-sm:gap-5",
        className,
      )}
      {...props}
    />
  );
}

export function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn(
        "min-w-0 shrink-0 [contain-intrinsic-size:auto_8rem] [content-visibility:auto]",
        className,
      )}
      {...props}
    />
  );
}

// "Jump to latest": appears only while there is something below, and resumes
// following the reply when pressed.
export function MessageScrollerButton({
  className,
  children,
  direction = "end",
  ...props
}: ComponentProps<typeof Primitive.Button>) {
  return (
    <Primitive.Button
      data-slot="message-scroller-button"
      direction={direction}
      className={cn(
        "absolute left-1/2 z-10 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-3 text-[12px] font-medium text-foreground shadow-[0_6px_20px_-8px_oklch(0_0_0/0.3)] backdrop-blur transition-[translate,scale,opacity] duration-200 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[direction=end]:bottom-3 data-[direction=end]:data-[active=false]:translate-y-2",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDown className="size-3.5" aria-hidden />
          <span>Jump to latest</span>
        </>
      )}
    </Primitive.Button>
  );
}

export {
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
