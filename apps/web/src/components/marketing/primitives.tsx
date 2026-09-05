"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import * as React from "react";

import {
  AudioLines,
  BellRing,
  Building2,
  CalendarClock,
  FileText,
  Hash,
  ImageIcon,
  Link2,
  MapPin,
  PenLine,
  StickyNote,
  UserRound,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";

import type {
  ContextTag as ContextTagData,
  ContextType,
  Fragment,
  FragmentKind,
} from "./content";
import { KIND_LABEL } from "./content";

/* --------------------------------------------------------------------------
 * Brand
 * ------------------------------------------------------------------------ */

/**
 * The mark is three fragments joined into one shape: the same idea the page
 * spends its length explaining. Geometric so it survives at 16px.
 */
export function LictoryMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("size-8 shrink-0", className)}
    >
      <rect width="32" height="32" rx="8" fill="rgb(var(--ember))" />
      <path
        d="M10 9v14h12"
        fill="none"
        stroke="white"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <circle cx="10" cy="9" r="2.6" fill="white" />
      <circle cx="10" cy="23" r="2.6" fill="white" />
      <circle cx="22" cy="23" r="2.6" fill="white" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LictoryMark />
      <span className="text-[1.05rem] font-semibold tracking-[-0.03em] text-foreground">
        Lictory
      </span>
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Layout
 * ------------------------------------------------------------------------ */

export function Container({
  className,
  children,
  size = "wide",
}: {
  className?: string;
  children: React.ReactNode;
  size?: "narrow" | "prose" | "wide";
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-5 sm:px-8",
        size === "wide" && "max-w-[80rem]",
        size === "narrow" && "max-w-4xl",
        size === "prose" && "max-w-2xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-[0.8125rem] font-medium tracking-[-0.005em] text-ember",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-ember" aria-hidden />
      {children}
    </p>
  );
}

export function Heading({
  as: Tag = "h2",
  children,
  className,
}: {
  as?: "h1" | "h2" | "h3";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        "text-balance font-semibold leading-[1.05] tracking-[-0.035em] text-foreground",
        Tag === "h1" && "text-[2.75rem] sm:text-6xl lg:text-[4.5rem]",
        Tag === "h2" && "text-[2rem] sm:text-[2.75rem] lg:text-[3.25rem]",
        Tag === "h3" && "text-2xl sm:text-3xl",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function Lede({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-pretty text-lg leading-8 text-muted sm:text-xl sm:leading-9",
        className,
      )}
    >
      {children}
    </p>
  );
}

/* --------------------------------------------------------------------------
 * Motion
 * ------------------------------------------------------------------------ */

const EASE = [0.22, 1, 0.36, 1] as const;

/** Fade-and-lift once when scrolled into view. Static under reduced motion. */
export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "li" | "section" | "header" | "p";
}) {
  const reduce = useReducedMotion();
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </Comp>
  );
}

/**
 * Marks a subtree with `data-inview` once it has been seen, so purely CSS
 * effects (line drawing) can key off it without per-element observers.
 */
export function InViewGroup({
  children,
  className,
  margin = "-20% 0px",
}: {
  children: React.ReactNode;
  className?: string;
  margin?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, {
    once: true,
    margin: margin as never,
  });
  return (
    <div
      ref={ref}
      className={className}
      data-inview={inView ? "true" : "false"}
    >
      {children}
    </div>
  );
}

/**
 * Reveals `text` one character at a time once `active` is true. Under reduced
 * motion the whole string is shown immediately.
 */
export function useTypewriter(
  text: string,
  active: boolean,
  options: { speed?: number; startDelay?: number } = {},
) {
  const reduce = useReducedMotion() === true;
  const { speed = 34, startDelay = 0 } = options;
  const [count, setCount] = React.useState(0);
  const [key, setKey] = React.useState(text);

  // Reset derived state during render when the target string changes.
  if (key !== text) {
    setKey(text);
    setCount(0);
  }

  React.useEffect(() => {
    if (!active || reduce) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = (i: number) => {
      if (cancelled) return;
      // The timer itself is the async boundary, so this is not a
      // synchronous set-state-in-effect.
      timer = setTimeout(
        () => {
          setCount(i);
          if (i < text.length) tick(i + 1);
        },
        i === 0 ? startDelay : speed,
      );
    };
    tick(1);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, reduce, text, speed, startDelay]);

  if (reduce || !active) return { shown: reduce ? text : "", done: reduce };
  return { shown: text.slice(0, count), done: count >= text.length };
}

/* --------------------------------------------------------------------------
 * Context language
 * ------------------------------------------------------------------------ */

export const KIND_ICON: Record<FragmentKind | "note", React.ElementType> = {
  voice: AudioLines,
  text: PenLine,
  photo: ImageIcon,
  file: FileText,
  link: Link2,
  location: MapPin,
  person: UserRound,
  reminder: BellRing,
  note: StickyNote,
};

const TYPE_ICON: Record<ContextType, React.ElementType> = {
  person: UserRound,
  place: MapPin,
  time: CalendarClock,
  topic: Hash,
  organization: Building2,
  note: StickyNote,
};

const TYPE_VAR: Record<ContextType, string> = {
  person: "--entity-person",
  place: "--entity-place",
  time: "--entity-time",
  topic: "--entity-topic",
  organization: "--entity-organization",
  note: "--ember",
};

export function typeColor(type: ContextType) {
  return `rgb(var(${TYPE_VAR[type]}))`;
}

/**
 * One coloured tag per entity type. The icon carries the meaning too, so
 * colour is never the only signal.
 */
export function ContextTag({
  tag,
  className,
  size = "md",
}: {
  tag: ContextTagData;
  className?: string;
  size?: "sm" | "md";
}) {
  const Icon = TYPE_ICON[tag.type];
  const v = TYPE_VAR[tag.type];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border font-medium tracking-[-0.01em]",
        size === "md"
          ? "h-7 px-2 text-[0.75rem]"
          : "h-6 px-1.5 text-[0.6875rem]",
        className,
      )}
      style={{
        color: `rgb(var(${v}))`,
        borderColor: `rgb(var(${v}) / 0.28)`,
        backgroundColor: `rgb(var(${v}) / 0.07)`,
      }}
    >
      <Icon className={size === "md" ? "size-3.5" : "size-3"} aria-hidden />
      <span className="truncate">{tag.label}</span>
    </span>
  );
}

export function KindBadge({
  kind,
  className,
}: {
  kind: FragmentKind | "note";
  className?: string;
}) {
  const Icon = KIND_ICON[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-subtle",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {kind === "note" ? "Note" : KIND_LABEL[kind]}
    </span>
  );
}

/** Decorative waveform. Bars are deterministic so SSR and client agree. */
export function Waveform({
  bars = 28,
  active = false,
  className,
}: {
  bars?: number;
  active?: boolean;
  className?: string;
}) {
  const heights = React.useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => {
        const t = i / bars;
        const env = Math.sin(t * Math.PI);
        const wobble = Math.sin(i * 2.3) * 0.25 + Math.cos(i * 0.9) * 0.2;
        return Math.max(0.15, Math.min(1, env * (0.7 + wobble)));
      }),
    [bars],
  );
  return (
    <span
      className={cn("flex h-8 items-center gap-[3px]", className)}
      aria-hidden
    >
      {heights.map((h, i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-ember/80",
            active && "animate-breathe",
          )}
          style={{
            height: `${Math.round(h * 100)}%`,
            animationDelay: active ? `${(i % 7) * 120}ms` : undefined,
          }}
        />
      ))}
    </span>
  );
}

/** A small, faux photo. Pure CSS so nothing needs to load. */
export function PhotoSwatch({
  className,
  variant = "receipt",
}: {
  className?: string;
  variant?: "receipt" | "whiteboard";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block overflow-hidden rounded-md border border-hairline",
        className,
      )}
      style={{
        background:
          variant === "receipt"
            ? "linear-gradient(160deg, #f4efe6 0%, #e9e2d6 100%)"
            : "linear-gradient(160deg, #eef1f5 0%, #dfe4ea 100%)",
      }}
    >
      {variant === "receipt" ? (
        <span className="absolute inset-x-[22%] top-[14%] flex flex-col gap-[7%]">
          {[70, 100, 85, 60, 95, 45].map((w, i) => (
            <span
              key={i}
              className="block h-[3px] rounded-full bg-[#8e857a]/50"
              style={{ width: `${w}%` }}
            />
          ))}
        </span>
      ) : (
        <span className="absolute inset-[16%] rounded-sm border border-[#b7bfc9]/70 bg-white/70">
          <span className="absolute left-[12%] top-[20%] h-[3px] w-[55%] rounded-full bg-[#0052cc]/60" />
          <span className="absolute left-[12%] top-[45%] h-[3px] w-[40%] rounded-full bg-[#4b5563]/40" />
          <span className="absolute left-[12%] top-[70%] h-[3px] w-[62%] rounded-full bg-[#4b5563]/40" />
        </span>
      )}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Fragment card — the recurring unit of the page
 * ------------------------------------------------------------------------ */

export function FragmentCard({
  fragment,
  showContext = true,
  className,
  compact = false,
}: {
  fragment: Fragment;
  showContext?: boolean;
  className?: string;
  compact?: boolean;
}) {
  return (
    <article
      className={cn(
        "rounded-lg border border-hairline bg-canvas p-3.5 text-left shadow-[0_1px_2px_rgb(15_20_25/0.04),0_12px_32px_-16px_rgb(15_20_25/0.12)]",
        compact ? "w-56" : "w-full",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <KindBadge kind={fragment.kind} />
        {fragment.meta ? (
          <span className="font-mono text-[0.6875rem] text-subtle">
            {fragment.meta}
          </span>
        ) : null}
      </div>
      {fragment.kind === "photo" ? (
        <PhotoSwatch
          className="mt-3 aspect-[4/3] w-full"
          variant={
            fragment.meta?.includes("Whiteboard") ? "whiteboard" : "receipt"
          }
        />
      ) : null}
      {fragment.kind === "voice" ? <Waveform className="mt-3" /> : null}
      <p
        className={cn(
          "mt-2.5 text-[0.9375rem] leading-6 text-foreground",
          fragment.kind === "file" && "truncate font-medium",
        )}
      >
        {fragment.kind === "file" || fragment.kind === "location"
          ? fragment.title
          : fragment.body}
      </p>
      {fragment.kind === "location" && fragment.body ? (
        <p className="mt-0.5 text-sm text-muted">{fragment.body}</p>
      ) : null}
      {showContext && fragment.context.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {fragment.context.map((tag) => (
            <ContextTag key={tag.label} tag={tag} size="sm" />
          ))}
        </div>
      ) : null}
    </article>
  );
}

/** Staggered appearance for a list of context tags. */
export function ContextTags({
  tags,
  active,
  className,
  baseDelay = 0,
}: {
  tags: ContextTagData[];
  active: boolean;
  className?: string;
  baseDelay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.map((tag, i) => (
        <motion.span
          key={tag.label}
          initial={reduce ? false : { opacity: 0, y: 6, filter: "blur(3px)" }}
          animate={
            active
              ? { opacity: 1, y: 0, filter: "blur(0px)" }
              : { opacity: 0, y: 6, filter: "blur(3px)" }
          }
          transition={{
            duration: 0.45,
            delay: baseDelay + i * 0.12,
            ease: EASE,
          }}
        >
          <ContextTag tag={tag} />
        </motion.span>
      ))}
    </div>
  );
}

export { EASE };
