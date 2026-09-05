"use client";

import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

import { CAPTURE_MODES, type CaptureMode } from "./content";
import {
  Container,
  ContextTags,
  EASE,
  Eyebrow,
  Heading,
  KIND_ICON,
  Lede,
  PhotoSwatch,
  Reveal,
  Waveform,
  useTypewriter,
} from "./primitives";

const AUTO_ADVANCE_MS = 4600;

function InputPreview({
  mode,
  active,
}: {
  mode: CaptureMode;
  active: boolean;
}) {
  const { shown } = useTypewriter(
    mode.input.body,
    active && mode.id !== "photo",
    {
      speed: 18,
      startDelay: 250,
    },
  );
  const Icon = KIND_ICON[mode.id];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 text-[0.8125rem] font-medium text-subtle">
        <Icon className="size-4" aria-hidden />
        {mode.input.title}
        {mode.input.meta ? (
          <span className="ml-auto font-mono text-[0.6875rem] font-normal">
            {mode.input.meta}
          </span>
        ) : null}
      </div>

      {mode.id === "voice" ? (
        <div className="mt-6 flex items-center gap-4">
          <span className="relative flex size-11 items-center justify-center rounded-full bg-ember text-white">
            <span
              aria-hidden
              className="absolute inset-0 animate-breathe rounded-full bg-ember/30 blur-md"
            />
            <Icon className="relative size-5" aria-hidden />
          </span>
          <Waveform bars={40} active={active} className="h-10 flex-1" />
        </div>
      ) : null}

      {mode.id === "photo" ? (
        <div className="relative mt-5">
          <PhotoSwatch className="aspect-[4/3] w-full" />
          {active ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-md"
            >
              <span className="absolute inset-y-0 w-1/3 animate-beam bg-gradient-to-r from-transparent via-[rgb(var(--ember)/0.18)] to-transparent" />
            </span>
          ) : null}
        </div>
      ) : null}

      {mode.id === "file" ? (
        <div className="mt-5 rounded-md border border-hairline bg-canvas-raised p-4">
          <div className="flex items-center gap-2 text-xs text-subtle">
            <span className="rounded-sm bg-[rgb(var(--danger)/0.12)] px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold text-danger">
              PDF
            </span>
            Page 1 of 2
          </div>
          <div className="mt-3 space-y-2" aria-hidden>
            {[90, 70, 84, 55].map((w, i) => (
              <span
                key={i}
                className="block h-2 rounded-full bg-hairline-strong/60"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {mode.id === "link" ? (
        <div className="mt-5 flex items-center gap-3 rounded-md border border-hairline bg-canvas-raised p-3">
          <span
            aria-hidden
            className="size-10 shrink-0 rounded-md"
            style={{
              background:
                "linear-gradient(135deg, rgb(var(--ember)/0.9), rgb(var(--entity-organization)/0.7))",
            }}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{mode.input.title}</p>
            <p className="truncate text-xs text-subtle">{mode.input.body}</p>
          </div>
        </div>
      ) : null}

      {mode.id === "location" ? (
        <div className="relative mt-5 h-28 overflow-hidden rounded-md border border-hairline bg-canvas-raised">
          <span
            aria-hidden
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgb(var(--hairline)/0.12) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--hairline)/0.12) 1px, transparent 1px)",
              backgroundSize: "1.5rem 1.5rem",
            }}
          />
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgb(var(--entity-place)/0.4)] bg-[rgb(var(--entity-place)/0.08)]"
          />
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas bg-place"
          />
        </div>
      ) : null}

      {mode.id !== "photo" ? (
        <p
          className={cn(
            "mt-5 text-[1.0625rem] leading-7 text-foreground",
            mode.id === "file" && "font-mono text-sm leading-6 text-muted",
          )}
        >
          {shown}
          {active && shown.length < mode.input.body.length ? (
            <span className="landing-caret" />
          ) : null}
        </p>
      ) : (
        <p className="mt-4 font-mono text-sm leading-6 text-muted">
          {mode.input.body}
        </p>
      )}
    </div>
  );
}

export function CaptureDemo() {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (!inView || paused || reduce) return;
    const t = setInterval(
      () => setIndex((i) => (i + 1) % CAPTURE_MODES.length),
      AUTO_ADVANCE_MS,
    );
    return () => clearInterval(t);
  }, [inView, paused, reduce]);

  const mode = CAPTURE_MODES[index] ?? CAPTURE_MODES[0]!;

  return (
    <section id="capture" className="scroll-mt-24 py-28 sm:py-36">
      <Container>
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
          <Reveal className="min-w-0 lg:col-span-4">
            <Eyebrow>Anything can become context</Eyebrow>
            <Heading className="mt-4">
              You don&apos;t decide how to file it. You just save it.
            </Heading>
            <Lede className="mt-6 text-base leading-7 sm:text-lg sm:leading-8">
              A voice note, a photo, a PDF, a link, a place. Lictory reads each
              of them and turns what it finds into the same simple kind of
              context — so a receipt and a recording can end up side by side.
            </Lede>
          </Reveal>

          <Reveal className="min-w-0 lg:col-span-8" delay={0.1}>
            <div
              ref={ref}
              className="rounded-xl border border-hairline bg-canvas shadow-[0_1px_2px_rgb(15_20_25/0.04),0_24px_64px_-32px_rgb(15_20_25/0.16)]"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
              onFocusCapture={() => setPaused(true)}
              onBlurCapture={() => setPaused(false)}
            >
              <div
                role="tablist"
                aria-label="Capture modes"
                className="flex gap-1 overflow-x-auto border-b border-hairline p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {CAPTURE_MODES.map((m, i) => {
                  const Icon = KIND_ICON[m.id];
                  const selected = i === index;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="tab"
                      id={`capture-tab-${m.id}`}
                      aria-selected={selected}
                      aria-controls={`capture-panel-${m.id}`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setIndex(i)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                          e.preventDefault();
                          const next =
                            (i +
                              (e.key === "ArrowRight" ? 1 : -1) +
                              CAPTURE_MODES.length) %
                            CAPTURE_MODES.length;
                          setIndex(next);
                          document
                            .getElementById(
                              `capture-tab-${CAPTURE_MODES[next]?.id}`,
                            )
                            ?.focus();
                        }
                      }}
                      className={cn(
                        "relative inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                        selected
                          ? "text-foreground"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {selected ? (
                        <motion.span
                          layoutId="capture-tab-bg"
                          className="absolute inset-0 rounded-md bg-surface-strong"
                          transition={{ duration: 0.35, ease: EASE }}
                        />
                      ) : null}
                      <Icon
                        className={cn(
                          "relative size-4",
                          selected ? "text-ember" : "",
                        )}
                        aria-hidden
                      />
                      <span className="relative">{m.label}</span>
                    </button>
                  );
                })}
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={mode.id}
                  role="tabpanel"
                  id={`capture-panel-${mode.id}`}
                  aria-labelledby={`capture-tab-${mode.id}`}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="grid gap-8 p-5 sm:p-7 md:grid-cols-[1.2fr_1fr] md:gap-10"
                >
                  <div className="min-h-[15rem]">
                    <InputPreview mode={mode} active={inView} />
                  </div>

                  <div className="relative border-t border-hairline pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
                    <p className="text-[0.8125rem] font-medium text-subtle">
                      What Lictory understood
                    </p>
                    <ContextTags
                      tags={mode.understood}
                      active={inView}
                      baseDelay={reduce ? 0 : 0.9}
                      className="mt-4"
                    />
                    <motion.p
                      initial={reduce ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: reduce ? 0 : 1.6, duration: 0.5 }}
                      className="mt-6 text-[0.9375rem] leading-6 text-muted"
                    >
                      {mode.summary}
                    </motion.p>
                  </div>
                </motion.div>
              </AnimatePresence>

              <div aria-hidden className="flex gap-1 px-5 pb-4 sm:px-7">
                {CAPTURE_MODES.map((m, i) => (
                  <span
                    key={m.id}
                    className={cn(
                      "h-0.5 flex-1 rounded-full transition-colors duration-500",
                      i === index ? "bg-ember" : "bg-hairline",
                    )}
                  />
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
