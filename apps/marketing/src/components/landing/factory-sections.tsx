import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  FileText,
  GitPullRequest,
  Hash,
  MessageSquare,
  PackageCheck,
  Server,
  UserCheck,
} from "lucide-react";

import {
  autonomyLevels,
  loopStages,
  modules,
  stackRows,
  type ModuleId,
} from "@lictory/marketing/components/landing/content";

// Static parts of the landing page's factory story: the loop, the modules,
// the autonomy levels and the comparison with a tool stack. Everything here
// is plain HTML and CSS, so it renders without scripts and costs no motion.

const stageIcons = [
  MessageSquare,
  FileText,
  Bot,
  GitPullRequest,
  PackageCheck,
] as const;

/** The five stages of the loop, each ending at the gate that lets work past. */
export function LoopDiagram() {
  return (
    <ol
      className="loop"
      aria-label="The loop from conversation to shipped code"
    >
      {loopStages.map(({ name, title, body, gate }, index) => {
        const Icon = stageIcons[index]!;
        const GateIcon = gate.by === "person" ? UserCheck : BadgeCheck;
        return (
          <li key={name} className="loop-stage">
            <div className="loop-head">
              <span className="loop-icon">
                <Icon aria-hidden />
              </span>
              <span className="loop-index">
                {String(index + 1).padStart(2, "0")} · {name}
              </span>
            </div>
            <h3>{title}</h3>
            <p>{body}</p>
            <p className="loop-gate" data-by={gate.by}>
              <GateIcon aria-hidden />
              <span>
                <span className="sr-only">
                  {gate.by === "person"
                    ? "Decided by a person: "
                    : "Evidence: "}
                </span>
                {gate.text}
              </span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** A small, decorative scene for each module card. */
function Vignette({ id }: { id: ModuleId }) {
  const scenes: Record<ModuleId, ReactNode> = {
    channels: (
      <>
        <div className="mv-line">
          <Hash /> <strong>payments</strong>
        </div>
        <div className="mv-message">
          <span className="mv-avatar" data-tone="a">
            MC
          </span>
          <span>Refunds over the API?</span>
        </div>
        <div className="mv-message">
          <span className="mv-avatar mv-agent">
            <Bot />
          </span>
          <span>
            Forge <em>via Priya</em>
          </span>
          <span className="mv-tag">Agent</span>
        </div>
        <div className="mv-chip">
          <span className="mv-key">PAY-142</span> Proposal
        </div>
      </>
    ),
    work: (
      <>
        <div className="mv-line">
          <strong>Refunds over the API</strong>
          <span className="mv-pill">Revision 4</span>
        </div>
        {["Acceptance criteria", "No blocking discussions", "QA approved"].map(
          (check) => (
            <div key={check} className="mv-check">
              <Check /> {check}
            </div>
          ),
        )}
        <div className="mv-ready">Ready</div>
      </>
    ),
    factory: (
      <>
        <div className="mv-runner">
          <Server /> <span className="mv-key">build-01</span>
          <span className="mv-status" data-tone="ok">
            Running
          </span>
        </div>
        <div className="mv-runner">
          <Server /> <span className="mv-key">mac-mini</span>
          <span className="mv-status" data-tone="wait">
            Waiting
          </span>
        </div>
        <div className="mv-ask">Atlas asks Theo for approval</div>
      </>
    ),
    code: (
      <>
        <div className="mv-line">
          <GitPullRequest /> <span className="mv-key">#318</span>
          <strong>Add the refund endpoint</strong>
        </div>
        <div className="mv-row">
          <span className="mv-status" data-tone="ok">
            CI passed
          </span>
          <span className="mv-status" data-tone="ok">
            Approved
          </span>
        </div>
        <div className="mv-chip">
          Linked to <span className="mv-key">PAY-148</span>
        </div>
      </>
    ),
    spaces: (
      <>
        <div className="mv-tree">Runbooks</div>
        <div className="mv-tree" data-depth="1" data-active>
          Refund incidents
          <span className="mv-caret" data-tone="a" />
          <span className="mv-caret" data-tone="b" />
        </div>
        <div className="mv-tree" data-depth="1">
          Payments architecture
        </div>
        <div className="mv-tree">Team handbook</div>
      </>
    ),
    desktop: (
      <div className="mv-desktop">
        <div className="mv-rail">
          <span data-active />
          <span>
            <span className="mv-badge">3</span>
          </span>
          <span />
        </div>
        <div className="mv-toast">
          <strong>Forge needs your approval</strong>
          <span>PAY-149 · mac-mini</span>
        </div>
      </div>
    ),
  };
  return (
    <div className="module-vignette" aria-hidden>
      {scenes[id]}
    </div>
  );
}

export function ModuleGrid() {
  return (
    <ul className="module-grid">
      {modules.map(({ id, name, summary, features, link }) => (
        <li key={id} className="module-card">
          <Vignette id={id} />
          <h3>{name}</h3>
          <p>{summary}</p>
          <ul className="module-features">
            {features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          {link ? (
            <Link href={link.href} className="module-link">
              {link.label}
              <ArrowRight aria-hidden />
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function AutonomyLevels() {
  return (
    <ul className="autonomy" aria-label="Autonomy levels">
      {autonomyLevels.map(({ name, isDefault, body }) => (
        <li key={name}>
          <p className="autonomy-name">
            {name}
            {isDefault ? <span>Default</span> : null}
          </p>
          <p>{body}</p>
        </li>
      ))}
    </ul>
  );
}

const stackCaption =
  "What a team needs, in a typical tool stack and in Lictory";

/**
 * Where each need lives in a stack of separate tools and in Lictory. A table
 * from tablets up, one card per need on phones; both stay in the HTML.
 */
export function StackComparison() {
  return (
    <div className="stack-compare">
      <table className="stack-table">
        <caption className="sr-only">{stackCaption}</caption>
        <thead>
          <tr>
            <th scope="col">Need</th>
            <th scope="col">Separate tools</th>
            <th scope="col">Lictory</th>
          </tr>
        </thead>
        <tbody>
          {stackRows.map(({ need, stack, lictory }) => (
            <tr key={need}>
              <th scope="row">{need}</th>
              <td>{stack}</td>
              <td>{lictory}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="stack-cards" aria-label={stackCaption}>
        {stackRows.map(({ need, stack, lictory }) => (
          <li key={need}>
            <p className="stack-need">{need}</p>
            <dl>
              <div>
                <dt>Separate tools</dt>
                <dd>{stack}</dd>
              </div>
              <div data-lictory>
                <dt>Lictory</dt>
                <dd>{lictory}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <p className="stack-note">
        Keep a dedicated tool where you depend on what only it does, such as a
        marketplace app, service management, time tracking or video calls.
        Lictory publishes approved work to Jira Cloud and can link a channel to
        a Slack channel, so a team can move one piece at a time.
      </p>
    </div>
  );
}
