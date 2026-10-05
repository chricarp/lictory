import Link from "next/link";
import { PrivacyPreferencesButton } from "~/components/app/consent-ui";
import type { ReactNode } from "react";
import {
  ArrowRight,
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
} from "lucide-react";

import { Logo } from "~/components/logo";
import { ComparisonTable } from "~/components/landing/comparison";
import { MobileCta } from "~/components/landing/mobile-cta";
import { ReviewDemo } from "~/components/landing/review-demo";
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
      <div className="relative overflow-clip">
        <Header user={user} />
        <main>
          <Hero user={user} />
          <Problem />
          <Refinement />
          <Readiness />
          <Delivery user={user} />
          <Comparison />
          <Faq />
          <FinalCta user={user} />
        </main>
        <Footer />
      </div>
      <MobileCta
        href={user ? "/app" : "/sign-up"}
        label={user ? "Open your workspace" : "Start for free"}
      />
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
        <Logo className="[&>span]:h-5" />
        <nav
          aria-label="Sections"
          className="mx-auto hidden items-center text-[13px] md:flex"
        >
          {[
            ["How it works", "#features"],
            ["Readiness", "#readiness"],
            ["Delivery", "#delivery"],
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
    <section
      aria-labelledby="hero-title"
      className="relative px-5 pt-26 pb-14 sm:px-8 sm:pt-36 sm:pb-24"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-50 left-1/2 h-160 w-275 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(0.58_0.2_265/0.28),transparent)]"
      />
      <div className="relative mx-auto max-w-6xl">
        <p className="text-center text-xs font-medium text-violet-300 sm:text-sm">
          Requirements, reviewed like code.
        </p>
        <h1
          id="hero-title"
          className="mx-auto mt-4 max-w-4xl text-center text-[clamp(2.25rem,10.5vw,2.625rem)] leading-[1.05] font-semibold tracking-[-0.045em] sm:mt-6 sm:text-6xl lg:text-[80px]"
        >
          <span className="bg-linear-to-b from-white to-white/65 bg-clip-text text-transparent">
            Better specs.
            <br />
            Fewer meetings.
          </span>
        </h1>
        <p className="mx-auto mt-4 max-w-[32rem] text-center text-base leading-6 text-balance text-muted-foreground sm:mt-6 sm:text-lg sm:leading-7">
          Turn rough ideas into specs that product, engineering and QA agree on.
          Then build with confidence.
        </p>
        <div
          data-cta-anchor
          className="mt-6 flex flex-col items-center justify-center gap-2 sm:mt-8 sm:flex-row sm:gap-3"
        >
          <CtaLink
            href={user ? "/app" : "/sign-up"}
            size="lg"
            className="h-11 w-full max-w-80 sm:w-auto"
          >
            {user ? "Open your workspace" : "Start for free"}
            <ArrowRight aria-hidden className="size-4" />
          </CtaLink>
          <CtaLink
            href="#features"
            variant="ghost"
            className="h-11 px-4 text-sm"
          >
            See how it works <ArrowRight aria-hidden className="size-3.5" />
          </CtaLink>
        </div>
        {user ? (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Signed in as {user.name}
          </p>
        ) : (
          <ul
            aria-label="Why teams start today"
            className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:mt-4"
          >
            {[
              "Free to start",
              "Set up in minutes",
              "Works with Jira & Linear",
            ].map((item) => (
              <li
                key={item}
                className={cn(
                  "flex items-center gap-1.5",
                  item === "Set up in minutes" && "max-sm:hidden",
                )}
              >
                <Check aria-hidden className="size-3 text-emerald-400" />
                {item}
              </li>
            ))}
          </ul>
        )}
        <div className="mx-auto mt-6 max-w-3xl sm:mt-12">
          <ReviewDemo />
        </div>
        <p className="mt-5 text-center text-xs text-muted-foreground sm:text-sm">
          Refine together. Deliver in Lictory or your existing tracker.
        </p>
      </div>
    </section>
  );
}

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
        <p className="mt-4 text-sm leading-6 text-balance text-muted-foreground sm:text-lg sm:leading-7">
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
  ...rest
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <section
      id={id}
      {...rest}
      className={cn(
        "scroll-mt-20 border-t border-white/6 px-5 py-14 sm:px-8 sm:py-24",
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
  const pains = [
    {
      before: "Decisions get lost in chat threads and meeting notes.",
      after: "Every discussion stays anchored to the sentence it is about.",
    },
    {
      before: "Engineering finds the edge cases mid-sprint.",
      after: "Engineering and QA raise blockers before work is committed.",
    },
    {
      before: "“Approved” no longer matches what was written.",
      after: "Approvals belong to a revision and go stale when it changes.",
    },
  ];
  return (
    <Section aria-labelledby="problem-title">
      <SectionHeading
        eyebrow="Why Lictory"
        title={
          <span id="problem-title">Stop rebuilding what nobody agreed on.</span>
        }
      >
        Unclear requirements become rework. Lictory makes the gaps visible while
        they are still cheap to fix.
      </SectionHeading>
      <ul className="mt-7 grid gap-3 sm:mt-10 md:grid-cols-3">
        {pains.map(({ before, after }) => (
          <li
            key={before}
            className="flex flex-col rounded-xl bg-white/2.5 p-5 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)]"
          >
            <p className="flex gap-2.5 text-sm leading-6 text-muted-foreground">
              <Minus
                aria-hidden
                className="mt-1 size-4 shrink-0 text-red-300/70"
              />
              <span>
                <span className="sr-only">Without Lictory: </span>
                {before}
              </span>
            </p>
            <p className="mt-3 flex gap-2.5 border-t border-white/6 pt-3 text-sm leading-6 text-foreground/90">
              <Check
                aria-hidden
                className="mt-1 size-4 shrink-0 text-emerald-400"
              />
              <span>
                <span className="sr-only">With Lictory: </span>
                {after}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Refinement() {
  return (
    <Section id="features">
      <SectionHeading
        eyebrow="How it works"
        title="From “what if” to ready to build."
      >
        One shared specification. Every perspective. A clear next step.
      </SectionHeading>
      <ol className="mt-7 grid gap-3 sm:mt-10 md:grid-cols-3">
        {[
          {
            title: "Bring the rough idea",
            text: "Start with a problem, a few notes or an existing ticket.",
            icon: PenLine,
          },
          {
            title: "Reach agreement together",
            text: "Discuss exact sentences. Suggest changes. Review each revision.",
            icon: MessageSquareText,
          },
          {
            title: "Build what was agreed",
            text: "Approve the spec, break it into work and deliver your way.",
            icon: CheckCircle2,
          },
        ].map(({ title, text, icon: Icon }, index) => (
          <li
            key={title}
            className="flex gap-4 rounded-xl bg-white/2.5 p-5 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)] md:flex-col"
          >
            <div className="flex shrink-0 items-center gap-3">
              <span className="grid size-9 place-items-center rounded-lg bg-violet-400/10 text-violet-300">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="hidden font-mono text-xs text-muted-foreground md:block">
                0{index + 1}
              </span>
            </div>
            <div>
              <h3 className="text-sm font-medium">{title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {text}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <details className="group mt-6 rounded-xl border border-white/8 px-5">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          Explore the review tools{" "}
          <span
            aria-hidden
            className="text-muted-foreground group-open:rotate-45"
          >
            +
          </span>
        </summary>
        <div className="grid gap-3 pb-5 sm:grid-cols-2 lg:grid-cols-3">
          <Card icon={<History />} title="Immutable revisions">
            Return to exactly what was agreed.
          </Card>
          <Card icon={<FileDiff />} title="Readable diffs">
            See what changed between revisions.
          </Card>
          <Card icon={<MessageSquareText />} title="Anchored threads">
            Keep every discussion attached to its context.
          </Card>
          <Card icon={<PenLine />} title="Actionable suggestions">
            Accept wording as a new revision, or reject it.
          </Card>
          <Card icon={<GitPullRequestArrow />} title="Revision-bound approvals">
            Material changes flag approvals for another review.
          </Card>
          <Card icon={<Lightbulb />} title="Durable decisions">
            Keep important conclusions beyond the thread.
          </Card>
        </div>
      </details>
    </Section>
  );
}

function Readiness() {
  return (
    <Section id="readiness">
      <div className="grid items-center gap-7 lg:grid-cols-2 lg:gap-16">
        <SectionHeading
          eyebrow="Readiness"
          title="Know what still needs an answer."
        >
          Reviews, blockers and acceptance criteria make readiness visible.
          Approvals stay tied to the revision your team reviewed.
        </SectionHeading>
        <div className="rounded-xl bg-card/70 p-5 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)]">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">Revision 14</span>
            <span className="rounded-full bg-amber-400/10 px-2 py-1 text-xs text-amber-300">
              Needs review
            </span>
          </div>
          <ul className="mt-4 space-y-3 text-sm">
            {[
              ["Acceptance criteria", true],
              ["Product approval · rev 14", true],
              ["Engineering approval · rev 12", false],
              ["1 blocking discussion", false],
            ].map(([label, passed]) => (
              <li key={String(label)} className="flex items-center gap-3">
                {passed ? (
                  <CheckCircle2
                    aria-hidden
                    className="size-4 shrink-0 text-emerald-400"
                  />
                ) : (
                  <CircleDashed
                    aria-hidden
                    className="size-4 shrink-0 text-amber-300"
                  />
                )}
                <span className="text-foreground/85">{label}</span>
                <span
                  className={cn(
                    "ml-auto text-xs",
                    passed ? "text-emerald-300" : "text-amber-300",
                  )}
                >
                  {passed ? "Passed" : "Review"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-lg bg-violet-400/6 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-violet-300">
              <Sparkles aria-hidden className="size-4" />
              AI finding · proposed
            </p>
            <p className="mt-2 leading-6 text-foreground/80">
              What happens if the payment provider times out?
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              AI surfaces the gap. Your team decides the answer.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

function Delivery({ user }: { user: LandingUser }) {
  return (
    <Section id="delivery">
      <SectionHeading
        eyebrow="Your workflow"
        title="One spec. Your way to ship."
      >
        Choose delivery per team. Keep the same refinement workflow.
      </SectionHeading>
      <div className="mt-7 grid gap-3 sm:mt-10 md:grid-cols-2">
        <div className="rounded-xl bg-white/2.5 p-5 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)] sm:p-7">
          <h3 className="flex items-center gap-2 text-base font-medium">
            <KanbanSquare aria-hidden className="size-4 text-sky-300" />
            Deliver in Lictory
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Boards, backlog, sprints and cycles. From an agreed spec to everyday
            delivery.
          </p>
          <div
            aria-label="Example delivery board"
            className="mt-5 grid grid-cols-3 gap-2 text-[11px]"
          >
            {[
              {
                status: "Unstarted",
                items: ["Retry logic", "Timeout handling"],
              },
              { status: "Started", items: ["Payment API"] },
              { status: "Done", items: ["Test scenarios"] },
            ].map(({ status, items }) => (
              <div key={status} className="rounded-lg bg-white/3 p-2">
                <p className="pb-2 text-muted-foreground">{status}</p>
                <div className="space-y-1.5">
                  {items.map((item) => (
                    <div
                      key={item}
                      className="rounded-md bg-card px-2 py-2 leading-4 text-foreground/85"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-white/2.5 p-5 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)] sm:p-7">
          <h3 className="flex items-center gap-2 text-base font-medium">
            <Split aria-hidden className="size-4 text-emerald-300" />
            Keep your existing tracker
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Refine here. Publish approved work to Jira or Linear, with a link to
            the revision it came from.
          </p>
          <div className="mt-5 rounded-lg bg-white/3 p-4 text-sm">
            <div className="flex items-center gap-2">
              <FileDiff aria-hidden className="size-4 text-violet-300" />
              <span>Approved spec · rev 13</span>
            </div>
            <div className="mt-3 ml-2 space-y-3 border-l border-white/10 pl-4">
              <p className="flex items-center gap-2 text-foreground/80">
                <Check aria-hidden className="size-3.5 text-emerald-300" />
                Retry logic{" "}
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  JIRA-8812
                </span>
              </p>
              <p className="flex items-center gap-2 text-foreground/80">
                <Check aria-hidden className="size-3.5 text-emerald-300" />
                Timeout handling{" "}
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  JIRA-8813
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-5 flex items-center gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck aria-hidden className="size-4 shrink-0" />
        Your team approves. Publishing is an explicit, permission-checked
        action.
      </p>
      <div className="mt-8 flex flex-col gap-4 rounded-xl bg-violet-400/6 p-5 shadow-[inset_0_0_0_1px_oklch(0.7_0.15_285/0.18)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="text-[15px] font-medium">Keep the tracker you have.</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Start refining in Lictory today. Switch delivery mode any time.
          </p>
        </div>
        <CtaLink
          href={user ? "/app" : "/sign-up"}
          size="lg"
          className="h-11 w-full sm:w-auto"
        >
          {user ? "Open your workspace" : "Try it with one spec"}
          <ArrowRight aria-hidden className="size-4" />
        </CtaLink>
      </div>
    </Section>
  );
}

function Comparison() {
  return (
    <Section id="compare">
      <SectionHeading
        eyebrow="Compared with Jira & Linear"
        title="The review workflow is the difference."
      >
        Revisions, contextual discussions and approvals turn a proposal into an
        agreement you can trace.
      </SectionHeading>
      <ComparisonTable />
      <div className="mt-6 flex flex-wrap gap-x-5 gap-y-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <Lock aria-hidden className="size-3.5" />
          Organization isolation
        </span>
        <span className="flex items-center gap-2">
          <ShieldCheck aria-hidden className="size-3.5" />
          Permission checks
        </span>
        <span className="flex items-center gap-2">
          <ScrollText aria-hidden className="size-3.5" />
          Revision &amp; approval history
        </span>
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
      <div className="grid gap-7 lg:grid-cols-[1fr_1.4fr] lg:gap-12">
        <SectionHeading eyebrow="FAQ" title="Questions, answered." />
        <div className="divide-y divide-white/6 border-y border-white/6">
          {items.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-[15px] [&::-webkit-details-marker]:hidden">
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
          Start with one rough idea.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-6 text-muted-foreground sm:text-lg">
          Invite your team. Turn it into a spec you can build.
        </p>
        <div
          data-cta-anchor
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          {user ? (
            <CtaLink
              href="/app"
              size="lg"
              className="h-11 w-full max-w-80 sm:w-auto"
            >
              Open Lictory
              <ArrowRight className="size-4" />
            </CtaLink>
          ) : (
            <>
              <CtaLink
                href="/sign-up"
                size="lg"
                className="h-11 w-full max-w-80 sm:w-auto"
              >
                Start for free
                <ArrowRight className="size-4" />
              </CtaLink>
              <CtaLink
                href="/sign-in"
                size="lg"
                variant="secondary"
                className="h-11 w-full max-w-80 sm:w-auto"
              >
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
    <footer
      data-cta-anchor
      className="border-t border-white/6 px-5 py-10 sm:px-8"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 text-[13px] text-muted-foreground sm:flex-row sm:items-center">
        <Logo className="text-foreground [&>span]:h-6" />
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
