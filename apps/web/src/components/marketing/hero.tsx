"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ArrowRight, Camera, Mic, Paperclip } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

import { HERO_FRAGMENTS, HERO_PROMPT } from "./content";
import {
  Container,
  ContextTags,
  EASE,
  FragmentCard,
  Heading,
  Lede,
  useTypewriter,
} from "./primitives";

/**
 * Where each fragment sits on the wide stage, and a bezier from it toward the
 * composer. Coordinates are percentages of the stage so the composition holds
 * across widths; below `lg` the stage is replaced by a vertical list.
 */
const PLACEMENTS: Record<
  string,
  { className: string; path: string; float: number }
> = {
  "voice-marco": {
    className: "left-0 top-[6%] w-64",
    path: "M 16 22 C 30 22, 36 44, 44 46",
    float: 6,
  },
  "thought-onboarding": {
    className: "right-0 top-[2%] w-60",
    path: "M 84 16 C 74 18, 64 40, 56 45",
    float: 5,
  },
  "file-blood": {
    className: "left-[2%] bottom-[8%] w-64",
    path: "M 18 78 C 30 76, 36 58, 44 54",
    float: 7,
  },
  "photo-receipt": {
    className: "right-[3%] bottom-[2%] w-56",
    path: "M 82 82 C 72 80, 64 60, 56 55",
    float: 5,
  },
  "place-ikea": {
    className: "left-1/2 top-0 w-56 -translate-x-[110%]",
    path: "M 40 10 C 42 20, 46 30, 49 40",
    float: 4,
  },
};

const UNDERSTOOD = [
  { type: "time" as const, label: "Tomorrow · 09:00" },
  { type: "person" as const, label: "Marco" },
  { type: "topic" as const, label: "Apartment" },
];

function Composer({ className }: { className?: string }) {
  const [active, setActive] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setActive(true), 500);
    return () => clearTimeout(t);
  }, []);
  const { shown, done } = useTypewriter(HERO_PROMPT, active, {
    startDelay: 400,
    speed: 30,
  });

  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[34rem] rounded-xl border border-hairline-strong bg-canvas p-2 shadow-[0_1px_2px_rgb(15_20_25/0.05),0_24px_64px_-24px_rgb(0_82_204/0.25)]",
        done && "border-[rgb(var(--ember)/0.45)]",
        className,
      )}
      aria-live="polite"
    >
      <div className="rounded-lg px-4 pt-4 pb-3">
        <p className="min-h-[3.5rem] text-[1.0625rem] leading-7 text-foreground sm:text-lg">
          {shown.length === 0 ? (
            <span className="text-subtle">What do you want to remember?</span>
          ) : (
            <span className={cn(!done && "landing-caret")}>{shown}</span>
          )}
        </p>
        <div className="mt-3 flex min-h-7 items-center gap-2">
          <ContextTags tags={UNDERSTOOD} active={done} baseDelay={0.2} />
        </div>
      </div>
      <div className="flex items-center gap-1 border-t border-hairline px-2 pt-2">
        {[
          { Icon: Mic, label: "Record" },
          { Icon: Camera, label: "Photo" },
          { Icon: Paperclip, label: "Attach" },
        ].map(({ Icon, label }) => (
          <span
            key={label}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted"
            aria-label={label}
            role="img"
          >
            <Icon className="size-4" />
          </span>
        ))}
        <span
          className={cn(
            "ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-300",
            done ? "bg-ember text-white" : "bg-surface-strong text-subtle",
          )}
        >
          {done ? "Understood" : "Save"}
        </span>
      </div>
    </div>
  );
}

function FloatingFragment({
  id,
  children,
  float,
  className,
  delay,
}: {
  id: string;
  children: React.ReactNode;
  float: number;
  className: string;
  delay: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cn("absolute", className)}
      initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      <motion.div
        animate={reduce ? undefined : { y: [0, -float, 0] }}
        transition={{
          duration: 6 + float * 0.4,
          repeat: Infinity,
          ease: "easeInOut",
          delay: delay * 2,
        }}
        data-fragment={id}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const [connected, setConnected] = React.useState(false);
  React.useEffect(() => {
    // Lines and per-fragment context arrive after the composer has "understood".
    const t = setTimeout(() => setConnected(true), reduce ? 0 : 3400);
    return () => clearTimeout(t);
  }, [reduce]);

  return (
    <section className="relative overflow-hidden pt-32 sm:pt-40" id="top">
      <div
        aria-hidden
        className="landing-grid pointer-events-none absolute inset-x-0 top-0 h-[42rem]"
      />
      <Container className="relative">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="text-sm font-medium text-ember"
          >
            Your memory, extended
          </motion.p>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.05, ease: EASE }}
          >
            <Heading as="h1" className="mt-5">
              You capture.
              <br />
              <span className="text-ember">Lictory remembers.</span>
            </Heading>
          </motion.div>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
          >
            <Lede className="mt-7 max-w-xl">
              Say it, snap it, or drop it in. Lictory works out who it&apos;s
              about, where, and when — then connects it to everything else
              you&apos;ve saved, so it comes back when it matters.
            </Lede>
          </motion.div>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25, ease: EASE }}
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
          >
            <Button variant="primary" size="lg" asChild>
              <Link href="/login">
                Start remembering <ArrowRight />
              </Link>
            </Button>
            <Button variant="ghost" size="lg" asChild>
              <a href="#how-it-works">See how it works</a>
            </Button>
          </motion.div>
        </div>

        {/* Wide stage */}
        <div
          className="relative mx-auto mt-20 hidden h-[34rem] max-w-[68rem] lg:block"
          data-inview={connected ? "true" : "false"}
        >
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {HERO_FRAGMENTS.map((f, i) => {
              const p = PLACEMENTS[f.id];
              if (!p) return null;
              return (
                <path
                  key={f.id}
                  d={p.path}
                  pathLength={1}
                  className="draw-line"
                  fill="none"
                  stroke="rgb(var(--ember) / 0.4)"
                  strokeWidth={1.25}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ transitionDelay: `${i * 140}ms` }}
                />
              );
            })}
          </svg>

          {HERO_FRAGMENTS.map((f, i) => {
            const p = PLACEMENTS[f.id];
            if (!p) return null;
            return (
              <FloatingFragment
                key={f.id}
                id={f.id}
                className={p.className}
                float={p.float}
                delay={0.5 + i * 0.12}
              >
                <FragmentCard fragment={f} showContext={false} />
                <div className="mt-2 min-h-7 pl-1">
                  <ContextTags
                    tags={f.context}
                    active={connected}
                    baseDelay={0.3 + i * 0.15}
                  />
                </div>
              </FloatingFragment>
            );
          })}

          <motion.div
            className="absolute left-1/2 top-1/2 w-full -translate-x-1/2 -translate-y-1/2 px-4"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35, ease: EASE }}
          >
            <Composer />
          </motion.div>
        </div>

        {/* Narrow stage */}
        <div className="mt-14 lg:hidden">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35, ease: EASE }}
          >
            <Composer />
          </motion.div>
          <ul className="relative mx-auto mt-8 flex max-w-[34rem] flex-col gap-3 pl-6">
            <span
              aria-hidden
              className="absolute bottom-6 left-[0.6875rem] top-0 w-px bg-gradient-to-b from-[rgb(var(--ember)/0.5)] to-transparent"
            />
            {HERO_FRAGMENTS.slice(0, 3).map((f, i) => (
              <motion.li
                key={f.id}
                className="relative"
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.7,
                  delay: 0.6 + i * 0.12,
                  ease: EASE,
                }}
              >
                <span
                  aria-hidden
                  className="absolute -left-[1.0625rem] top-5 size-2 rounded-full border border-canvas bg-ember"
                />
                <FragmentCard fragment={f} showContext={connected} />
              </motion.li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
