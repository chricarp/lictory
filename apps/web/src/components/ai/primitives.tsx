"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*                                 Shimmer text                               */
/* -------------------------------------------------------------------------- */

/**
 * The "model is thinking" treatment: a light sweep travelling across the glyphs
 * themselves rather than a spinner beside them.
 */
export function ShimmerText({
  children,
  className,
  active = true,
}: {
  children: React.ReactNode;
  className?: string;
  active?: boolean;
}) {
  if (!active) return <span className={className}>{children}</span>;
  return (
    <span
      className={cn(
        "animate-shimmer bg-[length:200%_100%] bg-clip-text text-transparent",
        className,
      )}
      style={{
        backgroundImage:
          "linear-gradient(90deg, rgb(var(--subtle-foreground)) 0%, rgb(var(--subtle-foreground)) 35%, rgb(var(--ember-bright)) 50%, rgb(var(--subtle-foreground)) 65%, rgb(var(--subtle-foreground)) 100%)",
      }}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Scanning beam                               */
/* -------------------------------------------------------------------------- */

/** A light bar sweeping across a container while it is being analysed. */
export function ScanBeam({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]",
        className,
      )}
    >
      <span className="animate-beam absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[rgb(var(--ember)/0.16)] to-transparent" />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Status orb                                 */
/* -------------------------------------------------------------------------- */

export type OrbState = "idle" | "queued" | "thinking" | "ready" | "failed";

const ORB_COLOR: Record<OrbState, string> = {
  idle: "var(--subtle-foreground)",
  queued: "var(--warning)",
  thinking: "var(--ember)",
  ready: "var(--success)",
  failed: "var(--danger)",
};

export function StatusOrb({
  state,
  size = 10,
  className,
}: {
  state: OrbState;
  size?: number;
  className?: string;
}) {
  const animated = state === "thinking" || state === "queued";
  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {animated ? (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: `rgb(${ORB_COLOR[state]})` }}
          animate={{ scale: [1, 2.4, 1], opacity: [0.55, 0, 0.55] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <span
        className="relative inline-block size-full rounded-full"
        style={{
          background: `rgb(${ORB_COLOR[state]})`,
          boxShadow: `0 0 12px rgb(${ORB_COLOR[state]} / 0.7)`,
        }}
      />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Thinking dots                                */
/* -------------------------------------------------------------------------- */

export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      aria-hidden
    >
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="size-1 rounded-full bg-ember"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            delay: index * 0.16,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Streaming reveal                              */
/* -------------------------------------------------------------------------- */

/**
 * Reveals AI-authored prose word by word so a summary arriving after a wait
 * reads as something that was just written rather than something that popped in.
 */
export function StreamingText({
  text,
  className,
  speed = 22,
}: {
  text: string;
  className?: string;
  speed?: number;
}) {
  const reduceMotion = useReducedMotion();
  const words = React.useMemo(() => text.split(/(\s+)/), [text]);

  // Resetting during render (rather than in an effect) avoids a frame where the
  // previous summary is still visible under the new one.
  const [reveal, setReveal] = React.useState({ text, visible: 0 });
  if (reveal.text !== text) {
    setReveal({ text, visible: reduceMotion ? words.length : 0 });
  }
  const visible = reduceMotion ? words.length : reveal.visible;

  React.useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(() => {
      setReveal((current) => {
        if (current.text !== text) return current;
        if (current.visible >= words.length) return current;
        return { ...current, visible: current.visible + 1 };
      });
    }, speed);
    return () => clearInterval(timer);
  }, [text, words.length, speed, reduceMotion]);

  return (
    <span className={className}>
      {words.slice(0, visible).map((word, index) => (
        <motion.span
          key={`${index}-${word}`}
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.28 }}
        >
          {word}
        </motion.span>
      ))}
      {visible < words.length ? (
        <motion.span
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-ember"
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.9, repeat: Infinity }}
        />
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Staggered entity reveal                           */
/* -------------------------------------------------------------------------- */

/**
 * Extracted entities land one after another with a spring, which makes the
 * moment the AI "figures something out" legible and a little celebratory.
 */
export function RevealStagger({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: 0.05, delayChildren: delay },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      // Reveal items live in wrapping flex rows. A flex item defaults to
      // min-width: auto, so without these the wrapper grows to its content's
      // intrinsic width and any truncation inside it never engages.
      className={cn("min-w-0 max-w-full", className)}
      variants={{
        hidden: { opacity: 0, y: 8, scale: 0.94 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { type: "spring", stiffness: 520, damping: 26 },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Animated counter                              */
/* -------------------------------------------------------------------------- */

export function AnimatedNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-block tabular-nums", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "-70%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "70%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
