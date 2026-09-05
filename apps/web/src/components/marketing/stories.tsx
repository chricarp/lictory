"use client";

import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from "motion/react";
import * as React from "react";

import { ArrowRight, BellRing, Search } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

import { STORIES, type Story } from "./content";
import {
  Container,
  EASE,
  Eyebrow,
  FragmentCard,
  Heading,
  Lede,
  Reveal,
} from "./primitives";

/** The "later" half of a story: how the captured thing comes back. */
function Later({ story }: { story: Story }) {
  const isReminder = story.id === "walking";
  return (
    <div className="rounded-lg border border-hairline bg-canvas-raised p-4">
      <p className="flex items-center gap-2 text-[0.75rem] font-medium text-subtle">
        {isReminder ? (
          <BellRing className="size-3.5" aria-hidden />
        ) : (
          <Search className="size-3.5" aria-hidden />
        )}
        {story.later.when}
      </p>
      <p className="mt-2 text-[0.9375rem] font-medium text-foreground">
        {isReminder ? story.later.prompt : `“${story.later.prompt}”`}
      </p>
      <p className="mt-1.5 text-sm leading-6 text-muted">
        {story.later.result}
      </p>
    </div>
  );
}

function StoryVisual({ story }: { story: Story }) {
  return (
    <div className="relative">
      <FragmentCard fragment={story.fragment} />
      <div className="my-2 flex items-center gap-2 pl-4 text-[0.75rem] text-subtle">
        <span className="h-6 w-px bg-hairline-strong" aria-hidden />
        <ArrowRight className="size-3.5 rotate-90" aria-hidden />
        <span>later</span>
      </div>
      <Later story={story} />
    </div>
  );
}

function StoryText({
  story,
  index,
  onActive,
}: {
  story: Story;
  index: number;
  onActive: (i: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5, margin: "-10% 0px -10% 0px" });
  React.useEffect(() => {
    if (inView) onActive(index);
  }, [inView, index, onActive]);

  return (
    <div
      ref={ref}
      className="lg:flex lg:min-h-[70vh] lg:flex-col lg:justify-center"
    >
      <Reveal>
        <p className="text-sm font-medium text-ember">{story.eyebrow}</p>
        <h3 className="mt-3 text-balance text-2xl font-semibold leading-[1.15] tracking-[-0.03em] sm:text-3xl">
          {story.title}
        </h3>
        <div className="mt-5 space-y-1 text-lg leading-8 text-muted">
          {story.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </Reveal>
      <Reveal className="mt-8 lg:hidden" delay={0.1}>
        <StoryVisual story={story} />
      </Reveal>
    </div>
  );
}

export function Stories() {
  const reduce = useReducedMotion();
  const [active, setActive] = React.useState(0);
  const onActive = React.useCallback((i: number) => setActive(i), []);
  const story = STORIES[active] ?? STORIES[0]!;

  return (
    <section
      id="stories"
      className="scroll-mt-24 border-t border-hairline py-28 sm:py-36"
    >
      <Container>
        <Reveal className="max-w-2xl">
          <Eyebrow>In real life</Eyebrow>
          <Heading className="mt-4">Capture now. It comes back later.</Heading>
          <Lede className="mt-6">
            The moment you want to remember something is never the moment you
            want to organise it.
          </Lede>
        </Reveal>

        <div className="mt-16 grid gap-16 lg:mt-24 lg:grid-cols-12 lg:gap-12">
          <div className="min-w-0 space-y-24 lg:col-span-6 lg:space-y-0">
            {STORIES.map((s, i) => (
              <StoryText key={s.id} story={s} index={i} onActive={onActive} />
            ))}
          </div>

          <div className="hidden lg:col-span-6 lg:block">
            <div className="sticky top-32 mx-auto max-w-md">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={story.id}
                  initial={reduce ? false : { opacity: 0, y: 14, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, y: -10 }}
                  transition={{ duration: 0.4, ease: EASE }}
                >
                  <StoryVisual story={story} />
                </motion.div>
              </AnimatePresence>
              <div className="mt-6 flex gap-1.5" aria-hidden>
                {STORIES.map((s, i) => (
                  <span
                    key={s.id}
                    className={cn(
                      "h-1 rounded-full transition-all duration-500",
                      i === active ? "w-8 bg-ember" : "w-3 bg-hairline-strong",
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
