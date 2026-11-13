import { useReducedMotion } from "motion/react";
import { memo, useEffect, useRef, useState } from "react";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { cn } from "@lictory/core/lib/utils";
import {
  closeUnfinished,
  splitBlocks,
} from "@lictory/platform/components/intelligence/chat/markdown-blocks";

// Litto's reply as it streams. Saved snapshots arrive in bursts (the browser
// reads them every couple of seconds), so the text is revealed at a steady
// reading pace instead of jumping a paragraph at a time, and the Markdown is
// split into blocks so only the block still growing is parsed again.

// While the turn streams, each burst is spread over the time the next one
// is expected to take (the measured gap between snapshots, within bounds), so
// text keeps arriving instead of racing ahead and pausing. A slow floor keeps
// the reveal moving; once the turn has ended, what remains lands at once.
const MIN_PACE = 8;
const FIRST_GAP_MS = 1_000;
const MIN_GAP_MS = 400;
const MAX_GAP_MS = 2_500;
const FINISH_MS = 150;

export function useSmoothText(text: string, streaming: boolean) {
  const [shown, setShown] = useState(() => (streaming ? 0 : text.length));
  // An answer seen streaming keeps revealing after its last snapshot lands,
  // so the end of the reply does not pop in; history renders whole.
  const [seenLive, setSeenLive] = useState(streaming);
  if (streaming && !seenLive) setSeenLive(true);
  // Reduced motion shows each snapshot as it lands.
  const reduce = useReducedMotion();
  const live = !reduce && seenLive && shown < text.length;
  // When snapshots arrive, measured outside render.
  const arrivals = useRef({ at: 0, gap: FIRST_GAP_MS });
  useEffect(() => {
    const now = performance.now();
    const seen = arrivals.current;
    if (seen.at)
      seen.gap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, now - seen.at));
    seen.at = now;
  }, [text]);
  useEffect(() => {
    if (!live) return;
    const goal = text.length;
    const horizon = streaming ? arrivals.current.gap : FINISH_MS;
    let frame = 0;
    let last = performance.now();
    let position = shown;
    // One rate per burst, set by its size: the reveal ends on time instead
    // of crawling through the last words.
    const rate = Math.max(MIN_PACE, ((goal - position) / horizon) * 1000);
    let painted = 0;
    const step = (now: number) => {
      const elapsed = now - last;
      last = now;
      position = Math.min(goal, position + (rate * elapsed) / 1000);
      // About 30 updates a second: smooth to read, and the growing block is
      // parsed at most that often.
      if (now - painted >= 32 || position >= goal) {
        painted = now;
        setShown(Math.floor(position));
      }
      if (position < goal) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // `shown` only seeds the loop; it advances inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, text, streaming]);
  if (!live) return { text, revealing: false };
  // Never cut a word in half: reveal up to the last whitespace.
  const cut = text.slice(0, shown);
  const space = cut.search(/\s\S*$/);
  return { text: space > 0 ? cut.slice(0, space) : cut, revealing: true };
}

const Block = memo(function Block({
  source,
  caret,
}: {
  source: string;
  caret: boolean;
}) {
  return (
    <Markdown
      source={source}
      codeBlocks
      className={cn(
        // Reading rhythm for answers: comfortable, not airy; lists keep their
        // items close and bold leads read as labels.
        "chat-prose text-[14.5px] leading-[1.7] [&_h2]:mt-6 [&_h2]:text-base [&_h3]:mt-5 [&_li]:my-0.5 [&_li>strong:first-child]:font-semibold [&_ol]:my-2.5 [&_p]:my-2.5 [&_pre]:text-[12.5px] [&_ul]:my-2.5",
        caret && "chat-streaming",
      )}
    />
  );
});

export function Response({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const smooth = useSmoothText(text, streaming);
  const blocks = splitBlocks(smooth.text);
  const caret = streaming || smooth.revealing;
  return (
    <div
      data-slot="response"
      className="flex min-w-0 flex-col gap-3 [&>div:not(:first-child)>:is(h2,h3,h4,h5,h6):first-child]:mt-3"
    >
      {blocks.map((block, i) => {
        const growing = caret && i === blocks.length - 1;
        return (
          <Block
            key={i}
            source={growing ? closeUnfinished(block) : block}
            caret={growing}
          />
        );
      })}
    </div>
  );
}
