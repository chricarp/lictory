"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import * as React from "react";

import { CONTEXT_DERIVED, CONTEXT_SENTENCE } from "./content";
import {
  Container,
  ContextTag,
  EASE,
  Eyebrow,
  Heading,
  Lede,
  Reveal,
  typeColor,
} from "./primitives";

const FACETS = [
  {
    label: "Time",
    body: "“Tomorrow morning” becomes a real moment — and a reminder, if you want one.",
  },
  {
    label: "Place",
    body: "“When I'm near IKEA” becomes a location that surfaces the note on arrival.",
  },
  {
    label: "People",
    body: "Marco is one person across every note he appears in, not a different string each time.",
  },
  {
    label: "Related notes",
    body: "The itinerary Marco sent is already linked. You never had to say so.",
  },
];

/** An entity span: underline in the type's colour, sweeping in from the left. */
function Highlight({
  text,
  color,
  delay,
  show,
}: {
  text: string;
  color: string;
  delay: number;
  show: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <span className="relative inline whitespace-pre-wrap">
      <motion.span
        aria-hidden
        className="absolute inset-x-0 -bottom-0.5 h-[2px] origin-left rounded-full"
        style={{ backgroundColor: color }}
        initial={reduce ? false : { scaleX: 0 }}
        animate={show ? { scaleX: 1 } : undefined}
        transition={{ duration: 0.5, delay, ease: EASE }}
      />
      <motion.span
        aria-hidden
        className="absolute -inset-x-0.5 -inset-y-0.5 -z-10 origin-left rounded-sm"
        style={{ backgroundColor: color, opacity: 0.1 }}
        initial={reduce ? false : { scaleX: 0 }}
        animate={show ? { scaleX: 1 } : undefined}
        transition={{ duration: 0.5, delay, ease: EASE }}
      />
      <span className="relative">{text}</span>
    </span>
  );
}

export function AutomaticContext() {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });

  return (
    <section className="border-t border-hairline bg-canvas-raised py-28 sm:py-36">
      <Container>
        <Reveal className="max-w-2xl">
          <Eyebrow>Context you didn&apos;t type</Eyebrow>
          <Heading className="mt-4">
            It understands more than the words.
          </Heading>
          <Lede className="mt-6">
            When something matters, where it matters, who it involves and what
            it belongs with — Lictory reads all of it out of an ordinary
            sentence.
          </Lede>
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-12 lg:gap-12">
          <Reveal className="min-w-0 lg:col-span-7" delay={0.05}>
            <div
              ref={ref}
              className="rounded-xl border border-hairline bg-canvas p-6 shadow-[0_1px_2px_rgb(15_20_25/0.04),0_24px_64px_-32px_rgb(15_20_25/0.16)] sm:p-8"
            >
              <p className="text-[0.75rem] font-medium text-subtle">
                Note · Just now
              </p>
              <p className="relative mt-4 text-xl leading-9 tracking-[-0.01em] text-foreground sm:text-2xl sm:leading-10">
                {CONTEXT_SENTENCE.map((part, i) =>
                  part.type ? (
                    <Highlight
                      key={i}
                      text={part.text}
                      color={typeColor(part.type)}
                      delay={reduce ? 0 : 0.4 + i * 0.14}
                      show={inView}
                    />
                  ) : (
                    <React.Fragment key={i}>{part.text}</React.Fragment>
                  ),
                )}
              </p>

              <ul className="mt-8 grid gap-2 sm:grid-cols-2">
                {CONTEXT_DERIVED.map((d, i) => (
                  <motion.li
                    key={d.label}
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={inView ? { opacity: 1, y: 0 } : undefined}
                    transition={{
                      duration: 0.45,
                      delay: reduce ? 0 : 1.5 + i * 0.12,
                      ease: EASE,
                    }}
                    className="flex flex-col gap-2 rounded-lg border border-hairline p-3"
                  >
                    <ContextTag
                      tag={{ type: d.type, label: d.label }}
                      className="self-start"
                    />
                    <span className="text-[0.8125rem] leading-5 text-muted">
                      {d.detail}
                    </span>
                  </motion.li>
                ))}
              </ul>
            </div>
          </Reveal>

          <div className="min-w-0 lg:col-span-5 lg:pt-2">
            <ul className="divide-y divide-hairline">
              {FACETS.map((f, i) => (
                <Reveal
                  as="li"
                  key={f.label}
                  delay={0.1 + i * 0.06}
                  className="py-5 first:pt-0"
                >
                  <p className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                    {f.label}
                  </p>
                  <p className="mt-1 text-[0.9375rem] leading-6 text-muted">
                    {f.body}
                  </p>
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}
