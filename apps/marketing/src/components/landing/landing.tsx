import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
} from "lucide-react";

import { ComparisonTable } from "@lictory/marketing/components/landing/comparison";
import {
  comparisonPath,
  comparisons,
} from "@lictory/marketing/content/comparisons";
import { roundups } from "@lictory/marketing/content/roundups";
import { faqs } from "@lictory/marketing/components/landing/content";
import { StructuredData } from "@lictory/marketing/components/landing/structured-data";
import { MarketingFooter } from "@lictory/marketing/components/marketing/chrome";
import { MarketingHeader } from "@lictory/marketing/components/marketing/header";
import {
  GetStartedCta,
  RepositoryCta,
} from "@lictory/marketing/components/marketing/get-started-cta";
import { ReviewScene } from "@lictory/marketing/components/landing/scenes/review-scene";
import { HeroScene } from "@lictory/marketing/components/landing/scenes/hero-scene";
import { AgentsScene } from "@lictory/marketing/components/landing/scenes/agents-scene";
import { ModelsScene } from "@lictory/marketing/components/landing/scenes/models-scene";
import { SpacesEditorScene } from "@lictory/marketing/components/landing/scenes/spaces-editor-scene";
import { SpacesReviewScene } from "@lictory/marketing/components/landing/scenes/spaces-review-scene";
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
        <Shift />
        <Workflow />
        <Agents />
        <Models />
        <Disciplines />
        <Delivery />
        <Spaces />
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
    <section aria-labelledby="hero-title" className="hero site-width">
      <div className="hero-copy">
        <h1 id="hero-title">Agree on what to build before anyone builds it</h1>
        <div className="hero-side">
          <p className="hero-lead">
            Lictory gives product requirements branches, pull requests and
            checks. Product, engineering, QA and their agents refine the same
            specification in parallel, then approve one reviewed result.
          </p>
          <div className="hero-actions">
            <GetStartedCta placement="hero" page="home" />
            <RepositoryCta placement="hero" page="home" />
          </div>
        </div>
      </div>
      <HeroScene />
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

function Shift() {
  return (
    <section
      id="why-lictory"
      aria-labelledby="why-lictory-title"
      className="section site-width"
    >
      <div className="shift">
        <SectionHeading
          id="why-lictory"
          label="Why Lictory"
          title="Coding agents moved the bottleneck upstream"
        >
          Trackers were built around the part of a work item’s life that took
          longest: implementation. Agents now write much of that code. What
          takes the time is deciding exactly what the code should do, and that
          still happens in scattered documents, threads and meetings.
        </SectionHeading>
        <ShiftChart />
      </div>
      <div className="principles">
        <div>
          <h3>Intent before assignment</h3>
          <p>
            Agree on the problem, the expected behavior and the constraints
            before the item reaches a developer or an agent.
          </p>
        </div>
        <div>
          <h3>Questions before rework</h3>
          <p>
            Find failure cases, conflicting assumptions and missing criteria
            while they cost a sentence to fix, not a sprint.
          </p>
        </div>
        <div>
          <h3>Evidence before ready</h3>
          <p>
            Ready means the checks passed: the revision that was reviewed, its
            approvals, and no open blockers.
          </p>
        </div>
      </div>
    </section>
  );
}

function ShiftChart() {
  const rows = [
    {
      era: "Before coding agents",
      parts: [
        ["Define", 22],
        ["Build", 56],
        ["Verify", 22],
      ],
      note: { part: 1, text: "What trackers were built for" },
    },
    {
      era: "With coding agents",
      parts: [
        ["Define", 56],
        ["Build", 22],
        ["Verify", 22],
      ],
      note: { part: 0, text: "What Lictory is built for" },
    },
  ] as const;
  return (
    <figure className="shift-chart">
      <figcaption>
        Where a work item spends its time{" "}
        <span>Illustrative, not measured</span>
      </figcaption>
      {rows.map(({ era, parts, note }) => {
        const offset = parts
          .slice(0, note.part)
          .reduce((sum, [, size]) => sum + size, 0);
        return (
          <div key={era} className="shift-row">
            <p>{era}</p>
            <div className="shift-bar">
              {parts.map(([name, size], index) => (
                <span
                  key={name}
                  data-part={name.toLowerCase()}
                  data-noted={index === note.part || undefined}
                  style={{ width: `${size}%` }}
                >
                  {name}
                </span>
              ))}
            </div>
            <p
              className="shift-note"
              style={{
                marginLeft: `${offset}%`,
                width: `${parts[note.part][1]}%`,
              }}
            >
              {note.text}
            </p>
          </div>
        );
      })}
    </figure>
  );
}

const steps = [
  {
    tag: "Main",
    icon: GitCommitHorizontal,
    name: "Main holds the agreement",
    body: "Every specification has a main line. Each material change to it creates an immutable revision, so you can always return to exactly what was approved.",
  },
  {
    tag: "Branch",
    icon: GitBranch,
    name: "Branch to explore",
    body: "Anyone can branch a specification to try a change. Collaborators and agents commit to it. Independent edits combine on their own; overlapping ones ask a person to choose.",
  },
  {
    tag: "Review",
    icon: GitPullRequest,
    name: "Review the pull request",
    body: "Reviewers from each discipline read the diff and discuss the exact sentence. Lictory Actions can check every new commit, like CI for requirements.",
  },
  {
    tag: "Merge",
    icon: GitMerge,
    name: "Merge one result",
    body: "Approvals record the exact content they covered, so a later change makes them stale. A merge needs every required approval, no blocking discussion and no conflict.",
  },
] as const;

const reviewTools = [
  [
    "Immutable revisions",
    "Return to the exact specification that was reviewed.",
  ],
  ["Readable diffs", "See what changed before making a decision."],
  ["Anchored threads", "Discussions stay attached to the text they are about."],
  ["Actionable suggestions", "Inspect a proposed change before accepting it."],
  ["Revision-bound approvals", "Know which version each reviewer approved."],
  ["Durable decisions", "Keep the conclusion long after the discussion ends."],
] as const;

function Workflow() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="section site-width"
    >
      <div className="workflow">
        <SectionHeading
          id="features"
          label="How it works"
          title="Requirements get branches, pull requests and checks"
        >
          The model that lets many engineers change one codebase safely, applied
          to the specification. Nobody overwrites the agreed version, and
          nothing merges without review.
        </SectionHeading>
        <ol className="steps">
          {steps.map(({ name, body, tag, icon: Icon }, index) => (
            <li key={name}>
              <div className="step-head">
                <span className="step-icon">
                  <Icon aria-hidden />
                </span>
                <span className="step-index">
                  {String(index + 1).padStart(2, "0")} · {tag}
                </span>
              </div>
              <h3>{name}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="review-stage">
        <div className="review-stage-copy">
          <h3>
            See what changed.
            <br />
            Know what you’re approving.
          </h3>
          <p>
            A blocking question on one sentence, a revision that answers it, and
            approvals that name the revision they cover.
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

function Agents() {
  return (
    <section id="agents" aria-labelledby="agents-title" className="agents ink">
      <div className="site-width">
        <SectionHeading
          id="agents"
          label="Agents"
          title="Anything you can do in Lictory, an agent can do for you"
        >
          Every workspace action is a capability with one permission check.
          Click it, ask Litto, or call it from your own agent over MCP. There
          are no human-only workflows and no agent-only shortcuts.
        </SectionHeading>
        <AgentsScene />
        <div className="agent-facts">
          <div>
            <h3>Same permissions</h3>
            <p>
              An agent can never do what its person could not do in the browser.
              Credentials and account security stay with the person.
            </p>
          </div>
          <div>
            <h3>Decisions stay human</h3>
            <p>
              Approvals and merges are decisions. Litto asks before making one,
              and Lictory Intelligence never approves, resolves or merges.
            </p>
          </div>
          <div>
            <h3>Every call on the record</h3>
            <p>
              History shows who changed what, on which revision. Calls made by
              agents are audited too.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Models() {
  return (
    <section
      id="models"
      aria-labelledby="models-title"
      className="models site-width"
    >
      <SectionHeading
        id="models"
        label="Your models"
        title="Use the AI your company trusts, in the cloud or on your own hardware"
      >
        Connect OpenAI, Anthropic, Google Gemini or Vertex AI, Azure OpenAI,
        Amazon Bedrock, Mistral, xAI, Groq, DeepSeek or OpenRouter. Or run
        open-weight models with Ollama, vLLM, LM Studio or llama.cpp, and
        dictate through your own Whisper server. Lictory works without AI, too.
      </SectionHeading>
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
    </section>
  );
}

const disciplines = [
  ["Product", "What outcome should the customer see?"],
  ["Engineering", "What happens if the provider times out?"],
  ["QA", "How do we prove a retry never charges twice?"],
  ["Security", "Who is allowed to trigger another attempt?"],
  ["Operations", "How will we know retries are failing?"],
] as const;

function Disciplines() {
  return (
    <section
      id="collaboration"
      aria-labelledby="collaboration-title"
      className="section site-width split"
    >
      <SectionHeading
        id="collaboration"
        compact
        label="Disciplines"
        title="Every perspective, before the sprint"
      >
        Product, engineering, QA, security and operations review the same
        specification, each from their own angle. Questions attach to the text
        they are about, so nobody has to ask what a comment meant.
      </SectionHeading>
      <ul className="discipline-list">
        {disciplines.map(([who, question]) => (
          <li key={who}>
            <span>{who}</span>
            <p>{question}</p>
          </li>
        ))}
      </ul>
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
        title="Agreed. Now ship it where your team works"
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
            relations. Starting work can wait until the specification passes its
            readiness checks.
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
    "Approvals for the exact result",
    "A later change to the result makes an approval stale and tells the reviewer. Nobody approves their own change.",
  ],
  [
    "Comments on the words",
    "Discussions stay on the text they quote while people keep typing. A blocking comment holds back the merge.",
  ],
  [
    "Access from where it lives",
    "Members of the space’s organization, project or team edit it, and everyone else in the organization reads it. Restricted spaces open only to the people named.",
  ],
  [
    "Work items in the text",
    "Type # to mention PAY-142. Readers see its current status, refinement state and readiness.",
  ],
  [
    "Agents propose, people publish",
    "Agents connected over MCP read pages and propose changes as pull requests. They never type into a live draft.",
  ],
  [
    "On your own server",
    "Live editing runs in your Lictory installation. If it stops, reading, history, comments and reviews keep working.",
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
        label="Spaces"
        title="Write down what the team knows"
      >
        Lictory Spaces keeps runbooks, architecture notes and team handbooks in
        spaces of nested pages. Several people edit a page at once, and the
        editor says Saved only once the server has stored every edit. Readers
        see a change when it is published, through the same reviewed history as
        a specification.
      </SectionHeading>
      <SpacesEditorScene />

      <div className="review-stage spaces-stage">
        <div className="review-stage-copy">
          <h3>
            Change a page
            <br />
            the way you change a spec.
          </h3>
          <p>
            A Reviewed space protects its published pages. Changes wait on a
            branch, show the exact words that changed, and merge only after the
            required reviewers approve that exact result.
          </p>
        </div>
        <SpacesReviewScene />
      </div>

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
        title="Your tracker starts with a task. Lictory starts with agreement"
      >
        Boards and sprints still matter, and Lictory has them. It puts the same
        care into the work that makes an item ready for them.
      </SectionHeading>
      <ComparisonTable />
      <div className="compare-links">
        {comparisons.map((item) => (
          <Link key={item.slug} href={comparisonPath(item)}>
            Lictory vs {item.competitor}
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

function OpenSource() {
  return (
    <section
      id="open-source"
      aria-labelledby="open-source-title"
      className="open-source site-width"
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
        <h2 id="start-title">Bring one rough idea</h2>
        <p>
          Invite the people who need to agree on it. Their agents are welcome
          too.
        </p>
      </div>
      <div className="final-cta-actions">
        <GetStartedCta placement="final" page="home" />
        <RepositoryCta placement="final" page="home" />
      </div>
    </section>
  );
}
