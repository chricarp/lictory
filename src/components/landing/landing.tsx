import Link from "next/link";
import { PrivacyPreferencesButton } from "~/components/app/consent-ui";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  CircleDashed,
  FileDiff,
  GitPullRequestArrow,
  History,
  KanbanSquare,
  Lightbulb,
  Lock,
  MessageSquareText,
  Minus,
  PenLine,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Split,
  Users,
  Workflow,
  X,
} from "lucide-react";

import { Logo } from "~/components/logo";
import { cn } from "~/lib/utils";

type LandingUser = { name: string; email: string } | null;

const linkBase =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-100 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

function CtaLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        linkBase,
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-10 px-4 text-sm",
        variant === "primary" &&
          "bg-foreground text-background hover:bg-foreground/90",
        variant === "secondary" &&
          "bg-white/4 text-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/0.1)] hover:bg-white/8",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-white/5 hover:text-foreground",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Landing({ user }: { user: LandingUser }) {
  return (
    <div className="dark min-h-dvh bg-background text-foreground">
      <div className="relative overflow-hidden">
        <Header user={user} />
        <main>
          <Hero user={user} />
          <Problem />
          <Refinement />
          <Readiness />
          <AiSection />
          <Delivery />
          <UseCases />
          <Comparison />
          <Enterprise />
          <Faq />
          <FinalCta user={user} />
        </main>
        <Footer />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Header({ user }: { user: LandingUser }) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4">
      <div
        className={cn(
          "pointer-events-auto relative isolate flex h-12 w-full max-w-3xl items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4",
          // Liquid glass: translucent tint, heavy blur + saturation, inner highlight rim.
          "bg-[linear-gradient(180deg,oklch(1_0_0/0.09),oklch(1_0_0/0.03))] backdrop-blur-2xl backdrop-saturate-[1.8]",
          "shadow-[inset_0_1px_0_oklch(1_0_0/0.18),inset_0_-1px_0_oklch(1_0_0/0.04),inset_0_0_0_1px_oklch(1_0_0/0.08),0_8px_32px_-8px_oklch(0_0_0/0.6),0_2px_6px_-2px_oklch(0_0_0/0.4)]",
          // Specular sheen across the top half.
          "before:pointer-events-none before:absolute before:inset-x-6 before:top-0 before:-z-10 before:h-1/2 before:rounded-t-full before:bg-[radial-gradient(60%_100%_at_50%_0%,oklch(1_0_0/0.12),transparent)]",
        )}
      >
        <Logo className="shrink-0 text-sm [&>svg]:size-7" />
        <nav
          aria-label="Sections"
          className="mx-auto hidden items-center text-[13px] md:flex"
        >
          {[
            ["Features", "#features"],
            ["Readiness", "#readiness"],
            ["Delivery", "#delivery"],
            ["Use cases", "#use-cases"],
            ["Compare", "#compare"],
            ["FAQ", "#faq"],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="rounded-full px-3 py-1.5 text-foreground/65 transition-[background-color,color] duration-150 hover:bg-white/[0.07] hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          {user ? (
            <CtaLink href="/app" className="h-9 rounded-full px-4">
              Open app
              <ArrowRight className="size-3.5" />
            </CtaLink>
          ) : (
            <>
              <CtaLink
                href="/sign-in"
                variant="ghost"
                className="h-9 rounded-full px-3.5 hover:bg-white/[0.07]"
              >
                Log in
              </CtaLink>
              <CtaLink href="/sign-up" className="h-9 rounded-full px-4">
                Sign up
              </CtaLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero({ user }: { user: LandingUser }) {
  return (
    <section className="relative px-5 pt-36 pb-24 sm:px-8 sm:pt-44">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-50 left-1/2 z-0 h-160 w-275 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(0.58_0.2_265/0.28),transparent)]"
      />
      <div className="relative mx-auto max-w-6xl">
        <a
          href="#features"
          className="mx-auto flex w-fit items-center gap-2 rounded-full bg-white/4 px-3 py-1 text-xs text-muted-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)] transition-colors hover:text-foreground"
        >
          <span className="size-1.5 rounded-full bg-emerald-400" />
          Requirements, reviewed like code
          <ArrowRight className="size-3" />
        </a>
        <h1 className="mx-auto mt-7 max-w-4xl text-center text-5xl leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-[80px]">
          <span className="bg-linear-to-b from-white to-white/60 bg-clip-text text-transparent">
            From product intent to engineering commitment.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-center text-lg leading-8 text-balance text-muted-foreground">
          Lictory is where product, engineering and QA refine specifications
          together: revisions, inline threads, suggestions, approvals and
          readiness checks. Then deliver the work on native boards, or publish
          it to Jira and Linear.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {user ? (
            <CtaLink href="/app" size="lg" className="w-full sm:w-auto">
              Continue to your workspace
              <ArrowRight className="size-4" />
            </CtaLink>
          ) : (
            <>
              <CtaLink href="/sign-up" size="lg" className="w-full sm:w-auto">
                Start for free
                <ArrowRight className="size-4" />
              </CtaLink>
              <CtaLink
                href="#compare"
                size="lg"
                variant="secondary"
                className="w-full sm:w-auto"
              >
                Compare with Jira & Linear
              </CtaLink>
            </>
          )}
        </div>
        {user ? (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Signed in as {user.name}
          </p>
        ) : null}
        <ProductMock />
      </div>
    </section>
  );
}

function ProductMock() {
  return (
    <div className="relative mx-auto mt-20 max-w-5xl">
      <div
        aria-hidden
        className="absolute inset-x-10 -top-px h-px bg-linear-to-r from-transparent via-white/40 to-transparent"
      />
      <div className="overflow-hidden rounded-xl bg-card/80 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08),0_40px_120px_-40px_oklch(0.58_0.2_265/0.5)]">
        <div className="flex items-center gap-2 border-b border-white/6 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="font-mono text-foreground/80">PAY-142</span>
          <span>/</span>
          <span className="truncate text-foreground">
            Retry failed card payments
          </span>
          <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-amber-400/10 px-2 py-0.5 text-amber-300 sm:flex">
            <CircleDashed className="size-3" /> In review
          </span>
          <span className="hidden rounded-full bg-white/5 px-2 py-0.5 sm:block">
            Revision 14
          </span>
        </div>
        <div className="grid md:grid-cols-[1fr_300px]">
          <div className="space-y-5 p-6 text-sm leading-7">
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Functional behavior
              </p>
              <p className="mt-2 text-foreground/85">
                When a card payment fails with a transient error, the system
                retries up to{" "}
                <span className="rounded bg-red-400/15 px-1 text-red-300 line-through">
                  5 times
                </span>{" "}
                <span className="rounded bg-emerald-400/15 px-1 text-emerald-300">
                  3 times with exponential backoff
                </span>
                .{" "}
                <span className="rounded-sm bg-amber-300/15 underline decoration-amber-300/60 decoration-dotted underline-offset-4">
                  Each retry reuses the original transaction ID.
                </span>
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Acceptance criteria
              </p>
              <ul className="mt-2 space-y-1.5 text-foreground/85">
                {[
                  "Customer is charged at most once per order.",
                  "After the final retry, the order moves to Payment failed.",
                  "Provider responses after client timeout are reconciled.",
                ].map((line) => (
                  <li key={line} className="flex gap-2">
                    <Check className="mt-1.5 size-3.5 shrink-0 text-emerald-400" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg bg-violet-400/[0.07] p-3 text-[13px] leading-6 shadow-[inset_0_0_0_1px_oklch(0.7_0.15_290/0.2)]">
              <p className="flex items-center gap-1.5 font-medium text-violet-300">
                <Sparkles className="size-3.5" /> Assistant finding · proposed
              </p>
              <p className="mt-1 text-foreground/75">
                Timeout behavior is undefined when the provider responds after
                the client gives up. QA cannot determine expected state.
              </p>
            </div>
          </div>
          <aside className="space-y-4 border-t border-white/6 p-5 text-[13px] md:border-t-0 md:border-l">
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Approvals
              </p>
              <ul className="mt-2 space-y-2">
                <MockRow tone="ok" label="Product" note="rev 14" />
                <MockRow
                  tone="stale"
                  label="Engineering"
                  note="rev 12 · stale"
                />
                <MockRow tone="wait" label="QA" note="requested" />
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Readiness checks
              </p>
              <ul className="mt-2 space-y-2">
                <MockRow tone="ok" label="Acceptance criteria" />
                <MockRow tone="ok" label="Dependencies identified" />
                <MockRow tone="fail" label="1 blocking thread" />
                <MockRow tone="fail" label="Failure behavior" />
              </ul>
            </div>
            <div className="rounded-lg bg-white/3 p-3 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="grid size-4 place-items-center rounded-full bg-sky-500/80 text-[9px] font-bold text-white">
                  M
                </span>
                Marta · Backend
                <span className="ml-auto rounded bg-red-400/10 px-1.5 text-[10px] text-red-300">
                  Blocking
                </span>
              </p>
              <p className="mt-1.5 leading-5 text-foreground/80">
                Reusing the transaction ID needs provider idempotency keys. Do
                all acquirers support it?
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function MockRow({
  tone,
  label,
  note,
}: {
  tone: "ok" | "stale" | "wait" | "fail";
  label: string;
  note?: string;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          "size-2 rounded-full",
          tone === "ok" && "bg-emerald-400",
          tone === "stale" && "bg-amber-400",
          tone === "wait" && "bg-white/25",
          tone === "fail" && "bg-red-400",
        )}
      />
      <span className="text-foreground/85">{label}</span>
      {note ? (
        <span className="ml-auto text-xs text-muted-foreground">{note}</span>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function SectionHeading({
  eyebrow,
  title,
  children,
  center,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cn("max-w-2xl", center && "mx-auto text-center")}>
      <p className="text-[13px] font-medium text-violet-300">{eyebrow}</p>
      <h2 className="mt-3 text-3xl leading-[1.1] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
        {title}
      </h2>
      {children ? (
        <p className="mt-5 text-base leading-7 text-balance text-muted-foreground sm:text-lg">
          {children}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-20 border-t border-white/6 px-5 py-24 sm:px-8 sm:py-32",
        className,
      )}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Card({
  icon,
  title,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl bg-white/2.5 p-6 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)] transition-colors hover:bg-white/4",
        className,
      )}
    >
      <div className="grid size-8 place-items-center rounded-lg bg-white/5 text-foreground/80 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)] [&_svg]:size-4">
        {icon}
      </div>
      <h3 className="mt-5 text-[15px] font-medium">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Problem() {
  return (
    <Section>
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
        <SectionHeading
          eyebrow="The gap"
          title={
            <>
              “Product wants to build this.”
              <br />
              <span className="text-muted-foreground">
                “Engineering can safely commit to it.”
              </span>
            </>
          }
        />
        <div className="space-y-6 text-muted-foreground">
          <p className="text-lg leading-8">
            Between those two sentences sit meetings, lost comment threads,
            tickets rewritten three times and approvals nobody can trace. Issue
            trackers are built to move work that is already understood. They are
            not built to reach that understanding.
          </p>
          <ul className="space-y-3 text-sm">
            {[
              "Stories reach sprint planning with open questions nobody wrote down.",
              "Comments float in a feed, detached from the sentence they were about.",
              "An approval from last month silently covers a spec that has since changed.",
              "“Ready” is a dropdown someone clicked, not a fact anyone can verify.",
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <X className="mt-0.5 size-4 shrink-0 text-red-400/80" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

function Refinement() {
  return (
    <Section id="features">
      <SectionHeading
        eyebrow="Refinement"
        title="A pull request for every requirement."
      >
        Specifications in Lictory are drafted, reviewed, revised and approved
        the way code is. Everyone sees what changed, who changed it, and what is
        still unresolved.
      </SectionHeading>
      <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card icon={<History />} title="Immutable revisions">
          Every change creates a numbered revision. History is never rewritten,
          so you can always return to what was agreed.
        </Card>
        <Card icon={<FileDiff />} title="Readable diffs">
          Compare any two revisions side by side and see exactly which sentences
          moved, appeared or disappeared.
        </Card>
        <Card icon={<MessageSquareText />} title="Anchored threads">
          Discussions attach to the exact text range, section or revision they
          concern. No more “what was this comment about?”
        </Card>
        <Card icon={<PenLine />} title="Suggestions, not just comments">
          Propose concrete wording. Accepting a suggestion creates a new
          revision; rejecting one keeps the record.
        </Card>
        <Card icon={<GitPullRequestArrow />} title="Approvals per revision">
          An approval belongs to the revision that was reviewed. Material edits
          flag it stale so reviewers look again.
        </Card>
        <Card icon={<Lightbulb />} title="Decisions that last">
          Promote the conclusion of a long thread into a durable decision your
          team can find months later.
        </Card>
      </div>
    </Section>
  );
}

function Readiness() {
  const checks: [string, "ok" | "fail" | "wait"][] = [
    ["Product objective defined", "ok"],
    ["Acceptance criteria present", "ok"],
    ["Failure behavior addressed", "fail"],
    ["No blocking threads", "fail"],
    ["Engineering approval on current revision", "wait"],
    ["QA approval on current revision", "wait"],
  ];
  return (
    <Section id="readiness">
      <div className="grid items-center gap-14 lg:grid-cols-2">
        <SectionHeading eyebrow="Readiness" title="CI for requirements.">
          Readiness is evidence, not a status label. Lictory evaluates checks
          against each revision (reviews, blocking threads, acceptance criteria,
          failure behavior) and shows exactly what still stands between a spec
          and engineering.
        </SectionHeading>
        <div className="rounded-xl bg-card/70 p-2 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)]">
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="font-medium">Checks · revision 14</span>
            <span className="text-xs text-muted-foreground">
              2 of 6 passing
            </span>
          </div>
          <ul className="divide-y divide-white/5 rounded-lg bg-white/2">
            {checks.map(([label, tone]) => (
              <li
                key={label}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                {tone === "ok" ? (
                  <CheckCircle2 className="size-4 text-emerald-400" />
                ) : tone === "fail" ? (
                  <X className="size-4 text-red-400" />
                ) : (
                  <CircleDashed className="size-4 text-muted-foreground" />
                )}
                <span className="text-foreground/85">{label}</span>
                <span
                  className={cn(
                    "ml-auto text-xs",
                    tone === "ok" && "text-emerald-400/80",
                    tone === "fail" && "text-red-400/80",
                    tone === "wait" && "text-muted-foreground",
                  )}
                >
                  {tone === "ok"
                    ? "Passed"
                    : tone === "fail"
                      ? "Blocking"
                      : "Pending"}
                </span>
              </li>
            ))}
          </ul>
          <p className="px-4 py-3 text-xs text-muted-foreground">
            Engineering approved revision 12. Current revision is 14.
            Engineering approval requires review.
          </p>
        </div>
      </div>
    </Section>
  );
}

function AiSection() {
  return (
    <Section>
      <SectionHeading
        eyebrow="Assistant"
        title="AI that finds gaps, not AI that writes filler."
        center
      >
        The assistant points out missing information, contradictions and
        untested edge cases, with evidence. Every change it proposes is a
        suggestion a human accepts or rejects.
      </SectionHeading>
      <div className="mx-auto mt-14 grid max-w-5xl gap-3 md:grid-cols-3">
        {[
          [
            "Missing information",
            "The requirement describes a retry but does not define idempotency.",
          ],
          [
            "Contradiction",
            "The new state conflicts with approved decision D-31: cancellation after settlement is unsupported.",
          ],
          [
            "Edge case",
            "QA cannot determine expected behavior when the provider responds after the client timeout.",
          ],
        ].map(([kind, text]) => (
          <div
            key={kind}
            className="rounded-xl bg-violet-400/4 p-5 shadow-[inset_0_0_0_1px_oklch(0.7_0.15_290/0.15)]"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-violet-300">
              <Bot className="size-3.5" />
              {kind}
            </p>
            <p className="mt-3 text-sm leading-6 text-foreground/80">{text}</p>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
        {[
          "Never silently rewrites approved text",
          "Never resolves or approves on your behalf",
          "Core review works with AI disabled",
        ].map((t) => (
          <span key={t} className="flex items-center gap-2">
            <Check className="size-4 text-emerald-400" />
            {t}
          </span>
        ))}
      </div>
    </Section>
  );
}

function Delivery() {
  return (
    <Section id="delivery">
      <SectionHeading
        eyebrow="Delivery"
        title="Deliver in Lictory, or where you already work."
      >
        Delivery mode is a per-team setting on the same data model. Refinement
        works identically either way, and exactly one system owns delivery state
        for each piece of work.
      </SectionHeading>
      <div className="mt-14 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl bg-white/2.5 p-7 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)]">
          <div className="flex items-center gap-2 text-sm font-medium">
            <KanbanSquare className="size-4 text-sky-300" />
            Native delivery
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Everything a small or medium team needs to ship every day, with the
            simplicity you expect from a modern tracker.
          </p>
          <ul className="mt-6 grid gap-2.5 text-sm sm:grid-cols-2">
            {[
              "Epics, stories, tasks, bugs, subtasks",
              "Per-team workflow statuses",
              "Kanban board and ranked backlog",
              "Sprints and automatic cycles",
              "Estimates, burndown, velocity",
              "Blocks, relates, duplicates",
            ].map((t) => (
              <li key={t} className="flex gap-2 text-foreground/85">
                <Check className="mt-0.5 size-4 shrink-0 text-sky-300" />
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-7 grid grid-cols-3 gap-2 text-[11px]">
            {[
              ["Unstarted", ["PAY-151", "PAY-156"]],
              ["Started", ["PAY-142"]],
              ["Done", ["PAY-120", "PAY-133"]],
            ].map(([col, items]) => (
              <div key={col as string} className="rounded-lg bg-white/3 p-2">
                <p className="px-1 pb-2 text-muted-foreground">{col}</p>
                <div className="space-y-1.5">
                  {(items as string[]).map((i) => (
                    <div
                      key={i}
                      className="rounded-md bg-card px-2 py-1.5 font-mono text-foreground/75 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]"
                    >
                      {i}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-white/2.5 p-7 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)]">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Split className="size-4 text-emerald-300" />
            Refinement + publish
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Keep Jira or Linear for delivery. Use Lictory to reach agreement,
            decompose the approved spec, then publish the hierarchy.
          </p>
          <ul className="mt-6 space-y-2.5 text-sm">
            {[
              "Publishing is explicit and requires permission",
              "Retries are idempotent, never duplicated work",
              "Partial failures are shown item by item and retryable",
              "Every external item traces back to its approved revision",
            ].map((t) => (
              <li key={t} className="flex gap-2 text-foreground/85">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-7 space-y-1.5 rounded-lg bg-white/3 p-3 font-mono text-[11px]">
            <p className="text-muted-foreground">Publish · PAY-142 rev 14</p>
            <p className="text-emerald-300/90">✓ Story 1 → JIRA-8812</p>
            <p className="text-emerald-300/90">✓ Story 2 → JIRA-8813</p>
            <p className="text-red-300/90">
              ✕ Story 3: issue type “Spike” no longer exists · Retry
            </p>
          </div>
        </div>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        <Workflow className="mr-1.5 inline size-4 align-[-3px]" />
        Readiness connects both worlds: it gates starting work natively, or
        publishing externally, according to each team’s policy.
      </p>
    </Section>
  );
}

function UseCases() {
  const roles = [
    {
      who: "Product Owners",
      text: "Start from a rough proposal: problem, notes, screenshots, links. Invite the right reviewers and watch it become a specification without scheduling a meeting.",
    },
    {
      who: "Engineers",
      text: "Raise feasibility, integration and failure-mode concerns exactly where they apply. Block on what matters, approve the revision you actually read.",
    },
    {
      who: "QA",
      text: "Surface boundary conditions and negative scenarios before a line of code exists. Define test scenarios as part of readiness, not after the sprint.",
    },
    {
      who: "Engineering managers",
      text: "See at a glance which specs are ready, which are blocked and why. Plan sprints from work that has already been agreed.",
    },
  ];
  return (
    <Section id="use-cases">
      <SectionHeading
        eyebrow="Use cases"
        title="Equal seats at the table for every discipline."
      >
        Product, engineering, QA, security and operations each bring different
        information. Lictory surfaces the right concerns for each feature
        instead of making everyone fill in every field.
      </SectionHeading>
      <div className="mt-14 grid gap-3 md:grid-cols-2">
        {roles.map((r) => (
          <div
            key={r.who}
            className="rounded-xl bg-white/2.5 p-6 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)]"
          >
            <h3 className="text-[15px] font-medium">{r.who}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {r.text}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Card icon={<Users />} title="Startups and small teams">
          Run refinement and delivery in one place with strong defaults. No
          admin project before your first spec.
        </Card>
        <Card icon={<ScrollText />} title="Regulated and audited teams">
          Answer who approved what, which revision, and what changed after,
          straight from the history.
        </Card>
        <Card icon={<Split />} title="Companies on Jira">
          Fix the part of the process Jira was never designed for, without
          migrating a single ticket.
        </Card>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

type Cell = boolean | string; // "partial" renders as add-ons note

const comparisonRows: {
  feature: string;
  lictory: Cell;
  jira: Cell;
  linear: Cell;
}[] = [
  {
    feature: "Specification revisions with diffs",
    lictory: true,
    jira: "partial",
    linear: false,
  },
  {
    feature: "Threads anchored to text ranges",
    lictory: true,
    jira: "partial",
    linear: "partial",
  },
  {
    feature: "Accept or reject suggested changes",
    lictory: true,
    jira: false,
    linear: false,
  },
  {
    feature: "Approvals bound to a specific revision",
    lictory: true,
    jira: false,
    linear: false,
  },
  {
    feature: "Stale approvals after material edits",
    lictory: true,
    jira: false,
    linear: false,
  },
  {
    feature: "Readiness as evidence-based checks",
    lictory: true,
    jira: "partial",
    linear: false,
  },
  {
    feature: "Durable decision records",
    lictory: true,
    jira: false,
    linear: false,
  },
  {
    feature: "AI gap and contradiction finding",
    lictory: true,
    jira: "partial",
    linear: "partial",
  },
  {
    feature: "Boards, backlog, sprints / cycles",
    lictory: true,
    jira: true,
    linear: true,
  },
  {
    feature: "Estimates, burndown, velocity",
    lictory: true,
    jira: true,
    linear: true,
  },
  {
    feature: "Publish approved work to Jira / Linear",
    lictory: true,
    jira: "—",
    linear: "—",
  },
  {
    feature: "Setup without an admin project",
    lictory: true,
    jira: false,
    linear: true,
  },
];

function CellValue({ value, highlight }: { value: Cell; highlight?: boolean }) {
  if (value === true)
    return (
      <Check
        aria-label="Yes"
        className={cn(
          "mx-auto size-4",
          highlight ? "text-violet-300" : "text-foreground/70",
        )}
      />
    );
  if (value === false)
    return <Minus aria-label="No" className="mx-auto size-4 text-white/20" />;
  if (value === "partial")
    return (
      <span className="text-xs text-muted-foreground">Add-ons / partial</span>
    );
  return <span className="text-xs text-muted-foreground">{value}</span>;
}

function Comparison() {
  return (
    <Section id="compare">
      <SectionHeading
        eyebrow="Compare"
        title="Built for the step before the ticket."
        center
      >
        Jira and Linear are excellent at moving known work. Lictory is built to
        reach agreement on what the work is, and then deliver it natively or
        hand it to them.
      </SectionHeading>
      <div className="mx-auto mt-14 max-w-4xl overflow-x-auto rounded-xl shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)]">
        <table className="w-full min-w-140 text-sm">
          <thead>
            <tr className="border-b border-white/6 text-[13px]">
              <th className="px-5 py-4 text-left font-medium text-muted-foreground">
                Capability
              </th>
              <th className="w-32 bg-violet-400/6 px-3 py-4 font-medium">
                Lictory
              </th>
              <th className="w-32 px-3 py-4 font-medium text-muted-foreground">
                Jira
              </th>
              <th className="w-32 px-3 py-4 font-medium text-muted-foreground">
                Linear
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {comparisonRows.map((row) => (
              <tr key={row.feature}>
                <td className="px-5 py-3.5 text-foreground/85">
                  {row.feature}
                </td>
                <td className="bg-violet-400/6 px-3 py-3.5 text-center">
                  <CellValue value={row.lictory} highlight />
                </td>
                <td className="px-3 py-3.5 text-center">
                  <CellValue value={row.jira} />
                </td>
                <td className="px-3 py-3.5 text-center">
                  <CellValue value={row.linear} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mx-auto mt-10 grid max-w-4xl gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-white/2.5 p-6 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)]">
          <h3 className="text-[15px] font-medium">Lictory vs Jira</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Jira tracks issues through configurable workflows, and it usually
            takes an admin to shape them. Lictory adds what happens before an
            issue exists: reviewed specs, traceable approvals and readiness
            checks. Keep Jira and publish into it, or replace it for teams that
            want less configuration.
          </p>
        </div>
        <div className="rounded-xl bg-white/2.5 p-6 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)]">
          <h3 className="text-[15px] font-medium">Lictory vs Linear</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Linear sets the bar for fast, focused issue tracking. Lictory shares
            that taste for delivery, and adds a first-class review workflow for
            requirements: revisions, suggestions, per-revision approvals and
            decisions, so “ready” means agreed.
          </p>
        </div>
      </div>
      <p className="mx-auto mt-6 max-w-4xl text-xs text-muted-foreground">
        Comparison reflects built-in capabilities as we understand them.
        Marketplace add-ons and integrations can extend Jira and Linear.
      </p>
    </Section>
  );
}

function Enterprise() {
  return (
    <Section>
      <SectionHeading
        eyebrow="Built for trust"
        title="Your roadmap is sensitive. We treat it that way."
      >
        Unreleased features, architecture and security discussions live here, so
        isolation and accountability are part of the core model.
      </SectionHeading>
      <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card icon={<Lock />} title="Tenant isolation">
          Every query is scoped to your organization on the server, not filtered
          in the browser.
        </Card>
        <Card icon={<ShieldCheck />} title="Server-side authorization">
          Reviewing, approving and publishing are permission-checked
          capabilities, separate from groups.
        </Card>
        <Card icon={<ScrollText />} title="Audit history">
          Meaningful actions are recorded: revisions, approvals, resolutions,
          publishes.
        </Card>
        <Card icon={<Users />} title="Identity-ready">
          Invitations for small teams today, with an identity model designed for
          company SSO and group sync.
        </Card>
      </div>
    </Section>
  );
}

function Faq() {
  const items = [
    [
      "Do we have to leave Jira or Linear?",
      "No. Set a team to external delivery and Lictory handles refinement, review and decomposition, then publishes approved work into your existing tracker. Teams can switch to native delivery whenever they like.",
    ],
    [
      "Is this just a document editor with comments?",
      "No. Specifications have immutable revisions, diffs, anchored threads, actionable suggestions, per-revision approvals and readiness checks. The review workflow is the product.",
    ],
    [
      "Do product people need to understand Git?",
      "Not at all. The behavior is inspired by pull requests, but the language is about proposals, revisions, reviews and approvals.",
    ],
    [
      "What happens if AI is disabled?",
      "Everything core keeps working. The assistant only adds findings and proposals; humans stay authoritative over every change, resolution and approval.",
    ],
    [
      "What happens to approvals when the spec changes?",
      "Approvals reference the revision that was reviewed. Material changes mark relevant approvals as stale, so reviewers see exactly what changed since they approved.",
    ],
    [
      "How long does setup take?",
      "Minutes. Create an organization, a project and a team; defaults for work item types, workflow and readiness are ready to use.",
    ],
  ];
  return (
    <Section id="faq">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
        <SectionHeading eyebrow="FAQ" title="Questions, answered." />
        <div className="divide-y divide-white/6 border-y border-white/6">
          {items.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <span className="text-muted-foreground transition-transform duration-150 group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FinalCta({ user }: { user: LandingUser }) {
  return (
    <Section className="relative text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/2 h-100 w-225 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(0.58_0.2_265/0.2),transparent)]"
      />
      <div className="relative">
        <h2 className="mx-auto max-w-3xl text-4xl leading-[1.05] font-semibold tracking-[-0.04em] text-balance sm:text-6xl">
          Ship what everyone actually agreed on.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
          Bring your next feature proposal. Leave with an approved,
          implementation-ready specification.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {user ? (
            <CtaLink href="/app" size="lg">
              Open Lictory
              <ArrowRight className="size-4" />
            </CtaLink>
          ) : (
            <>
              <CtaLink href="/sign-up" size="lg">
                Get started free
                <ArrowRight className="size-4" />
              </CtaLink>
              <CtaLink href="/sign-in" size="lg" variant="secondary">
                Log in
              </CtaLink>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/6 px-5 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 text-[13px] text-muted-foreground sm:flex-row sm:items-center">
        <Logo className="text-sm text-foreground" />
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
          <a href="#delivery" className="hover:text-foreground">
            Delivery
          </a>
          <a href="#compare" className="hover:text-foreground">
            Compare
          </a>
          <a href="#faq" className="hover:text-foreground">
            FAQ
          </a>
          <PrivacyPreferencesButton className="hover:text-foreground">
            Privacy preferences
          </PrivacyPreferencesButton>
        </nav>
        <p className="sm:ml-auto">© {new Date().getFullYear()} Lictory</p>
      </div>
    </footer>
  );
}
