import {
  createScrollAreaController,
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollToEnd,
  ScrollAreaViewport,
  type ScrollAreaController,
} from "@ui-sdk/react/scroll-area";
import { ArrowDown } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { cn } from "@lictory/core/lib/utils";

// The transcript's scroll behaviour, on ui-sdk's Scroll Area. A new turn
// settles near the top with a peek of the previous one, the reply grows into
// the room below it, the view follows only while the reader is at the live
// edge, and a saved thread can reopen at its last question.
//
// The room below a new turn is a spacer after the last row, as tall as the
// turn is short of the viewport. The end of the content is then where the
// turn sits near the top, so following the end keeps it there while the reply
// grows, and follows the reply once it outgrows the room.

type DefaultScrollPosition = "end" | "last-anchor";

type Scroller = {
  autoScroll: boolean;
  defaultScrollPosition: DefaultScrollPosition;
  peek: number;
  controller: ScrollAreaController;
};

const ScrollerContext = createContext<Scroller | null>(null);

function useScroller() {
  const scroller = useContext(ScrollerContext);
  if (!scroller)
    throw new Error(
      "Message Scroller parts must be inside a MessageScrollerProvider.",
    );
  return scroller;
}

export function MessageScrollerProvider({
  autoScroll = false,
  defaultScrollPosition = "end",
  scrollPreviousItemPeek = 64,
  children,
}: {
  // Follows the reply while the reader is at the end.
  autoScroll?: boolean;
  // Where a thread that already has messages opens.
  defaultScrollPosition?: DefaultScrollPosition;
  // How much of the previous row stays visible above a new turn, in pixels.
  scrollPreviousItemPeek?: number;
  children?: ReactNode;
}) {
  const [controller] = useState(createScrollAreaController);
  return (
    <ScrollerContext.Provider
      value={{
        autoScroll,
        defaultScrollPosition,
        peek: scrollPreviousItemPeek,
        controller,
      }}
    >
      {children}
    </ScrollerContext.Provider>
  );
}

export function MessageScroller({
  className,
  ...props
}: Omit<
  ComponentProps<typeof ScrollArea>,
  "className" | "stickToEnd" | "controller"
> & { className?: string }) {
  const { autoScroll, controller } = useScroller();
  return (
    <ScrollArea
      stickToEnd={autoScroll}
      controller={controller}
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden rounded-none border-0 text-[length:inherit]",
        className,
      )}
      {...props}
    />
  );
}

export function MessageScrollerViewport({
  className,
  ...props
}: Omit<ComponentProps<typeof ScrollAreaViewport>, "className"> & {
  className?: string;
}) {
  return (
    <ScrollAreaViewport
      role="region"
      aria-label="Conversation"
      className={cn(
        "size-full min-h-0 min-w-0 scroll-fade-b [scrollbar-width:thin] [scrollbar-gutter:stable] overflow-y-auto overscroll-contain rounded-none contain-content outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
        className,
      )}
      {...props}
    />
  );
}

type ItemProps = ComponentProps<"div"> & {
  messageId?: string;
  // The row a new turn starts with: it settles near the top of the view.
  scrollAnchor?: boolean;
};

const px = (value: string) => Number.parseFloat(value) || 0;

export function MessageScrollerContent({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ScrollAreaContent>, "className" | "children"> & {
  className?: string;
  children?: ReactNode;
}) {
  const { controller, defaultScrollPosition, peek } = useScroller();
  const content = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);

  const rows = Children.toArray(children).flatMap((child) =>
    isValidElement<ItemProps>(child) && child.props.messageId
      ? [{ id: child.props.messageId, anchor: !!child.props.scrollAnchor }]
      : [],
  );
  const key = rows.map((row) => row.id).join("\n");
  // The turn that started while the reader was here. Rows that arrive
  // together (a saved thread loading) are not a new turn.
  const [seen, setSeen] = useState({ key: "", ids: [] as string[] });
  const [turn, setTurn] = useState<string | null>(null);
  if (seen.key !== key) {
    const fresh = rows.filter(
      (row) => row.anchor && !seen.ids.includes(row.id),
    );
    if (seen.ids.length > 0 && fresh.length === 1) setTurn(fresh[0]!.id);
    else if (turn && !rows.some((row) => row.id === turn)) setTurn(null);
    setSeen({ key, ids: rows.map((row) => row.id) });
  }

  const settled = useRef<string | null>(null);
  useLayoutEffect(() => {
    const root = content.current;
    const room = spacer.current;
    const viewport = root?.parentElement;
    if (!root || !room || !viewport) return;
    const anchor = turn
      ? [...root.children].find(
          (row): row is HTMLElement =>
            row instanceof HTMLElement && row.dataset.messageId === turn,
        )
      : undefined;
    if (!anchor) {
      room.hidden = true;
      return;
    }
    const fit = () => {
      const last = room.previousElementSibling;
      if (!last) return;
      const style = getComputedStyle(root);
      const used =
        last.getBoundingClientRect().bottom -
        anchor.getBoundingClientRect().top;
      const height = Math.ceil(
        viewport.clientHeight -
          px(style.paddingTop) -
          px(style.paddingBottom) -
          peek -
          used,
      );
      room.hidden = height <= 0;
      room.style.height = `${Math.max(0, height)}px`;
      // The spacer is not a row: it takes back the gap the column adds.
      room.style.marginTop = `${-px(style.rowGap)}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    for (
      let row: Element | null = anchor;
      row && row !== room;
      row = row.nextElementSibling
    )
      observer.observe(row);
    fit();
    if (settled.current !== turn) {
      settled.current = turn;
      controller.scrollToEnd({ behavior: "instant" });
    }
    return () => observer.disconnect();
  }, [turn, key, peek, controller]);

  // A saved thread whose last turn is taller than the view opens at that
  // turn's question instead of at the end of its answer.
  const [opening, setOpening] = useState(
    defaultScrollPosition === "last-anchor",
  );
  const loaded = rows.length > 0;
  useLayoutEffect(() => {
    if (!opening || !loaded) return;
    const root = content.current;
    const viewport = root?.parentElement;
    let frame = requestAnimationFrame(() => {
      // Two frames: Scroll Area has placed the view at the end by then, and a
      // scroll back from there lets go of the end.
      frame = requestAnimationFrame(() => {
        const anchor = root
          ? [...root.children].findLast(
              (row): row is HTMLElement =>
                row instanceof HTMLElement &&
                row.dataset.scrollAnchor === "true",
            )
          : undefined;
        if (root && viewport && anchor) {
          const inset = px(getComputedStyle(root).paddingTop) + peek;
          const top =
            anchor.getBoundingClientRect().top -
            root.getBoundingClientRect().top;
          if (root.scrollHeight - top > viewport.clientHeight)
            viewport.scrollTop = top - inset;
        }
        setOpening(false);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [opening, loaded, peek]);

  return (
    <ScrollAreaContent
      ref={content}
      role="log"
      aria-relevant="additions"
      className={cn(
        "flex h-max min-h-full flex-col gap-8 max-sm:gap-5",
        opening && loaded && "invisible",
        className,
      )}
      {...props}
    >
      {children}
      <div ref={spacer} aria-hidden="true" hidden className="shrink-0" />
    </ScrollAreaContent>
  );
}

export function MessageScrollerItem({
  className,
  messageId,
  scrollAnchor = false,
  ...props
}: ItemProps) {
  return (
    <div
      data-slot="message-scroller-item"
      data-message-id={messageId}
      data-scroll-anchor={scrollAnchor}
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
  ...props
}: Omit<ComponentProps<typeof ScrollAreaScrollToEnd>, "className"> & {
  className?: string;
}) {
  return (
    <ScrollAreaScrollToEnd
      className={cn(
        "absolute bottom-3 left-1/2 z-10 inline-flex h-8 -translate-x-1/2 scale-100 items-center gap-1.5 rounded-full border bg-background/95 px-3 text-[12px] font-medium text-foreground opacity-100 shadow-[0_6px_20px_-8px_oklch(0_0_0/0.3)] backdrop-blur transition-[translate,scale,opacity] duration-200 not-data-visible:pointer-events-none not-data-visible:translate-y-2 not-data-visible:scale-95 not-data-visible:opacity-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
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
    </ScrollAreaScrollToEnd>
  );
}
