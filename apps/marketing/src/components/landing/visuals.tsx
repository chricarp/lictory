"use client";

import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Check,
  CircleDashed,
  FileText,
  GitPullRequestArrow,
  Loader2,
  MessageSquareText,
  MousePointer2,
  TriangleAlert,
} from "lucide-react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { cn } from "@lictory/core/lib/utils";

/*
 * Illustrative product animations for the landing page. None of them touch a
 * workspace. Each loop only runs while it is on screen, and visitors who prefer
 * reduced motion get one representative, static frame.
 */

const ease = [0.23, 1, 0.32, 1] as const;

function useStepLoop(
  ref: RefObject<HTMLElement | null>,
  durations: readonly number[],
  staticStep: number,
) {
  const inView = useInView(ref, { amount: 0.35 });
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const timer = setTimeout(
      () => setStep((current) => (current + 1) % durations.length),
      durations[step],
    );
    return () => clearTimeout(timer);
  }, [inView, reduce, step, durations]);
  return reduce ? staticStep : step;
}

function Frame({
  label,
  children,
  className,
  frameRef,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  frameRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={frameRef}
      role="img"
      aria-label={label}
      className={cn(
        "relative isolate overflow-hidden rounded-2xl bg-[linear-gradient(180deg,oklch(0.22_0.012_270),oklch(0.17_0.008_270))] p-4 shadow-[inset_0_1px_0_oklch(1_0_0/0.08),inset_0_0_0_1px_oklch(1_0_0/0.07),0_30px_80px_-40px_oklch(0.55_0.2_275/0.5)] select-none sm:p-6",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-48 bg-[radial-gradient(closest-side,oklch(0.6_0.18_280/0.18),transparent)]"
      />
      {children}
    </div>
  );
}

const fadeSwap = {
  initial: { opacity: 0, y: 8, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -6, filter: "blur(4px)" },
  transition: { duration: 0.45, ease },
};

function Pill({
  tone,
  children,
}: {
  tone: "amber" | "emerald" | "violet" | "sky" | "muted";
  children: ReactNode;
}) {
  return (
    <motion.span
      layout
      transition={{ duration: 0.35, ease }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap",
        tone === "amber" && "bg-amber-400/10 text-amber-300",
        tone === "emerald" && "bg-emerald-400/10 text-emerald-300",
        tone === "violet" && "bg-violet-400/12 text-violet-200",
        tone === "sky" && "bg-sky-400/10 text-sky-300",
        tone === "muted" && "bg-white/6 text-muted-foreground",
      )}
    >
      {children}
    </motion.span>
  );
}

/* -------------------------------------------------------------------------- */
/* 01 · Draft: rough notes become a structured specification.                 */

const draftDurations = [2400, 2800, 3000, 3400] as const;

export function DraftVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepLoop(ref, draftDurations, 3);
  const structured = step >= 1;
  return (
    <Frame
      frameRef={ref}
      label="Rough proposal notes become a structured specification, and a Lictory Intelligence finding about a missing timeout is accepted by a person."
    >
      <div className="flex items-center gap-2 text-xs">
        <FileText aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground/90">
          Retry failed payments
        </span>
        <span className="ml-auto">
          {structured ? (
            <Pill tone="violet">Refinement</Pill>
          ) : (
            <Pill tone="muted">Draft</Pill>
          )}
        </span>
      </div>
      <div className="relative mt-4 flex min-h-92 flex-col gap-4 sm:min-h-86">
        <AnimatePresence mode="popLayout" initial={false}>
          {!structured ? (
            <motion.ul
              key="notes"
              {...fadeSwap}
              className="space-y-2.5 font-mono text-[12.5px] leading-5 text-foreground/70"
            >
              {[
                "- retry payments when they fail??",
                "- dont charge people twice",
                "- ask eng about limits",
                "- QA: what if bank is slow",
              ].map((line, index) => (
                <motion.li
                  key={line}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.18, duration: 0.4, ease }}
                >
                  {line}
                </motion.li>
              ))}
            </motion.ul>
          ) : (
            <motion.div key="spec" {...fadeSwap} className="space-y-3.5">
              {[
                ["Objective", "Recover failed card payments automatically."],
                ["Behavior", "Retry up to 3 times. Reuse the transaction ID."],
                [
                  "Acceptance criteria",
                  "A customer is never charged twice for one order.",
                ],
              ].map(([title, body], index) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + index * 0.12, ease }}
                >
                  <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                    {title}
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-foreground/85">
                    {body}
                  </p>
                </motion.div>
              ))}
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.46, ease }}
              >
                <p className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                  Failure behavior
                </p>
                <AnimatePresence mode="wait" initial={false}>
                  {step === 3 ? (
                    <motion.p
                      key="filled"
                      {...fadeSwap}
                      className="mt-1 text-[13px] leading-5 text-emerald-200"
                    >
                      After 30s the payment stays pending; no new charge.
                    </motion.p>
                  ) : (
                    <motion.p
                      key="empty"
                      {...fadeSwap}
                      className={cn(
                        "mt-1 rounded-md border border-dashed px-2 py-1 text-[12px] transition-colors duration-500",
                        step === 2
                          ? "border-amber-300/50 text-amber-200/80"
                          : "border-white/10 text-muted-foreground/70",
                      )}
                    >
                      Not defined yet
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {step >= 2 ? (
            <motion.div
              key="finding"
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.5, ease }}
              className="mt-auto rounded-xl bg-[oklch(0.25_0.04_285/0.92)] p-3 text-xs shadow-[inset_0_0_0_1px_oklch(0.7_0.15_285/0.25),0_16px_40px_-12px_oklch(0_0_0/0.8)] backdrop-blur"
            >
              <div className="flex items-center gap-2">
                <IntelligenceMark className="size-3.5 text-violet-300" />
                <span className="font-medium text-violet-200">
                  Lictory Intelligence finding · proposed
                </span>
                <span className="ml-auto">
                  {step === 3 ? (
                    <Pill tone="emerald">
                      <Check aria-hidden className="size-3" />
                      Accepted by Ana
                    </Pill>
                  ) : (
                    <Pill tone="amber">Needs a decision</Pill>
                  )}
                </span>
              </div>
              <p className="mt-1.5 leading-5 text-foreground/80">
                The flow defines success but not what happens when the provider
                times out.
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Frame>
  );
}

/* -------------------------------------------------------------------------- */
/* 02 · Review: an anchored thread, a suggestion, a new revision, approvals.   */

const reviewDurations = [1800, 2400, 2600, 2200, 3400] as const;

const reviewers = [
  { initial: "P", name: "Product", color: "bg-violet-400/20 text-violet-200" },
  { initial: "E", name: "Engineering", color: "bg-sky-400/20 text-sky-200" },
  { initial: "Q", name: "QA", color: "bg-emerald-400/20 text-emerald-200" },
];

export function ReviewVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepLoop(ref, reviewDurations, 4);
  const accepted = step >= 3;
  return (
    <Frame
      frameRef={ref}
      label="An engineer comments on a vague sentence, a suggestion replaces it, the suggestion is accepted as revision 13, and product, engineering and QA approve that revision."
    >
      <div className="flex items-center gap-2 text-xs">
        <GitPullRequestArrow
          aria-hidden
          className="size-3.5 text-muted-foreground"
        />
        <span className="font-medium text-foreground/90">In review</span>
        <span className="relative ml-auto inline-flex h-5 overflow-hidden font-mono text-[11px] text-muted-foreground">
          Rev&nbsp;
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={accepted ? 13 : 12}
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -14, opacity: 0 }}
              transition={{ duration: 0.4, ease }}
              className={cn(accepted && "text-foreground")}
            >
              {accepted ? 13 : 12}
            </motion.span>
          </AnimatePresence>
        </span>
      </div>
      <div className="relative mt-4 flex min-h-84 flex-col sm:min-h-76">
        <p className="text-[14px] leading-7 text-foreground/85">
          When a card payment fails, retry it{" "}
          <span className="relative inline-block">
            <AnimatePresence mode="popLayout" initial={false}>
              {accepted ? (
                <motion.span
                  key="new"
                  initial={{ opacity: 0, filter: "blur(4px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  transition={{ duration: 0.4, ease }}
                  className="rounded bg-emerald-400/12 px-1 text-emerald-200"
                >
                  up to 3 times
                </motion.span>
              ) : (
                <motion.span
                  key="old"
                  exit={{ opacity: 0, filter: "blur(4px)" }}
                  className={cn(
                    "rounded px-1 transition-colors duration-500",
                    step >= 1
                      ? "bg-amber-300/15 text-amber-200 underline decoration-amber-300/60 decoration-dotted underline-offset-4"
                      : "",
                  )}
                >
                  as needed
                </motion.span>
              )}
            </AnimatePresence>
          </span>{" "}
          and reuse the original transaction ID.
        </p>

        <div className="mt-4 mb-4 space-y-2">
          <AnimatePresence initial={false}>
            {step >= 1 ? (
              <motion.div
                key="thread"
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45, ease }}
                className="rounded-xl bg-white/4 p-3 text-xs shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]"
              >
                <div className="flex items-center gap-2">
                  <MessageSquareText
                    aria-hidden
                    className="size-3.5 text-sky-300"
                  />
                  <span className="font-medium">Marta · Engineering</span>
                  <span className="ml-auto">
                    {accepted ? (
                      <Pill tone="emerald">Resolved</Pill>
                    ) : (
                      <Pill tone="amber">Blocking</Pill>
                    )}
                  </span>
                </div>
                <p className="mt-1.5 text-foreground/75">
                  How many retries? Could we charge twice?
                </p>
              </motion.div>
            ) : null}
            {step === 2 ? (
              <motion.div
                key="suggestion"
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.45, ease }}
                className="relative rounded-xl bg-white/4 p-3 text-xs shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]"
              >
                <p className="font-medium">Suggested change</p>
                <p className="mt-1.5">
                  <del className="rounded bg-red-400/10 px-1 text-red-300">
                    as needed
                  </del>{" "}
                  <ins className="rounded bg-emerald-400/10 px-1 text-emerald-300 no-underline">
                    up to 3 times
                  </ins>
                </p>
                <div className="mt-2.5 flex gap-1.5">
                  <motion.span
                    animate={{ scale: [1, 1, 0.94, 1] }}
                    transition={{ duration: 2.2, times: [0, 0.7, 0.8, 1] }}
                    className="rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background"
                  >
                    Accept
                  </motion.span>
                  <span className="rounded-md bg-white/6 px-2 py-1 text-[11px] text-muted-foreground">
                    Reject
                  </span>
                </div>
                <motion.span
                  aria-hidden
                  initial={{ x: 140, y: 40, opacity: 0 }}
                  animate={{ x: 26, y: 62, opacity: 1 }}
                  transition={{ duration: 1.2, delay: 0.4, ease }}
                  className="absolute top-0 left-0"
                >
                  <MousePointer2 className="size-4 fill-white text-white drop-shadow" />
                </motion.span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="mt-auto flex items-center gap-3 border-t border-white/6 pt-3">
          <div className="flex -space-x-1.5">
            {reviewers.map((reviewer, index) => {
              const approved = step === 4;
              return (
                <motion.span
                  key={reviewer.name}
                  animate={
                    approved
                      ? { scale: [1, 1.15, 1] }
                      : { scale: 1, opacity: 0.55 }
                  }
                  transition={{ delay: approved ? index * 0.35 : 0 }}
                  className={cn(
                    "relative grid size-6 place-items-center rounded-full text-[10px] font-semibold ring-2 ring-[oklch(0.18_0.008_270)]",
                    reviewer.color,
                  )}
                >
                  {reviewer.initial}
                  {approved ? (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{
                        delay: index * 0.35 + 0.1,
                        type: "spring",
                        bounce: 0.5,
                      }}
                      className="absolute -right-1 -bottom-1 grid size-3 place-items-center rounded-full bg-emerald-400 text-background"
                    >
                      <Check className="size-2.5" strokeWidth={3} />
                    </motion.span>
                  ) : null}
                </motion.span>
              );
            })}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={step === 4 ? "approved" : "waiting"}
              {...fadeSwap}
              className={cn(
                "text-xs",
                step === 4 ? "text-emerald-300" : "text-muted-foreground",
              )}
            >
              {step === 4
                ? "Approved · rev 13"
                : `${accepted ? 0 : 1} blocking · 0 of 3 approvals`}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </Frame>
  );
}

/* -------------------------------------------------------------------------- */
/* 03 · Readiness: checks run like CI; an edit makes one approval stale.       */

const checkDurations = [1400, 700, 700, 700, 700, 700, 2600, 3200] as const;
const checks = [
  "Acceptance criteria present",
  "Failure behavior addressed",
  "No blocking threads",
  "Product approval · rev 13",
  "QA approval · rev 13",
  "Engineering approval · rev 13",
];

export function ReadinessVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepLoop(ref, checkDurations, 7);
  const stale = step === 7;
  const passed = stale ? checks.length - 1 : Math.min(step, checks.length);
  const ready = step === 6;
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  return (
    <Frame
      frameRef={ref}
      label="Readiness checks pass one by one until the specification is ready. Then revision 14 edits the behavior and the engineering approval becomes stale."
    >
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 36 36" className="size-9 -rotate-90" aria-hidden>
          <circle
            cx="18"
            cy="18"
            r={radius}
            className="fill-none stroke-white/8"
            strokeWidth="3"
          />
          <motion.circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{
              strokeDashoffset: circumference * (1 - passed / checks.length),
              stroke: stale
                ? "oklch(0.83 0.16 85)"
                : ready
                  ? "oklch(0.77 0.15 163)"
                  : "oklch(0.75 0.13 285)",
            }}
            transition={{ duration: 0.6, ease }}
          />
        </svg>
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={stale ? "stale" : ready ? "ready" : "running"}
              {...fadeSwap}
              className="text-sm font-medium"
            >
              {stale ? "Needs review" : ready ? "Ready to build" : "Checking…"}
            </motion.p>
          </AnimatePresence>
          <p className="font-mono text-[11px] text-muted-foreground">
            {passed} of {checks.length} checks · rev {stale ? 14 : 13}
          </p>
        </div>
        <span className="ml-auto">
          {stale ? (
            <Pill tone="amber">Stale approval</Pill>
          ) : ready ? (
            <Pill tone="emerald">Ready</Pill>
          ) : (
            <Pill tone="muted">Running</Pill>
          )}
        </span>
      </div>

      <ul className="mt-5 space-y-1">
        {checks.map((label, index) => {
          const isStale = stale && index === checks.length - 1;
          const done = !isStale && index < passed;
          const running = !done && !isStale && index === passed && step < 6;
          return (
            <li
              key={label}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-500",
                isStale && "bg-amber-400/8",
              )}
            >
              <span className="relative grid size-4 shrink-0 place-items-center">
                <AnimatePresence mode="popLayout" initial={false}>
                  {done ? (
                    <motion.span
                      key="done"
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{
                        type: "spring",
                        bounce: 0.45,
                        duration: 0.5,
                      }}
                      className="grid size-4 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </motion.span>
                  ) : isStale ? (
                    <motion.span
                      key="stale"
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="text-amber-300"
                    >
                      <TriangleAlert className="size-4" />
                    </motion.span>
                  ) : running ? (
                    <motion.span key="running" className="text-violet-300">
                      <Loader2 className="size-4 animate-spin" />
                    </motion.span>
                  ) : (
                    <motion.span key="idle" className="text-white/20">
                      <CircleDashed className="size-4" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span
                className={cn(
                  "truncate transition-colors duration-300",
                  done ? "text-foreground/85" : "text-muted-foreground",
                  isStale && "text-amber-100",
                )}
              >
                {label}
              </span>
              {isStale ? (
                <motion.span
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="ml-auto shrink-0 text-[11px] text-amber-300"
                >
                  Rev 14 changed Behavior
                </motion.span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}

/* -------------------------------------------------------------------------- */
/* 04 · Delivery: one approved spec, delivered natively or published.          */

const deliveryDurations = [1300, 1500, 1600, 2600, 1300, 1500, 3400] as const;
const items = [
  { title: "Retry scheduler", key: "PAY-8812" },
  { title: "Idempotent charge", key: "PAY-8813" },
  { title: "Timeout handling", key: "PAY-8814" },
];

export function DeliveryVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepLoop(ref, deliveryDurations, 3);
  const external = step >= 4;
  const phase = external ? step - 4 : step;
  const columns = ["Todo", "In progress", "Done"];
  // Native board progress: where each item sits during each phase.
  const nativeColumn = (index: number) => {
    if (phase < 2) return 0;
    if (phase === 2) return index === 0 ? 1 : 0;
    return [2, 1, 0][index] ?? 0;
  };
  return (
    <Frame
      frameRef={ref}
      label="An approved specification is split into three work items, which a team either moves across a Lictory board or publishes to Jira with a link back to revision 13."
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg bg-white/4 px-2.5 py-1.5 text-xs shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]">
          <FileText aria-hidden className="size-3.5 text-violet-300" />
          <span className="font-medium">Approved spec</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            rev 13
          </span>
        </div>
        <div className="relative ml-auto flex rounded-full bg-white/4 p-0.5 text-[11px] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]">
          {["Lictory", "Jira"].map((label, index) => {
            const active = (index === 1) === external;
            return (
              <span
                key={label}
                className={cn(
                  "relative px-2.5 py-1 transition-colors duration-300",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="delivery-mode"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                    className="absolute inset-0 rounded-full bg-white/10"
                  />
                ) : null}
                <span className="relative">{label}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="relative mt-5 min-h-56">
        <AnimatePresence mode="wait" initial={false}>
          {!external ? (
            <motion.div
              key="native"
              {...fadeSwap}
              className="grid grid-cols-3 gap-2"
            >
              <LayoutGroup>
                {columns.map((column, columnIndex) => (
                  <div
                    key={column}
                    className="min-h-52 rounded-xl bg-white/2.5 p-2 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.05)]"
                  >
                    <p className="flex items-center gap-1.5 px-1 pb-2 text-[10.5px] text-muted-foreground">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          columnIndex === 0 && "bg-white/30",
                          columnIndex === 1 && "bg-amber-300",
                          columnIndex === 2 && "bg-emerald-400",
                        )}
                      />
                      {column}
                    </p>
                    <div className="space-y-1.5">
                      {phase >= 1
                        ? items.map((item, index) =>
                            nativeColumn(index) === columnIndex ? (
                              <motion.div
                                key={item.key}
                                layoutId={`item-${item.key}`}
                                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{
                                  type: "spring",
                                  bounce: 0.18,
                                  duration: 0.6,
                                  delay: phase === 1 ? index * 0.12 : 0,
                                }}
                                className="rounded-lg bg-[oklch(0.25_0.01_270)] px-2 py-2 text-[11px] leading-4 shadow-[inset_0_1px_0_oklch(1_0_0/0.06),0_4px_12px_-6px_oklch(0_0_0/0.6)]"
                              >
                                <p className="font-mono text-[9.5px] text-muted-foreground">
                                  {item.key}
                                </p>
                                <p className="mt-0.5 text-foreground/90">
                                  {item.title}
                                </p>
                              </motion.div>
                            ) : null,
                          )
                        : null}
                    </div>
                  </div>
                ))}
              </LayoutGroup>
            </motion.div>
          ) : (
            <motion.ul key="external" {...fadeSwap} className="space-y-2">
              {items.map((item, index) => {
                const published = phase >= 2;
                return phase >= 1 ? (
                  <motion.li
                    key={item.key}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.12, duration: 0.4, ease }}
                    className="flex items-center gap-3 rounded-xl bg-white/3 px-3 py-2.5 text-[13px] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.05)]"
                  >
                    <span className="grid size-4 place-items-center">
                      {published ? (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{
                            delay: index * 0.3,
                            type: "spring",
                            bounce: 0.5,
                          }}
                          className="grid size-4 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"
                        >
                          <Check className="size-3" strokeWidth={3} />
                        </motion.span>
                      ) : (
                        <CircleDashed className="size-4 text-white/25" />
                      )}
                    </span>
                    <span className="truncate text-foreground/85">
                      {item.title}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {published ? (
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: index * 0.3 + 0.1 }}
                        >
                          JIRA-{4120 + index}
                        </motion.span>
                      ) : (
                        "Not published"
                      )}
                    </span>
                  </motion.li>
                ) : null;
              })}
              {phase >= 2 ? (
                <motion.li
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1 }}
                  className="px-1 pt-1 text-[11px] text-muted-foreground"
                >
                  Published by Ana · linked to rev 13 · Jira owns delivery
                  status
                </motion.li>
              ) : null}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </Frame>
  );
}

/* -------------------------------------------------------------------------- */
/* The whole journey as one line, lit stage by stage.                          */

const stages = ["Proposal", "Review", "Approved", "Ready", "Delivered"];
const flowDurations = [1400, 1400, 1400, 1400, 2400] as const;

export function FlowLine() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepLoop(ref, flowDurations, 4);
  return (
    <div
      ref={ref}
      role="img"
      aria-label="Proposal, then review, then approved, then ready, then delivered."
      className="relative mx-auto max-w-3xl"
    >
      <div className="absolute inset-x-[10%] top-[13px] h-px bg-white/10" />
      <motion.div
        className="absolute top-[13px] left-[10%] h-px origin-left bg-linear-to-r from-violet-400/0 via-violet-300 to-emerald-300"
        style={{ width: "80%" }}
        animate={{ scaleX: step / (stages.length - 1) }}
        transition={{ duration: 0.9, ease }}
      />
      <ol className="relative grid grid-cols-5">
        {stages.map((stage, index) => {
          const active = index <= step;
          const current = index === step;
          return (
            <li key={stage} className="flex flex-col items-center gap-2.5">
              <span className="relative grid size-[27px] place-items-center">
                {current ? (
                  <motion.span
                    layoutId="flow-halo"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.7 }}
                    className="absolute inset-0 rounded-full bg-violet-400/20 shadow-[0_0_24px_oklch(0.7_0.17_285/0.6)]"
                  />
                ) : null}
                <span
                  className={cn(
                    "relative size-2.5 rounded-full transition-colors duration-500",
                    active
                      ? index === stages.length - 1
                        ? "bg-emerald-300"
                        : "bg-violet-300"
                      : "bg-white/15",
                  )}
                />
              </span>
              <span
                className={cn(
                  "text-[11px] transition-colors duration-500 sm:text-[13px]",
                  active ? "text-foreground/90" : "text-muted-foreground/70",
                )}
              >
                {stage}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero stage: the product window straightens as the visitor scrolls.          */

export function HeroStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "start 0.25"],
  });
  const rotateX = useTransform(scrollYProgress, [0, 1], [14, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.94, 1]);
  return (
    <div ref={ref} className="sm:perspective-[1400px]">
      <motion.div
        style={reduce ? undefined : { rotateX, scale }}
        className="origin-top max-sm:transform-none! sm:will-change-transform"
      >
        {children}
      </motion.div>
    </div>
  );
}
