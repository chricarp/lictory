import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  Check,
  FileDiff,
  GitPullRequestArrow,
  History,
  Inbox,
  KanbanSquare,
  Layers,
  Lightbulb,
  Lock,
  MessageSquareText,
  Minus,
  PenLine,
  ScrollText,
  Search,
  ShieldCheck,
} from "lucide-react";

import { ComparisonTable } from "~/components/landing/comparison";
import { comparisons } from "~/content/comparisons";
import { faqs } from "~/components/landing/content";
import { StructuredData } from "~/components/landing/structured-data";
import { MobileCta } from "~/components/landing/mobile-cta";
import {
  CtaLink,
  MarketingFooter,
  MarketingHeader,
} from "~/components/marketing/chrome";
import { ReviewDemo } from "~/components/landing/review-demo";
import {
  DeliveryVisual,
  DraftVisual,
  FlowLine,
  HeroStage,
  ReadinessVisual,
  ReviewVisual,
} from "~/components/landing/visuals";
import { cn } from "~/lib/utils";

/** Content rises in as it scrolls into view, where scroll-driven CSS exists. */
function Reveal({
  children,
  className,
  as: Component = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li";
}) {
  return (
    <Component className={cn("landing-reveal", className)}>
      {children}
    </Component>
  );
}

/**
 * Where the primary calls to action lead. Signed-in visitors reach the landing
 * page at /home, so they are sent back to the app rather than to sign-up.
 */
type Cta = { href: string; label: string };

export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  const cta: Cta = signedIn
    ? { href: "/app", label: "Open Lictory" }
    : { href: "/sign-up", label: "Start for free" };
  // "/" sends signed-in visitors to the app, so the logo keeps them here.
  const home = signedIn ? "/home" : "/";
  return (
    <div className="dark min-h-dvh bg-[oklch(0.135_0.005_270)] text-foreground">
      <div className="relative overflow-clip">
        <MarketingHeader home={home} signedIn={signedIn} />
        <main>
          <Hero cta={cta} />
          <Journey />
          <Problem />
          <Features />
          <Disciplines />
          <Delivery cta={cta} />
          <Comparison />
          <Faq />
          <FinalCta cta={cta} signedIn={signedIn} />
        </main>
        <MarketingFooter home={home} />
      </div>
      <MobileCta href={cta.href} label={cta.label} />
      <StructuredData />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function rise(delayMs: number) {
  return { animationDelay: `${delayMs}ms` };
}

function Hero({ cta }: { cta: Cta }) {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative px-5 pt-24 pb-10 sm:px-8 sm:pt-40 sm:pb-16"
    >
      {/* Ambient light: a soft beam from above and a faint grid that fades out. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="landing-beam absolute -top-40 left-1/2 h-180 w-[min(1200px,160vw)] -translate-x-1/2 bg-[radial-gradient(50%_50%_at_50%_30%,oklch(0.6_0.19_280/0.32),transparent_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(oklch(1_0_0/0.035)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/0.035)_1px,transparent_1px)] mask-[radial-gradient(60%_50%_at_50%_20%,black,transparent)] bg-size-[64px_64px]" />
      </div>
      <div className="relative mx-auto max-w-6xl">
        <a
          href="#readiness"
          style={rise(0)}
          className="landing-rise mx-auto flex w-fit items-center gap-2 rounded-full bg-white/4 py-1 pr-3 pl-1 text-xs text-foreground/80 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)] transition-colors hover:bg-white/7"
        >
          <span className="relative grid size-5 place-items-center rounded-full bg-violet-400/15">
            <span className="size-1.5 rounded-full bg-violet-300 shadow-[0_0_8px_oklch(0.75_0.15_285)]" />
          </span>
          Requirements, reviewed like code.
          <ArrowRight aria-hidden className="size-3 text-muted-foreground" />
        </a>
        <h1
          id="hero-title"
          style={rise(80)}
          className="landing-rise mx-auto mt-5 max-w-4xl text-center text-[clamp(2.25rem,10.5vw,2.625rem)] leading-[1.02] font-semibold tracking-[-0.05em] sm:mt-7 sm:text-7xl lg:text-[88px]"
        >
          <span className="bg-[linear-gradient(180deg,#fff_30%,oklch(1_0_0/0.55))] bg-clip-text text-transparent">
            Better specs.
            <br />
            Fewer meetings.
          </span>
        </h1>
        <p
          style={rise(180)}
          className="landing-rise mx-auto mt-4 max-w-xl text-center text-base leading-6 text-balance text-muted-foreground sm:mt-6 sm:text-lg sm:leading-7"
        >
          Turn rough ideas into specs that product, engineering and QA agree on.
          Then build with confidence.
        </p>
        <div
          data-cta-anchor
          style={rise(260)}
          className="landing-rise mt-6 flex flex-col items-center justify-center gap-2 sm:mt-8 sm:flex-row sm:gap-3"
        >
          <CtaLink
            href={cta.href}
            size="lg"
            className="w-full max-w-80 sm:w-auto"
          >
            {cta.label}
            <ArrowRight aria-hidden className="size-4" />
          </CtaLink>
          <CtaLink href="#features" variant="ghost" size="lg">
            See how it works <ArrowRight aria-hidden className="size-3.5" />
          </CtaLink>
        </div>
        <ul
          aria-label="Why teams start today"
          style={rise(320)}
          className="landing-rise mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:mt-4"
        >
          {["Free to start", "Set up in minutes", "Works with Jira"].map(
            (item) => (
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
            ),
          )}
        </ul>
        <div style={rise(420)} className="landing-rise mt-6 sm:mt-16">
          <HeroStage>
            <ProductWindow />
          </HeroStage>
        </div>
      </div>
    </section>
  );
}

/** Desktop chrome around the live example; phones see the example alone. */
function ProductWindow() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-10 -top-10 -bottom-20 -z-10 hidden bg-[radial-gradient(50%_50%_at_50%_50%,oklch(0.55_0.2_280/0.25),transparent)] blur-2xl sm:block"
      />
      <div className="sm:rounded-2xl sm:bg-[oklch(0.17_0.006_270/0.9)] sm:p-1.5 sm:shadow-[inset_0_1px_0_oklch(1_0_0/0.1),inset_0_0_0_1px_oklch(1_0_0/0.08),0_50px_120px_-40px_oklch(0_0_0/0.9)] sm:backdrop-blur">
        <div
          aria-hidden
          className="hidden items-center gap-3 px-3 py-2 text-[11px] text-muted-foreground sm:flex"
        >
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-white/12" />
            <span className="size-2.5 rounded-full bg-white/12" />
            <span className="size-2.5 rounded-full bg-white/12" />
          </span>
          <span className="mx-auto flex items-center gap-1.5">
            Payments
            <span className="text-white/20">/</span>
            <span className="font-mono">PAY-142</span>
          </span>
          <span className="w-12" />
        </div>
        <div className="flex gap-1.5">
          <aside
            aria-hidden
            className="hidden w-52 shrink-0 flex-col gap-0.5 rounded-xl bg-white/2 p-2 text-[12px] text-muted-foreground lg:flex"
          >
            {[
              [Inbox, "Inbox", "3"],
              [Search, "Search", ""],
              [GitPullRequestArrow, "In review", "5"],
              [Layers, "Specifications", ""],
              [KanbanSquare, "Board", ""],
            ].map(([Icon, label, count]) => {
              const I = Icon as typeof Inbox;
              const active = label === "In review";
              return (
                <span
                  key={label as string}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5",
                    active && "bg-white/6 text-foreground",
                  )}
                >
                  <I className="size-3.5" />
                  {label as string}
                  {count ? (
                    <span className="ml-auto font-mono text-[10px]">
                      {count as string}
                    </span>
                  ) : null}
                </span>
              );
            })}
            <p className="mt-4 px-2 text-[10px] tracking-wider uppercase">
              Proposals
            </p>
            {[
              ["Retry failed payments", "bg-amber-300"],
              ["Saved cards for guests", "bg-violet-300"],
              ["Refund status emails", "bg-emerald-400"],
              ["Partial captures", "bg-white/30"],
            ].map(([label, dot]) => (
              <span
                key={label}
                className={cn(
                  "flex items-center gap-2 truncate rounded-md px-2 py-1.5",
                  label === "Retry failed payments" &&
                    "bg-white/4 text-foreground/90",
                )}
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
                <span className="truncate">{label}</span>
              </span>
            ))}
          </aside>
          <div className="min-w-0 flex-1">
            <ReviewDemo />
          </div>
        </div>
      </div>
      <p className="mt-5 text-center text-xs text-muted-foreground sm:text-sm">
        Refine together. Deliver in Lictory or your existing tracker.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Journey() {
  return (
    <section
      aria-label="The path from proposal to delivery"
      className="px-5 pt-6 pb-14 sm:px-8 sm:pb-24"
    >
      <Reveal>
        <FlowLine />
      </Reveal>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  children,
  center,
  id,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  center?: boolean;
  id?: string;
}) {
  return (
    <Reveal className={cn("max-w-2xl", center && "mx-auto text-center")}>
      <p className="text-[13px] font-medium text-violet-300">{eyebrow}</p>
      <h2
        id={id}
        className="mt-3 text-3xl leading-[1.08] font-semibold tracking-[-0.04em] text-balance sm:text-5xl"
      >
        {title}
      </h2>
      {children ? (
        <p className="mt-4 text-sm leading-6 text-balance text-muted-foreground sm:text-lg sm:leading-7">
          {children}
        </p>
      ) : null}
    </Reveal>
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
      className={cn("scroll-mt-20 px-5 py-16 sm:px-8 sm:py-28", className)}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      className="mx-auto h-px max-w-6xl bg-linear-to-r from-transparent via-white/10 to-transparent"
    />
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
        id="problem-title"
        title="Stop rebuilding what nobody agreed on."
      >
        Unclear requirements become rework. Lictory makes the gaps visible while
        they are still cheap to fix.
      </SectionHeading>
      <ul className="mt-8 grid gap-3 sm:mt-12 md:grid-cols-3">
        {pains.map(({ before, after }) => (
          <Reveal
            key={before}
            as="li"
            className="flex h-full flex-col rounded-2xl bg-white/2.5 p-5 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)] sm:p-6"
          >
            <p className="flex gap-2.5 text-sm leading-6 text-muted-foreground line-through decoration-white/15">
              <Minus
                aria-hidden
                className="mt-1 size-4 shrink-0 text-red-300/70"
              />
              <span>
                <span className="sr-only">Without Lictory: </span>
                {before}
              </span>
            </p>
            <p className="mt-4 flex gap-2.5 border-t border-white/6 pt-4 text-sm leading-6 text-foreground/90">
              <Check
                aria-hidden
                className="mt-1 size-4 shrink-0 text-emerald-400"
              />
              <span>
                <span className="sr-only">With Lictory: </span>
                {after}
              </span>
            </p>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}

function FeatureRow({
  id,
  index,
  label,
  title,
  body,
  points,
  visual,
  flip,
}: {
  id?: string;
  index: string;
  label: string;
  title: string;
  body: string;
  points: string[];
  visual: ReactNode;
  flip?: boolean;
}) {
  return (
    <div
      id={id}
      className="grid scroll-mt-24 items-center gap-8 py-12 sm:py-20 lg:grid-cols-[1fr_1.15fr] lg:gap-20"
    >
      <Reveal className={cn(flip && "lg:order-2")}>
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <span className="font-mono text-violet-300">{index}</span>
          {label}
        </p>
        <h3 className="mt-3 text-2xl leading-[1.12] font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
          {title}
        </h3>
        <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          {body}
        </p>
        <ul className="mt-6 space-y-2.5 text-sm text-foreground/80">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2.5">
              <Check
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-violet-300"
              />
              {point}
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal className={cn(flip && "lg:order-1")}>{visual}</Reveal>
    </div>
  );
}

function Features() {
  return (
    <>
      <Divider />
      <Section id="features" className="pb-0 sm:pb-0">
        <SectionHeading
          eyebrow="How it works"
          title="From “what if” to ready to build."
          center
        >
          One shared specification. Every perspective. A clear next step.
        </SectionHeading>
        <div className="mt-6 sm:mt-10">
          <FeatureRow
            index="1.0"
            label="Draft"
            title="Bring the rough idea. Leave with a spec."
            body="Start with a problem, a few notes or an existing ticket. Lictory shapes it into objective, behavior and acceptance criteria, and flags what is still missing."
            points={[
              "Proposals are allowed to start imperfect",
              "Lictory Intelligence finds gaps and proposes; a person decides",
              "Nothing is rewritten silently",
            ]}
            visual={<DraftVisual />}
          />
          <FeatureRow
            flip
            index="2.0"
            label="Review"
            title="Discuss the exact sentence, not the whole doc."
            body="Threads attach to the words they are about. Suggestions are real changes you accept or reject, and each accepted change becomes a new revision."
            points={[
              "Anchored threads, blocking or not",
              "Suggestions accepted as new revisions",
              "Product, engineering and QA approve together",
            ]}
            visual={<ReviewVisual />}
          />
          <FeatureRow
            id="readiness"
            index="3.0"
            label="Readiness"
            title="CI for requirements."
            body="Readiness is evidence, not a dropdown. Checks pass as answers arrive, and approvals belong to the revision that was reviewed. Change the spec and the right approval goes stale."
            points={[
              "Acceptance criteria and failure behavior checks",
              "No blocking threads left open",
              "Approvals that know which revision they cover",
            ]}
            visual={<ReadinessVisual />}
          />
        </div>
        <details className="group mb-4 rounded-2xl border border-white/8 px-5 transition-colors open:bg-white/1.5">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            Explore the review tools{" "}
            <span
              aria-hidden
              className="text-muted-foreground transition-transform duration-200 group-open:rotate-45"
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
            <Card
              icon={<GitPullRequestArrow />}
              title="Revision-bound approvals"
            >
              Material changes flag approvals for another review.
            </Card>
            <Card icon={<Lightbulb />} title="Durable decisions">
              Keep important conclusions beyond the thread.
            </Card>
          </div>
        </details>
      </Section>
    </>
  );
}

const concerns = [
  ["Product", "Is the expected outcome measurable?", "text-violet-300"],
  ["Engineering", "Could a retry charge the customer twice?", "text-sky-300"],
  ["QA", "What if the provider answers after our timeout?", "text-emerald-300"],
  ["Security", "Who can see stored card tokens?", "text-rose-300"],
  ["SRE", "How do we roll this back safely?", "text-amber-300"],
  ["Engineering", "Do existing API clients stay compatible?", "text-sky-300"],
  ["QA", "Which boundary values do we test?", "text-emerald-300"],
  ["Product", "Which customers see this first?", "text-violet-300"],
  ["Security", "Can this endpoint be abused at scale?", "text-rose-300"],
  ["SRE", "What alert fires when retries pile up?", "text-amber-300"],
] as const;

function ConcernRow({ reverse }: { reverse?: boolean }) {
  const row = reverse ? [...concerns].reverse() : concerns;
  return (
    <div className="flex overflow-hidden">
      <div
        className="landing-marquee flex shrink-0 gap-3 pr-3"
        style={
          {
            "--marquee-duration": reverse ? "70s" : "55s",
            animationDirection: reverse ? "reverse" : undefined,
          } as CSSProperties
        }
      >
        {[...row, ...row].map(([who, text, color], index) => (
          <div
            key={index}
            aria-hidden={index >= row.length}
            className="w-64 shrink-0 rounded-xl bg-white/2.5 p-4 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)] sm:w-72"
          >
            <p className={cn("flex items-center gap-1.5 text-xs", color)}>
              <MessageSquareText aria-hidden className="size-3.5" />
              {who}
            </p>
            <p className="mt-2 text-sm leading-5 text-foreground/85">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Disciplines() {
  return (
    <section
      aria-labelledby="disciplines-title"
      className="overflow-hidden py-16 sm:py-28"
    >
      <div className="px-5 sm:px-8">
        <SectionHeading
          eyebrow="Everyone at the table"
          id="disciplines-title"
          title="Every discipline asks its question before the sprint."
          center
        >
          Product, engineering, QA, security and operations review the same
          spec, each with the concerns they know best.
        </SectionHeading>
      </div>
      <div className="mt-10 space-y-3 mask-[linear-gradient(90deg,transparent,black_12%,black_88%,transparent)] sm:mt-14">
        <ConcernRow />
        <ConcernRow reverse />
      </div>
    </section>
  );
}

function Delivery({ cta }: { cta: Cta }) {
  return (
    <>
      <Divider />
      <Section id="delivery">
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
          <Reveal>
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className="font-mono text-violet-300">4.0</span>
              Delivery
            </p>
            <h2 className="mt-3 text-3xl leading-[1.08] font-semibold tracking-[-0.04em] text-balance sm:text-5xl">
              One spec. Your way to ship.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-lg sm:leading-7">
              Choose delivery per project. Keep the same refinement workflow.
            </p>
            <div className="mt-7 space-y-5">
              <div className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
                  <KanbanSquare aria-hidden className="size-4" />
                </span>
                <div>
                  <h3 className="text-[15px] font-medium">
                    Deliver in Lictory
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Boards, backlog, sprints and cycles. From an agreed spec to
                    everyday delivery.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300">
                  <ScrollText aria-hidden className="size-4" />
                </span>
                <div>
                  <h3 className="text-[15px] font-medium">
                    Keep your existing tracker
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Publish approved work to Jira, with a link to the revision
                    it came from. Linear support is coming.
                  </p>
                </div>
              </div>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs leading-5 text-muted-foreground">
              <ShieldCheck aria-hidden className="size-4 shrink-0" />
              Your team approves. Publishing is an explicit, permission-checked
              action.
            </p>
          </Reveal>
          <Reveal>
            <DeliveryVisual />
          </Reveal>
        </div>
        <Reveal className="mt-14 flex flex-col gap-4 rounded-2xl bg-[linear-gradient(120deg,oklch(0.6_0.18_285/0.12),oklch(0.6_0.18_285/0.03))] p-5 shadow-[inset_0_0_0_1px_oklch(0.7_0.15_285/0.18)] sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div>
            <p className="text-[15px] font-medium">
              Keep the tracker you have.
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Start refining in Lictory today. Switch delivery mode any time.
            </p>
          </div>
          <CtaLink href={cta.href} size="lg" className="w-full sm:w-auto">
            Try it with one spec
            <ArrowRight aria-hidden className="size-4" />
          </CtaLink>
        </Reveal>
      </Section>
    </>
  );
}

function Comparison() {
  return (
    <>
      <Divider />
      <Section id="compare">
        <SectionHeading
          eyebrow="Compared with Jira & Linear"
          title="The review workflow is the difference."
        >
          Revisions, contextual discussions and approvals turn a proposal into
          an agreement you can trace.
        </SectionHeading>
        <ComparisonTable />
        <p className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
          Detailed comparisons:
          {comparisons.map(({ slug, competitor }) => (
            <Link
              key={slug}
              href={`/compare/${slug}`}
              className="inline-flex items-center gap-1 text-foreground/85 underline decoration-white/20 underline-offset-4 hover:decoration-foreground"
            >
              Lictory vs {competitor}
            </Link>
          ))}
        </p>
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
    </>
  );
}

function Faq() {
  return (
    <>
      <Divider />
      <Section id="faq">
        <div className="grid gap-7 lg:grid-cols-[1fr_1.4fr] lg:gap-12">
          <SectionHeading eyebrow="FAQ" title="Questions, answered." />
          <div className="divide-y divide-white/6 border-y border-white/6">
            {faqs.map(({ question, answer }) => (
              <details key={question} className="group py-4">
                <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-[15px] [&::-webkit-details-marker]:hidden">
                  <h3>{question}</h3>
                  <span
                    aria-hidden
                    className="text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </Section>
    </>
  );
}

function FinalCta({ cta, signedIn }: { cta: Cta; signedIn: boolean }) {
  return (
    <Section className="relative overflow-hidden text-center sm:py-36">
      <div
        aria-hidden
        className="landing-beam pointer-events-none absolute bottom-0 left-1/2 h-120 w-[min(1000px,160vw)] -translate-x-1/2 bg-[radial-gradient(closest-side,oklch(0.6_0.19_280/0.28),transparent)]"
      />
      <Reveal className="relative">
        <h2 className="mx-auto max-w-3xl text-4xl leading-[1.02] font-semibold tracking-[-0.05em] text-balance sm:text-7xl">
          <span className="bg-[linear-gradient(180deg,#fff_30%,oklch(1_0_0/0.55))] bg-clip-text text-transparent">
            Start with one rough idea.
          </span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-6 text-muted-foreground sm:text-lg">
          Invite your team. Turn it into a spec you can build.
        </p>
        <div
          data-cta-anchor
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <CtaLink
            href={cta.href}
            size="lg"
            className="w-full max-w-80 sm:w-auto"
          >
            {cta.label}
            <ArrowRight className="size-4" />
          </CtaLink>
          {!signedIn && (
            <CtaLink
              href="/sign-in"
              size="lg"
              variant="secondary"
              className="w-full max-w-80 sm:w-auto"
            >
              Log in
            </CtaLink>
          )}
        </div>
      </Reveal>
    </Section>
  );
}
