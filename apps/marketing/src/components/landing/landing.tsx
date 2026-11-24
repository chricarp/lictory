import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import {
  comparisonPath,
  comparisons,
} from "@lictory/marketing/content/comparisons";
import { roundups } from "@lictory/marketing/content/roundups";
import {
  faqs,
  harnesses,
  trustPrinciples,
} from "@lictory/marketing/components/landing/content";
import {
  AutonomyLevels,
  LoopDiagram,
  ModuleGrid,
  StackComparison,
} from "@lictory/marketing/components/landing/factory-sections";
import { StructuredData } from "@lictory/marketing/components/landing/structured-data";
import { MarketingFooter } from "@lictory/marketing/components/marketing/chrome";
import { MarketingHeader } from "@lictory/marketing/components/marketing/header";
import {
  GetStartedCta,
  InstallServerLink,
  RepositoryCta,
} from "@lictory/marketing/components/marketing/get-started-cta";
import { FactoryScene } from "@lictory/marketing/components/landing/scenes/factory-scene";
import { BranchesScene } from "@lictory/marketing/components/landing/scenes/branches-scene";
import { ReviewScene } from "@lictory/marketing/components/landing/scenes/review-scene";
import { RunnersScene } from "@lictory/marketing/components/landing/scenes/runners-scene";
import { AgentsScene } from "@lictory/marketing/components/landing/scenes/agents-scene";
import { ModelsScene } from "@lictory/marketing/components/landing/scenes/models-scene";
import { SpacesEditorScene } from "@lictory/marketing/components/landing/scenes/spaces-editor-scene";
import {
  BoardStill,
  PublishStill,
} from "@lictory/marketing/components/landing/scenes/delivery-scenes";
import { openSource } from "@lictory/marketing/lib/open-source";
import { TrackedLink } from "@lictory/marketing/components/marketing/tracked-link";

export function Landing() {
  return (
    <div className="marketing-site min-h-dvh bg-background text-foreground">
      <MarketingHeader page="home" />
      <main id="main-content">
        <Hero />
        <Loop />
        <Modules />
        <Specifications />
        <Factory />
        <Agents />
        <Delivery />
        <Spaces />
        <SelfHosted />
        <Comparison />
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
    <section aria-labelledby="hero-title" className="hero site-width">
      <div className="hero-copy">
        <h1 id="hero-title">
          From conversation to shipped code. People decide.
        </h1>
        <div className="hero-side">
          <p className="hero-lead">
            Lictory is the control plane of a software factory: your team and
            its agents agree on what to build, and agents write the code on
            machines you control.
          </p>
          <div className="hero-actions">
            <GetStartedCta placement="hero" page="home" />
            <RepositoryCta placement="hero" page="home" />
          </div>
          <InstallServerLink
            placement="hero"
            page="home"
            className="cta-next-step"
          />
        </div>
      </div>
      <FactoryScene />
    </section>
  );
}

/** A section label in the brand accent. */
function Marker({ children }: { children: ReactNode }) {
  return <p className="marker">{children}</p>;
}

function SectionHeading({
  id,
  label,
  title,
  children,
  compact = false,
}: {
  id: string;
  label: string;
  title: ReactNode;
  children?: ReactNode;
  // Supporting sections take a smaller scale, so the main arguments lead.
  compact?: boolean;
}) {
  return (
    <div className={compact ? "section-heading compact" : "section-heading"}>
      <Marker>{label}</Marker>
      <h2 id={`${id}-title`}>{title}</h2>
      {children ? <p className="section-intro">{children}</p> : null}
    </div>
  );
}

function Loop() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="section site-width"
    >
      <SectionHeading
        id="how-it-works"
        label="How it works"
        title="One loop, with a person at every gate"
      >
        Every piece of work moves from a conversation to shipped code through
        the same five stages. Agents do the work inside each stage. Moving past
        a gate is a recorded act by a person, or evidence that the work is done.
      </SectionHeading>
      <LoopDiagram />
    </section>
  );
}

function Modules() {
  return (
    <section
      id="modules"
      aria-labelledby="modules-title"
      className="section site-width"
    >
      <SectionHeading
        id="modules"
        label="Modules"
        title="The tools a software team runs on, in one product"
      >
        Chat, specifications, delivery, agents, code and knowledge share one
        data model, one permission check and one history. A message links to the
        proposal it became, the proposal to its pull requests, the pull request
        to the revision it delivered.
      </SectionHeading>
      <ModuleGrid />
    </section>
  );
}

const reviewTools = [
  [
    "Immutable revisions",
    "Return to the exact specification that was reviewed.",
  ],
  ["Readable diffs", "See what changed before making a decision."],
  ["Anchored threads", "Discussions stay attached to the text they are about."],
  ["Actionable suggestions", "Inspect a proposed change before accepting it."],
  ["Revision-bound approvals", "Know which version each reviewer approved."],
  [
    "Readiness checks",
    "Ready means the checks passed, not that someone set a status.",
  ],
] as const;

function Specifications() {
  return (
    <section
      id="specifications"
      aria-labelledby="specifications-title"
      className="section site-width"
    >
      <SectionHeading
        id="specifications"
        label="Specifications"
        title="Agents build what the team agreed, not what someone typed"
      >
        The approved specification is the contract agents and people work
        against. Product, engineering, QA and their agents propose changes on
        branches, review them as pull requests and approve one result. Nobody
        overwrites the agreed version, and nothing merges without review.
      </SectionHeading>
      <BranchesScene />

      <div className="review-stage">
        <div className="review-stage-copy">
          <h3>
            See what changed.
            <br />
            Know what you’re approving.
          </h3>
          <p>
            A blocking question on one sentence, a revision that answers it, and
            approvals that name the revision they cover. A later change makes
            them stale.
          </p>
        </div>
        <ReviewScene />
      </div>

      <dl className="review-tools" aria-label="Built into every specification">
        {reviewTools.map(([title, body]) => (
          <div key={title}>
            <dt>{title}</dt>
            <dd>{body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Factory() {
  return (
    <section
      id="factory"
      aria-labelledby="factory-title"
      className="section site-width"
    >
      <SectionHeading
        id="factory"
        label="Factory"
        title="Coding agents on machines you control"
      >
        Install <code>lictory-runner</code> on a server, a VPS, a laptop or a
        Mac mini under a desk. It connects out to your Lictory server, needs no
        open port, and runs {harnesses.slice(0, -1).join(", ")} or{" "}
        {harnesses.at(-1)} in a separate git worktree for every session.
      </SectionHeading>
      <RunnersScene />

      <div className="factory-detail">
        <div className="factory-detail-copy">
          <h3>Choose how much runs by itself</h3>
          <p>
            Each project sets its autonomy policy, and can turn it down at any
            time without stranding work: sessions in flight finish or can be
            canceled, and items return to the ready queue.
          </p>
        </div>
        <AutonomyLevels />
      </div>

      <div className="factory-facts">
        <div>
          <h3>Credentials are issued, not stored</h3>
          <p>
            Each session gets a short-lived, repository-scoped code host token
            and a Lictory token bound to its agent. The built-in agent’s model
            calls go through your server, so model keys never reach the runner.
          </p>
        </div>
        <div>
          <h3>Steer every session from its thread</h3>
          <p>
            A session’s thread is where you answer its questions, approve what
            it asks for and send it a message. The Factory view shows its full
            log, its diff and controls to interrupt, cancel or retry.
          </p>
        </div>
        <div>
          <h3>Your code host stays the source</h3>
          <p>
            GitHub, GitLab or Bitbucket, cloud or self-managed. Webhooks are
            verified and replayable, and Lictory writes to the host only through
            explicit commands: create a branch, open, comment on or merge a pull
            request.
          </p>
        </div>
      </div>
    </section>
  );
}

function Agents() {
  return (
    <section id="agents" aria-labelledby="agents-title" className="agents ink">
      <div className="site-width">
        <SectionHeading
          id="agents"
          label="Agents you can trust"
          title="Agents are members of the team, with an accountable person"
        >
          Every workspace action is a capability with one permission check.
          Click it, ask Litto, or call it from your own agent over MCP. There
          are no human-only workflows and no agent-only shortcuts, and nothing
          moves because text said so.
        </SectionHeading>
        <AgentsScene />
        <dl className="trust-list">
          {trustPrinciples.map(({ title, body }) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd>{body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Delivery() {
  return (
    <section
      id="delivery"
      aria-labelledby="delivery-title"
      className="section site-width"
    >
      <SectionHeading
        id="delivery"
        compact
        label="Delivery"
        title="Deliver in Lictory, or publish to Jira"
      >
        Break the approved specification into stories and tasks that remember
        the revision they came from. Each project picks one system to own
        delivery, so nothing is tracked twice.
      </SectionHeading>
      <div className="delivery-options">
        <article>
          <BoardStill />
          <h3>Deliver in Lictory</h3>
          <p>
            Boards, a ranked backlog, sprints or cycles, estimates, subtasks and
            relations. Agents claim only items the readiness policy allows to
            start.
          </p>
        </article>
        <article>
          <PublishStill />
          <h3>Publish to Jira</h3>
          <p>
            Keep refinement in Lictory and execution in Jira. Approved delivery
            items are published with a link to the revision they came from.
            Publishing is an explicit, permission-checked action.
          </p>
          <p className="delivery-meta">Jira today · Linear is coming</p>
        </article>
      </div>
    </section>
  );
}

const spaceFacts = [
  [
    "Direct or Reviewed",
    "Each space chooses: editors publish the live draft, or every change arrives as a pull request that needs approval.",
  ],
  [
    "Every version kept",
    "Published versions never change. Compare any two word by word; restoring an old one adds a new version.",
  ],
  [
    "Work items in the text",
    "Type # to mention PAY-142. Readers see its current status, refinement state and readiness.",
  ],
  [
    "Agents propose, people publish",
    "Agents read pages and propose changes as pull requests. They never type into a live draft.",
  ],
] as const;

/** Lictory Spaces: pages written together live and changed through reviewed history. */
function Spaces() {
  return (
    <section
      id="spaces"
      aria-labelledby="spaces-title"
      className="section site-width"
    >
      <SectionHeading
        id="spaces"
        compact
        label="Spaces"
        title="Write down what the team and its agents know"
      >
        Runbooks, architecture notes and team handbooks live in spaces of nested
        pages. Several people edit a page at once, and the editor says Saved
        only once the server has stored every edit. Readers see a change when it
        is published, through the same reviewed history as a specification.
      </SectionHeading>
      <SpacesEditorScene />
      <dl
        className="review-tools spaces-facts"
        aria-label="Built into every space"
      >
        {spaceFacts.map(([title, body]) => (
          <div key={title}>
            <dt>{title}</dt>
            <dd>{body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const hostingFacts = [
  [
    "On your server",
    "One Linux server with Docker Compose and PostgreSQL, bundled or your own. There is no Lictory cloud: your data stays on the server you run and goes only to the services you connect.",
  ],
  [
    "Company sign-in",
    "Single sign-on through OpenID Connect: Okta, Microsoft Entra ID, Keycloak, Google Workspace and others. Sign-in grants nothing by itself; membership and roles stay in Lictory.",
  ],
  [
    "Organizations kept apart",
    "Every record belongs to one organization, and every query and synchronized view is authorized through membership on the server, never by hiding things in the browser.",
  ],
  [
    "Your runners",
    "Organization runners for shared work, personal runners for one person’s agents. A project can require its sessions to run in containers.",
  ],
] as const;

function SelfHosted() {
  return (
    <section
      id="self-hosted"
      aria-labelledby="self-hosted-title"
      className="section site-width"
    >
      <SectionHeading
        id="self-hosted"
        label="Self-hosted"
        title="Your server, your runners, your models"
      >
        Lictory runs where your code and your knowledge already are. Connect
        OpenAI, Anthropic, Google Gemini or Vertex AI, Azure OpenAI, Amazon
        Bedrock, Mistral, xAI, Groq, DeepSeek or OpenRouter, or run open-weight
        models with Ollama, vLLM, LM Studio or llama.cpp. Lictory works without
        AI, too.
      </SectionHeading>
      <dl className="hosting-facts">
        {hostingFacts.map(([title, body]) => (
          <div key={title}>
            <dt>{title}</dt>
            <dd>{body}</dd>
          </div>
        ))}
      </dl>
      <ModelsScene />
      <div className="model-facts">
        <div>
          <h3>Set up in the admin console</h3>
          <p>
            Pick a provider, paste a key and test every feature before you save.
            Keys stay encrypted on your server. Prefer the terminal?{" "}
            <code>lictory ai setup</code> does the same.
          </p>
        </div>
        <div>
          <h3>Self-hosted means self-hosted</h3>
          <p>
            Choose a model server you run, and content goes there and nowhere
            else. Nothing falls back to a cloud you did not choose.
          </p>
        </div>
        <div>
          <h3>Every organization decides</h3>
          <p>
            Instance administrators choose the provider. Each organization
            chooses whether its content may be sent, and sees where it goes.
          </p>
        </div>
      </div>
      <OpenSource />
    </section>
  );
}

function OpenSource() {
  return (
    <div
      id="open-source"
      role="region"
      aria-labelledby="open-source-title"
      className="open-source"
    >
      <div>
        <h2 id="open-source-title">Open source. Yours to shape.</h2>
        <p>
          {openSource.summary} {openSource.detail}
        </p>
      </div>
      <TrackedLink
        href={openSource.repositoryUrl}
        tracking={{ cta: "github", placement: "open_source", page: "home" }}
        className="source-link"
      >
        View on GitHub <ArrowUpRight aria-hidden />
      </TrackedLink>
    </div>
  );
}

function Comparison() {
  return (
    <section
      id="compare"
      aria-labelledby="compare-title"
      className="section site-width"
    >
      <SectionHeading
        id="compare"
        compact
        label="Compared"
        title="One workspace instead of five tools and the glue between them"
      >
        Most teams stitch a chat app, a wiki, a tracker, a code host and their
        agent tools together with integrations. Lictory keeps your code host and
        can replace the rest with one product: fewer seats to buy, fewer
        integrations to maintain, and one record of who decided what.
      </SectionHeading>
      <StackComparison />
      <div className="compare-links">
        {comparisons.map((item) => (
          <Link key={item.slug} href={comparisonPath(item)}>
            {item.headline}
            <ArrowRight aria-hidden />
          </Link>
        ))}
        {roundups.map((item) => (
          <Link key={item.path} href={item.path}>
            {item.headline}
            <ArrowRight aria-hidden />
          </Link>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="section site-width split"
    >
      <SectionHeading
        id="faq"
        compact
        label="Questions"
        title="Before you begin"
      />
      <div className="faq-list">
        {faqs.map(({ question, answer }) => (
          <details key={question}>
            <summary>
              <h3 className="faq-question">{question}</h3>
              <span aria-hidden />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section aria-labelledby="start-title" className="final-cta site-width">
      <div>
        <h2 id="start-title">Start with one rough idea</h2>
        <p>
          Invite the people who need to agree on it. Register a runner when you
          want agents to build it.
        </p>
      </div>
      <div>
        <div className="final-cta-actions">
          <GetStartedCta placement="final" page="home" />
          <RepositoryCta placement="final" page="home" />
        </div>
        <InstallServerLink
          placement="final"
          page="home"
          className="cta-next-step"
        />
      </div>
    </section>
  );
}
