"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import * as React from "react";

import { FileText, Search } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

import { FILING_NEW, FILING_OLD, FOLDER_TREE } from "./content";
import {
  Container,
  ContextTag,
  EASE,
  Eyebrow,
  Heading,
  Lede,
  Reveal,
} from "./primitives";

function FolderGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-3.5", className)} aria-hidden>
      <path
        d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3.2l1.5 1.5H13A1.5 1.5 0 0 1 14.5 6v5.5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-7Z"
        fill="currentColor"
        opacity="0.55"
      />
    </svg>
  );
}

export function NoFiling() {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.45 });

  return (
    <section
      id="philosophy"
      className="scroll-mt-24 border-t border-hairline py-28 sm:py-36"
    >
      <Container>
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow className="justify-center">The part you skip</Eyebrow>
          <Heading className="mt-4">Stop organising your memory.</Heading>
          <Lede className="mt-6">
            Every other tool asks you to structure things before you can find
            them again. Lictory does the structuring. You just save.
          </Lede>
        </Reveal>

        <div
          ref={ref}
          className="mx-auto mt-16 grid max-w-5xl gap-6 md:grid-cols-[1fr_auto_1fr] md:items-center"
        >
          {/* Before */}
          <Reveal className="rounded-xl border border-hairline bg-canvas-raised p-5 sm:p-6">
            <p className="text-[0.75rem] font-medium text-subtle">
              Where things end up
            </p>
            <ul className="mt-4 space-y-1 font-mono text-[0.8125rem] leading-6 text-muted">
              {FOLDER_TREE.map((row, i) => (
                <motion.li
                  key={`${row.label}-${i}`}
                  style={{ paddingLeft: `${row.depth * 1.1}rem` }}
                  className="flex items-center gap-2"
                  initial={reduce ? false : { opacity: 1 }}
                  animate={
                    inView && !reduce
                      ? { opacity: row.file ? 0.9 : 0.45 }
                      : undefined
                  }
                  transition={{ delay: 1 + i * 0.05, duration: 0.6 }}
                >
                  {row.file ? (
                    <FileText className="size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <FolderGlyph className="shrink-0" />
                  )}
                  <span
                    className={cn(
                      "truncate",
                      row.file &&
                        row.label.includes("FINAL") &&
                        "text-foreground",
                    )}
                  >
                    {row.label}
                  </span>
                </motion.li>
              ))}
            </ul>
            <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-subtle">
              {FILING_OLD.map((w) => (
                <li key={w} className="line-through decoration-hairline-strong">
                  {w}
                </li>
              ))}
            </ul>
          </Reveal>

          {/* Arrow */}
          <div
            className="flex items-center justify-center md:h-full"
            aria-hidden
          >
            <motion.svg
              viewBox="0 0 48 24"
              className="h-6 w-12 rotate-90 text-ember md:rotate-0"
              initial={reduce ? false : { opacity: 0 }}
              animate={inView ? { opacity: 1 } : undefined}
              transition={{ delay: 0.5, duration: 0.5 }}
            >
              <motion.path
                d="M2 12h42M34 4l10 8-10 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduce ? false : { pathLength: 0 }}
                animate={inView ? { pathLength: 1 } : undefined}
                transition={{ delay: 0.6, duration: 0.8, ease: EASE }}
              />
            </motion.svg>
          </div>

          {/* After */}
          <Reveal
            className="rounded-xl border border-hairline-strong bg-canvas p-5 shadow-[0_1px_2px_rgb(15_20_25/0.05),0_24px_64px_-32px_rgb(0_82_204/0.25)] sm:p-6"
            delay={0.1}
          >
            <p className="text-[0.75rem] font-medium text-subtle">
              Where you find them
            </p>
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-hairline px-3.5 py-3">
              <Search className="size-4 text-ember" aria-hidden />
              <span className="text-[0.9375rem]">blood test february</span>
            </div>
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{
                delay: reduce ? 0 : 1.4,
                duration: 0.5,
                ease: EASE,
              }}
              className="mt-3 flex items-start gap-3 rounded-lg bg-surface p-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-hairline bg-canvas text-ember">
                <FileText className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[0.9375rem] font-medium">
                  Blood Tests — February 2026
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <ContextTag
                    tag={{ type: "topic", label: "Health" }}
                    size="sm"
                  />
                  <ContextTag
                    tag={{ type: "time", label: "12 Feb" }}
                    size="sm"
                  />
                  <ContextTag
                    tag={{ type: "person", label: "Dr. Rossi" }}
                    size="sm"
                  />
                </div>
              </div>
            </motion.div>
            <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] font-medium text-foreground">
              {FILING_NEW.map((w, i) => (
                <li key={w} className="flex items-center gap-2">
                  {i > 0 ? (
                    <span className="text-subtle" aria-hidden>
                      →
                    </span>
                  ) : null}
                  {w}
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
