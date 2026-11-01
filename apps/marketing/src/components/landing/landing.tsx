import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  GitBranch,
  GitPullRequest,
  MessageSquareText,
  Code2,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";

import { ComparisonTable } from "@lictory/marketing/components/landing/comparison";
import { comparisons } from "@lictory/marketing/content/comparisons";
import { faqs } from "@lictory/marketing/components/landing/content";
import { StructuredData } from "@lictory/marketing/components/landing/structured-data";
import { MarketingFooter } from "@lictory/marketing/components/marketing/chrome";
import { MarketingHeader } from "@lictory/marketing/components/marketing/header";
import { StartCta } from "@lictory/marketing/components/marketing/account-cta";
import { CtaLink } from "@lictory/marketing/components/marketing/cta-link";
import { ReviewDemo } from "@lictory/marketing/components/landing/review-demo";
import {
  AgentPreview,
  ProductShowcase,
} from "@lictory/marketing/components/landing/product-showcase";
import { openSource } from "@lictory/marketing/lib/open-source";

const startLabel = "Start for free";

export function Landing() {
  return (
    <div className="marketing-site min-h-dvh bg-background text-foreground">
      <MarketingHeader />
      <main id="main-content">
        <Hero />
        <Journey />
        <Problem />
        <Features />
        <Disciplines />
        <Delivery />
        <Comparison />
        <OpenSource />
        <Faq />
        <FinalCta />
      </main>
      <MarketingFooter />
      <StructuredData />
    </div>
  );
}

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="marketing-hero site-width">
      <div className="hero-copy">
        <a href="#open-source" className="hero-announcement">
          <Code2 aria-hidden />
          <span>{openSource.label}</span>
          <ArrowRight aria-hidden />
        </a>
        <h1 id="hero-title">
          Build the right thing.
          <br />
          <span>Then build it fast.</span>
        </h1>
        <p className="hero-lead">
          AI made writing code faster. Lictory helps your team decide what’s
          worth building.
        </p>
        <div className="hero-actions">
          <StartCta label={startLabel} />
          <CtaLink href="#features" variant="secondary" size="lg">
            Explore the workflow <ArrowRight aria-hidden />
          </CtaLink>
        </div>
      </div>
      <div className="hero-product">
        <ProductShowcase />
      </div>
      <p className="hero-caption">
        People and agents. Parallel branches. One agreed specification.
      </p>
    </section>
  );
}

function Journey() {
  return (
    <div
      className="site-width journey"
      aria-label="The path from proposal to delivery"
    >
      <span className="text-foreground">The work before the work</span>
      <ol>
        {["Propose", "Branch", "Refine", "Review", "Deliver"].map((step, i) => (
          <li key={step}>
            <span className="font-mono text-xs text-muted-foreground">
              0{i + 1}
            </span>
            {step}
            {i < 4 && <ArrowRight aria-hidden />}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Section({
  id,
  label,
  title,
  children,
  intro,
}: {
  id: string;
  label: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="marketing-section site-width"
    >
      <div className="section-heading">
        <p className="section-label">{label}</p>
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          {intro && <p className="section-intro">{intro}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Problem() {
  return (
    <Section
      id="why-lictory"
      label="Why Lictory"
      title="The bottleneck has moved"
      intro="When implementation gets faster, deciding what to implement matters more. A well-organized backlog still needs a shared understanding behind it."
    >
      <div className="problem-statement">
        <p>“Product wants to build this.”</p>
        <div className="problem-bridge">
          <GitBranch aria-hidden />
          <span>Refinement is where the gap closes</span>
        </div>
        <p>“Engineering can commit to this.”</p>
      </div>
      <div className="editorial-columns">
        <div>
          <h3>Intent before assignment</h3>
          <p>
            Agree on the problem, expected behavior and constraints before a
            task lands with a developer.
          </p>
        </div>
        <div>
          <h3>Questions before rework</h3>
          <p>
            Surface failure cases, conflicting assumptions and missing criteria
            while they are still easy to change.
          </p>
        </div>
        <div>
          <h3>Evidence before “ready”</h3>
          <p>
            See the reviewed revision, open discussions and readiness checks
            behind the decision to start.
          </p>
        </div>
      </div>
    </Section>
  );
}

function Features() {
  return (
    <Section
      id="features"
      label="The refinement workflow"
      title="Parallel thinking. One agreed result."
      intro="Bring the collaboration model behind code review to the requirements themselves. People and agents can explore changes concurrently without silently overwriting the agreed specification."
    >
      <div className="workflow-grid">
        <article className="workflow-primary">
          <div className="feature-number">
            01 <GitBranch aria-hidden />
          </div>
          <h3>Give every idea a branch</h3>
          <p>
            Start with a rough proposal. Explore a change on a specification
            branch, invite collaborators and open a pull request when it is
            ready for review.
          </p>
          <div className="branch-example">
            <div>
              <span className="branch-node" />
              <span>Agreed specification</span>
              <code>main</code>
            </div>
            <div>
              <span className="branch-node" />
              <span>Engineering explores retries</span>
              <code>retry-policy</code>
            </div>
            <div>
              <span className="branch-node" />
              <span>Litto proposes missing scenarios</span>
              <code>failure-cases</code>
            </div>
            <div>
              <span className="branch-node" />
              <span>QA adds boundary conditions</span>
              <code>qa-scenarios</code>
            </div>
          </div>
        </article>
        <div className="workflow-secondary">
          <article>
            <div className="feature-number">
              02 <GitPullRequest aria-hidden />
            </div>
            <h3>Review the change, in context</h3>
            <p>
              Read the diff. Discuss the exact sentence. Accept or reject a
              suggestion. Human reviews and automated findings meet in the same
              pull request, with their context intact.
            </p>
          </article>
          <article id="readiness">
            <div className="feature-number">
              03 <ShieldCheck aria-hidden />
            </div>
            <h3>Make agreement inspectable</h3>
            <p>
              Approvals identify what was reviewed. Readiness checks expose
              missing evidence and unresolved blockers. Your team decides what
              merges and when work can begin.
            </p>
          </article>
        </div>
      </div>
      <div className="review-stage">
        <div className="review-stage-copy">
          <p className="section-label">From ambiguity to agreement</p>
          <h3>
            See what changed.
            <br />
            Know what you’re approving.
          </h3>
          <p>
            Discuss the exact sentence. Propose a revision. Bring the team to an
            agreed specification, with the history intact.
          </p>
        </div>
        <ReviewDemo />
      </div>
      <details className="review-tools">
        <summary>
          Explore the review tools <span aria-hidden>+</span>
        </summary>
        <div className="editorial-columns">
          {[
            [
              "Immutable revisions",
              "Return to the exact specification that was reviewed.",
            ],
            ["Readable diffs", "See what changed before making a decision."],
            [
              "Anchored threads",
              "Keep discussions attached to their original context.",
            ],
            [
              "Actionable suggestions",
              "Inspect a proposed text change before accepting it.",
            ],
            [
              "Revision-bound approvals",
              "Know which version each reviewer approved.",
            ],
            [
              "Durable decisions",
              "Keep the conclusion long after the discussion ends.",
            ],
          ].map(([title, body]) => (
            <div key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </details>
      <AgentSection />
    </Section>
  );
}

function AgentSection() {
  return (
    <div id="agents" className="agent-section">
      <div>
        <p className="section-label">Agent access is part of the design</p>
        <h2>
          Your UI. Your agent.
          <br />
          Your choice.
        </h2>
        <p className="section-intro">
          Refinement should not depend on who is clicking. Work directly in
          Lictory, ask Litto, or connect your own agent through MCP.
        </p>
        <p className="mt-6 text-sm leading-7 text-muted-foreground">
          The same work item capabilities and permissions sit behind all three.
          Agents contribute changes and findings; decisions stay with the people
          responsible for the work.
        </p>
      </div>
      <AgentPreview />
    </div>
  );
}

function Disciplines() {
  return (
    <Section
      id="collaboration"
      label="A shared specification"
      title="Every perspective, before the sprint"
      intro="Product, engineering, QA, security and operations contribute to the same requirement. Asynchronously, with the context that makes each question useful."
    >
      <div className="discipline-list">
        {[
          ["Product", "What outcome should the customer see?"],
          ["Engineering", "What happens if the provider times out?"],
          ["QA", "How do we prove a retry never charges twice?"],
          ["Security", "Who is allowed to trigger another attempt?"],
          ["Operations", "How will we know retries are failing?"],
        ].map(([who, question]) => (
          <div key={who}>
            <span>{who}</span>
            <p>{question}</p>
            <MessageSquareText aria-hidden />
          </div>
        ))}
      </div>
    </Section>
  );
}

function Delivery() {
  return (
    <Section
      id="delivery"
      label="From agreement to delivery"
      title="Keep the context. Choose where to ship."
      intro="Once the specification is agreed, decompose it into implementation work. Each project chooses one system to own delivery."
    >
      <div className="delivery-options">
        <article>
          <span className="font-mono text-xs text-muted-foreground">
            In Lictory
          </span>
          <h3>Refine and deliver in one place</h3>
          <p>
            Run boards, a ranked backlog, sprints or cycles. Track estimates,
            subtasks and dependencies without losing the specification behind
            the work.
          </p>
          <div className="delivery-statuses">
            <span>Backlog</span>
            <ArrowRight aria-hidden />
            <span>In progress</span>
            <ArrowRight aria-hidden />
            <span>Done</span>
          </div>
        </article>
        <article>
          <span className="font-mono text-xs text-muted-foreground">
            In your existing tracker
          </span>
          <h3>Better inputs for Jira</h3>
          <p>
            Publish approved delivery items to Jira, linked to the revision they
            came from. Keep refinement in Lictory and execution in your team’s
            delivery system.
          </p>
          <p className="mt-6 text-xs text-muted-foreground">
            Jira available · Linear support is coming
          </p>
        </article>
      </div>
      <p className="mt-6 flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck aria-hidden className="shrink-0" />
        Publishing is an explicit, permission-checked action
      </p>
    </Section>
  );
}

function Comparison() {
  return (
    <Section
      id="compare"
      label="A different starting point"
      title="Your tracker starts with a task. Start with agreement."
      intro="Boards and sprints still matter. Lictory puts the same care into the work that makes an item ready for them."
    >
      <ComparisonTable />
      <div className="mt-8 flex flex-wrap gap-6 text-sm text-muted-foreground">
        {comparisons.map((item) => (
          <Link
            key={item.slug}
            href={`/compare/${item.slug}`}
            className="inline-flex items-center gap-2 hover:text-foreground"
          >
            Lictory vs {item.competitor}
            <ArrowRight aria-hidden />
          </Link>
        ))}
      </div>
    </Section>
  );
}

function OpenSource() {
  return (
    <section
      id="open-source"
      aria-labelledby="open-source-title"
      className="open-source-section site-width"
    >
      <div>
        <h2 id="open-source-title">Open source. Yours to shape.</h2>
        <p>
          {openSource.summary} {openSource.detail}
        </p>
      </div>
      <a href={openSource.repositoryUrl} className="source-link">
        View on GitHub <ArrowUpRight aria-hidden />
      </a>
    </section>
  );
}

function Faq() {
  return (
    <Section id="faq" label="A few useful answers" title="Before you begin">
      <div className="faq-list">
        {faqs.map(({ question, answer }) => (
          <details key={question}>
            <summary>
              <h3 className="faq-question">{question}</h3>
              <span aria-hidden>+</span>
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function FinalCta() {
  return (
    <section aria-labelledby="start-title" className="final-cta site-width">
      <div>
        <p className="section-label">
          <span className="branch-tick" aria-hidden />A better place to start
        </p>
        <h2 id="start-title">
          Your next feature deserves
          <br />a shared understanding
        </h2>
        <p>Bring the rough idea. Invite your team. Refine it together.</p>
      </div>
      <StartCta label={startLabel} />
    </section>
  );
}
