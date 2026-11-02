"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  Check,
  CircleDashed,
  GitBranch,
  GitMerge,
  GitPullRequest,
  RotateCcw,
  SquareTerminal,
} from "lucide-react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";

/*
 * The hero illustration: one specification's branch graph, read left to right
 * as time. Main holds revision 12. Engineering branches it; Litto and an MCP
 * agent branch from that work at the same moment and commit in parallel;
 * their work merges back, the pull request collects its check and three
 * discipline approvals, and merges as revision 13.
 *
 * Every element is in its final place in the markup. The entrance is CSS
 * animation timed by its x position, so the server render, reduced motion and
 * a still screenshot all show the payoff. Nothing here is a live workspace.
 */

/** Milliseconds per unit of the 1000-unit time axis. */
const MS = 8;
/** Lane centers, in pixels from the top of the track. */
const Y = { main: 32, eng: 96, ai: 160, mcp: 224 } as const;
type Lane = keyof typeof Y;

const at = (x: number, extra = 0) =>
  ({ "--d": `${Math.round(x * MS + extra)}ms` }) as CSSProperties;

function Segment({ lane, from, to }: { lane: Lane; from: number; to: number }) {
  return (
    <span
      className="sg-segment"
      data-lane={lane}
      style={
        {
          ...at(from),
          "--dur": `${(to - from) * MS}ms`,
          left: `${from / 10}%`,
          width: `${(to - from) / 10}%`,
          top: Y[lane],
        } as CSSProperties
      }
    />
  );
}

function Dot({
  lane,
  x,
  kind = "commit",
}: {
  lane: Lane;
  x: number;
  kind?: "commit" | "merge" | "revision";
}) {
  return (
    <span
      className="sg-dot"
      data-lane={lane}
      data-kind={kind}
      style={{ ...at(x), left: `${x / 10}%`, top: Y[lane] }}
    />
  );
}

function Label({
  lane,
  x,
  children,
  revision,
}: {
  lane: Lane;
  x: number;
  children: ReactNode;
  /** Revision labels stay visible at every width. */
  revision?: "start" | "end";
}) {
  return (
    <span
      className="sg-label"
      data-revision={revision}
      style={{ ...at(x, 120), left: `${x / 10}%`, top: Y[lane] }}
    >
      {children}
    </span>
  );
}

/** A curve from one lane to another, drawn in a 1000 × 256 box. */
function curve(x1: number, from: Lane, x2: number, to: Lane) {
  const y1 = Y[from];
  const y2 = Y[to];
  const mid = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
}

const curves: { d: string; lane: Lane; x: number; to: number }[] = [
  { d: curve(40, "main", 130, "eng"), lane: "eng", x: 40, to: 130 },
  { d: curve(150, "eng", 250, "ai"), lane: "ai", x: 150, to: 250 },
  { d: curve(150, "eng", 280, "mcp"), lane: "mcp", x: 150, to: 280 },
  { d: curve(560, "ai", 640, "eng"), lane: "ai", x: 560, to: 640 },
  { d: curve(610, "mcp", 700, "eng"), lane: "mcp", x: 610, to: 700 },
  { d: curve(780, "eng", 900, "main"), lane: "eng", x: 780, to: 900 },
];

function Track() {
  return (
    <div className="sg-track">
      <svg
        className="sg-curves"
        viewBox="0 0 1000 256"
        preserveAspectRatio="none"
        aria-hidden
      >
        {curves.map(({ d, lane, x, to }) => (
          <path
            key={d}
            d={d}
            data-lane={lane}
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            style={{ ...at(x), "--dur": `${(to - x) * MS}ms` } as CSSProperties}
          />
        ))}
      </svg>

      <Segment lane="main" from={0} to={1000} />
      <Segment lane="eng" from={130} to={780} />
      <Segment lane="ai" from={250} to={560} />
      <Segment lane="mcp" from={280} to={610} />

      <Dot lane="main" x={40} kind="revision" />
      <Label lane="main" x={40} revision="start">
        Revision 12
      </Label>

      <Dot lane="eng" x={150} />
      <Label lane="eng" x={150}>
        Limit retries to three attempts
      </Label>
      <Dot lane="eng" x={520} />
      <Label lane="eng" x={520}>
        Reuse the transaction ID
      </Label>

      <Dot lane="ai" x={310} />
      <Label lane="ai" x={310}>
        Add timeout scenarios
      </Label>
      <Dot lane="ai" x={470} />

      <Dot lane="mcp" x={360} />
      <Label lane="mcp" x={360}>
        Add boundary cases
      </Label>
      <Dot lane="mcp" x={530} />

      <Dot lane="eng" x={640} kind="merge" />
      <Dot lane="eng" x={700} kind="merge" />

      <Dot lane="main" x={900} kind="revision" />
      <Label lane="main" x={900} revision="end">
        Revision 13
      </Label>
    </div>
  );
}

function Person({ initials, lane }: { initials: string; lane: Lane }) {
  return (
    <span className="sg-person" data-lane={lane} aria-hidden>
      {initials}
    </span>
  );
}

function Lanes() {
  return (
    <ul className="sg-lanes">
      <li data-lane="main">
        <span className="sg-person" data-lane="main" aria-hidden>
          <GitBranch />
        </span>
        <span>
          <strong>Agreed version</strong>
          <small>main</small>
        </span>
      </li>
      <li data-lane="eng">
        <Person initials="TM" lane="eng" />
        <span>
          <strong>Theo Martin</strong>
          <small>retry-policy</small>
        </span>
      </li>
      <li data-lane="ai">
        <span className="sg-person" data-lane="ai" aria-hidden>
          <IntelligenceMark />
        </span>
        <span>
          <strong>Litto</strong>
          <small>failure-cases</small>
        </span>
      </li>
      <li data-lane="mcp">
        <span className="sg-person" data-lane="mcp" aria-hidden>
          <SquareTerminal />
        </span>
        <span>
          <strong>Ana’s agent · MCP</strong>
          <small>qa-boundaries</small>
        </span>
      </li>
    </ul>
  );
}

function CheckRow({
  x,
  label,
  detail,
}: {
  x: number;
  label: string;
  detail: string;
}) {
  return (
    <li className="sg-check" style={at(x)}>
      <span className="sg-check-icon" aria-hidden>
        <CircleDashed className="sg-pending" />
        <Check className="sg-done" />
      </span>
      <span>{label}</span>
      <small>{detail}</small>
    </li>
  );
}

function PullRequest() {
  return (
    <aside className="sg-pr">
      <div className="sg-pr-head">
        <GitPullRequest aria-hidden />
        <strong>Retry policy</strong>
        <span className="sg-state" style={at(900, 200)}>
          <span className="sg-state-open">Open</span>
          <span className="sg-state-merged">Merged</span>
        </span>
      </div>
      <p className="sg-pr-refs">
        <code>retry-policy</code> → <code>main</code>
      </p>
      <p className="sg-pr-heading">Checks and reviews</p>
      <ul>
        <CheckRow x={735} label="Lictory Intelligence" detail="Passed" />
        <CheckRow x={790} label="Product" detail="Maya Chen" />
        <CheckRow x={820} label="Engineering" detail="Priya Shah" />
        <CheckRow x={850} label="QA" detail="Jonas Weber" />
      </ul>
      <div className="sg-merge" style={at(900, 200)}>
        <span className="sg-merge-button">
          <GitMerge aria-hidden /> Merge
        </span>
        <span className="sg-merged">
          <GitMerge aria-hidden /> Merged as revision 13
        </span>
      </div>
    </aside>
  );
}

export function SpecGraph() {
  // Replaying remounts the scene, which restarts every CSS animation.
  const [run, setRun] = useState(0);
  return (
    <figure className="spec-graph">
      <div
        key={run}
        className="sg-window"
        role="img"
        aria-label="Theo from engineering, Litto and Ana’s agent change the payment retry specification on parallel branches. Their work merges into one pull request, which passes its Lictory Intelligence check, collects product, engineering and QA approval and merges as revision 13."
      >
        <div className="sg-bar">
          <span className="sg-key">PAY-142</span>
          <span className="sg-title">Retry failed payments</span>
          <span className="sg-tabs" aria-hidden>
            <span>Specification</span>
            <span data-active>Branches</span>
            <span>Discussions</span>
          </span>
        </div>
        <div className="sg-body">
          <Lanes />
          <Track />
          <PullRequest />
        </div>
      </div>
      <button
        type="button"
        className="sg-replay"
        onClick={() => setRun((value) => value + 1)}
      >
        <RotateCcw aria-hidden /> Replay
      </button>
    </figure>
  );
}
