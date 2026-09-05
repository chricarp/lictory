"use client";

import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from "motion/react";
import * as React from "react";

import { ArrowRight, Search } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

import { SEARCH_EXAMPLES } from "./content";
import {
  Container,
  ContextTag,
  EASE,
  Eyebrow,
  Heading,
  KIND_ICON,
  Lede,
  Reveal,
  useTypewriter,
} from "./primitives";

const CYCLE_MS = 7000;

export function SearchDemo() {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const [index, setIndex] = React.useState(0);
  const [pinned, setPinned] = React.useState(false);
  const example = SEARCH_EXAMPLES[index] ?? SEARCH_EXAMPLES[0]!;
  const { shown, done } = useTypewriter(example.query, inView, {
    speed: 28,
    startDelay: 500,
  });

  React.useEffect(() => {
    if (!inView || pinned || reduce) return;
    const t = setInterval(
      () => setIndex((i) => (i + 1) % SEARCH_EXAMPLES.length),
      CYCLE_MS,
    );
    return () => clearInterval(t);
  }, [inView, pinned, reduce]);

  return (
    <section
      id="how-it-works"
      className="scroll-mt-24 border-t border-hairline bg-canvas-raised py-28 sm:py-36"
    >
      <Container>
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow className="justify-center">Then, when it matters</Eyebrow>
          <Heading className="mt-4">Saving is only half the problem.</Heading>
          <Lede className="mt-6">
            You shouldn&apos;t need to remember where you put something, or what
            you called it. Ask the way you&apos;d ask a friend.
          </Lede>
        </Reveal>

        <Reveal className="mx-auto mt-14 max-w-3xl" delay={0.1}>
          <div
            ref={ref}
            className="overflow-hidden rounded-xl border border-hairline-strong bg-canvas shadow-[0_1px_2px_rgb(15_20_25/0.05),0_32px_80px_-32px_rgb(15_20_25/0.2)]"
          >
            <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
              <Search className="size-5 shrink-0 text-ember" aria-hidden />
              <p
                className="min-h-7 flex-1 truncate text-[1.0625rem] text-foreground sm:text-lg"
                aria-live="polite"
              >
                {shown.length === 0 ? (
                  <span className="text-subtle">Ask your memory anything</span>
                ) : (
                  <span className={cn(!done && "landing-caret")}>{shown}</span>
                )}
              </p>
              <kbd className="hidden rounded-sm border border-hairline px-1.5 py-0.5 font-mono text-[0.6875rem] text-subtle sm:block">
                ⌘K
              </kbd>
            </div>

            <div className="min-h-[15rem] p-3">
              <AnimatePresence mode="wait" initial={false}>
                {done ? (
                  <motion.ul
                    key={example.query}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduce ? undefined : { opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-1"
                  >
                    {example.results.map((r, i) => {
                      const Icon = KIND_ICON[r.kind];
                      return (
                        <motion.li
                          key={r.title}
                          initial={reduce ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.4,
                            delay: reduce ? 0 : 0.25 + i * 0.12,
                            ease: EASE,
                          }}
                          className={cn(
                            "group flex items-start gap-3 rounded-lg p-3",
                            i === 0 && "bg-surface",
                          )}
                        >
                          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-hairline bg-canvas text-ember">
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-[0.9375rem] font-medium text-foreground">
                                {r.title}
                              </p>
                              {i === 0 ? (
                                <ArrowRight
                                  className="ml-auto size-4 shrink-0 text-subtle"
                                  aria-hidden
                                />
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                              <span className="text-[0.8125rem] text-muted">
                                {r.detail}
                              </span>
                              <span className="flex flex-wrap gap-1">
                                {r.context.map((tag) => (
                                  <ContextTag
                                    key={tag.label}
                                    tag={tag}
                                    size="sm"
                                  />
                                ))}
                              </span>
                            </div>
                          </div>
                        </motion.li>
                      );
                    })}
                  </motion.ul>
                ) : (
                  <motion.div
                    key="thinking"
                    initial={false}
                    exit={{ opacity: 0 }}
                    className="flex h-[15rem] flex-col items-center justify-center gap-3 text-sm text-subtle"
                  >
                    <span className="flex gap-1" aria-hidden>
                      {[0, 1, 2].map((d) => (
                        <span
                          key={d}
                          className="size-1.5 animate-breathe rounded-full bg-ember/60"
                          style={{ animationDelay: `${d * 200}ms` }}
                        />
                      ))}
                    </span>
                    Reading your notes, files and recordings
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <ul className="mt-6 flex flex-wrap justify-center gap-2">
            {SEARCH_EXAMPLES.map((ex, i) => (
              <li key={ex.query}>
                <button
                  type="button"
                  onClick={() => {
                    setIndex(i);
                    setPinned(true);
                  }}
                  aria-pressed={i === index}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-[0.8125rem] transition-colors",
                    i === index
                      ? "border-[rgb(var(--ember)/0.4)] bg-[rgb(var(--ember)/0.06)] text-ember"
                      : "border-hairline text-muted hover:border-hairline-strong hover:text-foreground",
                  )}
                >
                  {ex.query}
                </button>
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </section>
  );
}
