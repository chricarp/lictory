import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";

// A row that scrolls sideways when it does not fit (tabs on a phone, a
// settings section strip). Its only child is the scroller. While more lies
// beyond an end, that end shows an arrow on the strip's own surface, so a
// cut-off tab reads as "more this way" instead of a word clipped in half;
// pressing the arrow scrolls by most of a screen. Keyboard users reach every
// tab with Tab or the arrow keys, which scroll the focused one into view,
// so the arrows are a pointer convenience kept out of the tab order and the
// accessibility tree.
export function ScrollStrip({
  children,
  className,
  // The surface the strip sits on, so the arrows hide the cut text.
  surface = "bg-background",
}: {
  children: ReactNode;
  className?: string;
  surface?: string;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: false, end: false });
  useEffect(() => {
    const scroller = wrapper.current?.firstElementChild;
    if (!(scroller instanceof HTMLElement)) return;
    const measure = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      // Right-to-left layouts report negative offsets.
      const at = Math.abs(scroller.scrollLeft);
      const next = { start: max > 1 && at > 1, end: max > 1 && at < max - 1 };
      setEnds((now) =>
        now.start === next.start && now.end === next.end ? now : next,
      );
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(scroller);
    for (const child of scroller.children) observer?.observe(child);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);
  const page = (direction: 1 | -1) => {
    const scroller = wrapper.current?.firstElementChild;
    if (!(scroller instanceof HTMLElement)) return;
    scroller.scrollBy({
      left: direction * Math.max(80, scroller.clientWidth * 0.7),
      behavior: "smooth",
    });
  };
  return (
    <div ref={wrapper} className={cn("relative min-w-0", className)}>
      {children}
      {ends.start && (
        <Cue side="start" surface={surface} onPress={() => page(-1)} />
      )}
      {ends.end && <Cue side="end" surface={surface} onPress={() => page(1)} />}
    </div>
  );
}

function Cue({
  side,
  surface,
  onPress,
}: {
  side: "start" | "end";
  surface: string;
  onPress: () => void;
}) {
  const Icon = side === "start" ? ChevronLeft : ChevronRight;
  return (
    <div
      aria-hidden
      data-scroll-cue={side}
      className={cn(
        "pointer-events-none absolute top-0 bottom-px flex items-center",
        side === "start" ? "left-0" : "right-0 flex-row-reverse",
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={onPress}
        className={cn(
          "pointer-events-auto grid h-full w-7 place-items-center text-muted-foreground hover:text-foreground",
          surface,
        )}
      >
        <Icon className="size-4" />
      </button>
      {/* Softens the cut between the arrow and the tab beneath it. */}
      <span
        className={cn(
          "h-full w-4",
          surface,
          side === "start"
            ? "[mask-image:linear-gradient(to_right,#000,transparent)]"
            : "[mask-image:linear-gradient(to_left,#000,transparent)]",
        )}
      />
    </div>
  );
}
