"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  GitBranch,
  GitMerge,
  GitPullRequest,
  SquareTerminal,
} from "lucide-react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";

import { Stage } from "@lictory/marketing/vendor/stageshow/stage";
import type { Act } from "@lictory/marketing/vendor/stageshow/act";
import type { Layout } from "@lictory/marketing/vendor/stageshow/looks";
import { Bar, Window } from "@lictory/marketing/vendor/stageshow/window";
import { Check } from "@lictory/marketing/vendor/stageshow/parts/Check";
import { Facepile } from "@lictory/marketing/vendor/stageshow/parts/Facepile";
import { Avatar } from "@lictory/marketing/vendor/stageshow/parts/Avatar";
import { Badge } from "@lictory/marketing/vendor/stageshow/controls/Badge";
import { States } from "@lictory/marketing/vendor/stageshow/motion/States";
import {
  SceneFrame,
  useSiteTheme,
} from "@lictory/marketing/components/landing/scenes/scene-frame";
import "./hero-scene.css";

/*
 * The hero: one specification's pull request, in the product's own window.
 *
 * Story (what the system does, then one human decision): Theo branches the
 * payment retry specification from revision 12. Litto and Ana's agent branch
 * from his work and commit beside him, at the same time. Their branches merge
 * back, the Lictory Intelligence check passes, product, engineering and QA
 * approve, and a person presses Merge: the agreed version becomes revision
 * 13. Plays once and rests on the merged result; Replay remounts it.
 *
 * Real strings: the item, the commit messages, the people, the checks and
 * the merge. The diff under the graph is filler that fades with the window's
 * foot. Approvers are not contributors: contributors can't approve their own
 * changes. Nothing here is a live workspace.
 */

type S = { beat: number };

const initial: S = { beat: 0 };
const MERGED = 13;
const poster: S = { beat: MERGED };

type Lane = "main" | "theo" | "litto" | "ana";

/** The graph is laid out on a 540-unit time axis, then scaled to the track. */
const AXIS = 540;

type Node = {
  id: string;
  lane: Lane;
  x: number;
  beat: number;
  kind?: "commit" | "merge" | "revision";
  label?: string;
  /** Labels a narrow track still has room for. */
  keep?: boolean;
};

const NODES: Node[] = [
  {
    id: "r12",
    lane: "main",
    x: 18,
    beat: 0,
    kind: "revision",
    label: "Revision 12",
    keep: true,
  },
  {
    id: "t1",
    lane: "theo",
    x: 84,
    beat: 1,
    label: "Cap retries at three",
    keep: true,
  },
  { id: "l1", lane: "litto", x: 170, beat: 2, label: "Add timeout scenarios" },
  { id: "a1", lane: "ana", x: 196, beat: 3, label: "Add boundary cases" },
  {
    id: "t2",
    lane: "theo",
    x: 250,
    beat: 4,
    label: "Reuse the transaction ID",
  },
  { id: "l2", lane: "litto", x: 350, beat: 5 },
  { id: "a2", lane: "ana", x: 376, beat: 6 },
  { id: "m1", lane: "theo", x: 430, beat: 7, kind: "merge" },
  { id: "m2", lane: "theo", x: 470, beat: 8, kind: "merge" },
  {
    id: "r13",
    lane: "main",
    x: 520,
    beat: MERGED,
    kind: "revision",
    label: "Revision 13",
    keep: true,
  },
];

/** An edge draws as the node it leads to lands. */
type Edge = { beat: number; lane: Lane; points: [number, Lane][] };

const EDGES: Edge[] = [
  {
    beat: 1,
    lane: "theo",
    points: [
      [18, "main"],
      [64, "theo"],
      [84, "theo"],
    ],
  },
  {
    beat: 2,
    lane: "litto",
    points: [
      [84, "theo"],
      [140, "litto"],
      [170, "litto"],
    ],
  },
  {
    beat: 3,
    lane: "ana",
    points: [
      [84, "theo"],
      [156, "ana"],
      [196, "ana"],
    ],
  },
  {
    beat: 4,
    lane: "theo",
    points: [
      [84, "theo"],
      [250, "theo"],
    ],
  },
  {
    beat: 5,
    lane: "litto",
    points: [
      [170, "litto"],
      [350, "litto"],
    ],
  },
  {
    beat: 6,
    lane: "ana",
    points: [
      [196, "ana"],
      [376, "ana"],
    ],
  },
  {
    beat: 7,
    lane: "theo",
    points: [
      [250, "theo"],
      [430, "theo"],
    ],
  },
  {
    beat: 7,
    lane: "litto",
    points: [
      [350, "litto"],
      [430, "theo"],
    ],
  },
  {
    beat: 8,
    lane: "theo",
    points: [
      [430, "theo"],
      [470, "theo"],
    ],
  },
  {
    beat: 8,
    lane: "ana",
    points: [
      [376, "ana"],
      [470, "theo"],
    ],
  },
  {
    beat: MERGED,
    lane: "theo",
    points: [
      [470, "theo"],
      [520, "main"],
    ],
  },
];

const LANES: { lane: Lane; name: string; branch: string; mark: ReactNode }[] = [
  { lane: "main", name: "Agreed version", branch: "main", mark: <GitBranch /> },
  { lane: "theo", name: "Theo Martin", branch: "retry-policy", mark: "TM" },
  {
    lane: "litto",
    name: "Litto",
    branch: "failure-cases",
    mark: <IntelligenceMark />,
  },
  {
    lane: "ana",
    name: "Ana’s agent · MCP",
    branch: "qa-boundaries",
    mark: <SquareTerminal />,
  },
];

const REVIEWS = [
  { discipline: "Product", person: "Maya Chen", beat: 10 },
  { discipline: "Engineering", person: "Priya Shah", beat: 11 },
  { discipline: "QA", person: "Jonas Weber", beat: 12 },
] as const;

type Geometry = { track: number; pitch: number; top: number };

const GEOMETRY: Record<Layout, Geometry> = {
  wide: { track: 540, pitch: 56, top: 28 },
  compact: { track: 290, pitch: 34, top: 20 },
};

const laneIndex: Record<Lane, number> = { main: 0, theo: 1, litto: 2, ana: 3 };

function path(points: [number, Lane][], g: Geometry) {
  const k = g.track / AXIS;
  const at = ([x, lane]: [number, Lane]) =>
    [x * k, g.top + laneIndex[lane] * g.pitch] as const;
  const [first, ...rest] = points.map(at);
  let d = `M${first![0]} ${first![1]}`;
  let [px, py] = first!;
  for (const [x, y] of rest) {
    if (y === py) d += ` L${x} ${y}`;
    else {
      const mid = (px + x) / 2;
      d += ` C${mid} ${py} ${mid} ${y} ${x} ${y}`;
    }
    px = x;
    py = y;
  }
  return d;
}

async function script(a: Act<S>) {
  const step = async (beat: number, ms: number) => {
    a.put({ beat });
    await a.wait(ms);
  };
  await a.wait(700);
  a.mark("branch");
  await step(1, 1000);
  a.mark("parallel");
  await step(2, 420);
  await step(3, 900);
  await step(4, 380);
  await step(5, 380);
  await step(6, 900);
  a.mark("converge");
  await step(7, 620);
  await step(8, 900);
  a.mark("checks");
  await step(9, 600);
  await step(10, 450);
  await step(11, 450);
  await step(12, 700);
  // A person makes the decision: approvals don't merge anything on their own
  a.mark("merge");
  await a.move({ at: "merge", x: 0.82, y: 0.62 });
  await a.wait(250);
  await a.click();
  a.put({ beat: MERGED });
  await a.wait(600);
  await a.move({ at: "rest", x: 0.5, y: 0.5 });
  await a.wait(2400);
}

function Graph({ s, layout }: { s: S; layout: Layout }) {
  const g = GEOMETRY[layout];
  const k = g.track / AXIS;
  const height = g.top * 2 + g.pitch * 3;
  return (
    <div
      className="hs-graph"
      style={
        { "--pitch": `${g.pitch}px`, "--top": `${g.top}px` } as CSSProperties
      }
    >
      <ul className="hs-lanes" aria-hidden>
        {LANES.map(({ lane, name, branch, mark }) => (
          <li key={lane} data-lane={lane}>
            <span className="hs-mark" data-lane={lane}>
              {mark}
            </span>
            {layout === "wide" ? (
              <span className="hs-who">
                <span className="hs-name">{name}</span>
                <span className="hs-branch">{branch}</span>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="hs-track" style={{ width: g.track, height }}>
        <svg width={g.track} height={height} aria-hidden>
          <path className="hs-main" d={`M0 ${g.top} H${g.track}`} />
          {EDGES.map((edge, i) => (
            <path
              key={i}
              className="hs-edge"
              d={path(edge.points, g)}
              pathLength={1}
              data-lane={edge.lane}
              data-on={s.beat >= edge.beat || undefined}
            />
          ))}
        </svg>
        {NODES.map((node) => {
          const style = {
            left: node.x * k,
            top: g.top + laneIndex[node.lane] * g.pitch,
          };
          const on = s.beat >= node.beat || undefined;
          const label = node.label && (layout === "wide" || node.keep);
          return (
            <span key={node.id}>
              <span
                className="hs-dot"
                data-lane={node.lane}
                data-kind={node.kind ?? "commit"}
                data-on={on}
                data-instant={node.beat === 0 || undefined}
                style={style}
              />
              {label ? (
                <span
                  className="hs-label"
                  data-kind={node.kind ?? "commit"}
                  data-end={node.id === "r13" || undefined}
                  data-on={on}
                  data-instant={node.beat === 0 || undefined}
                  style={style}
                >
                  {node.label}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PullRequest({ s, layout }: { s: S; layout: Layout }) {
  const merged = s.beat >= MERGED;
  const approved = s.beat >= 12;
  const wide = layout === "wide";
  const passed =
    (s.beat >= 9 ? 1 : 0) + REVIEWS.filter(({ beat }) => s.beat >= beat).length;
  return (
    <aside className="hs-pr">
      <div className="hs-pr-head">
        <GitPullRequest className="hs-pr-icon" />
        <span className="hs-pr-title">Retry policy</span>
        <States
          align="end"
          value={merged ? "merged" : "open"}
          states={{
            open: <Badge tone="success">Open</Badge>,
            merged: <Badge className="hs-merged-badge">Merged</Badge>,
          }}
        />
      </div>
      {wide ? (
        <>
          <div className="hs-refs">
            <span>retry-policy</span> → <span>main</span>
          </div>
          <div className="hs-section">Checks</div>
          <div className="hs-row">
            <Check on={s.beat >= 9} pending={s.beat >= 7} />
            <span className="hs-row-label">Lictory Intelligence</span>
            <States
              align="end"
              className="hs-row-detail"
              value={
                s.beat >= 9 ? "passed" : s.beat >= 7 ? "running" : "queued"
              }
              states={{
                queued: "Queued",
                running: "Running",
                passed: "Passed",
              }}
            />
          </div>
          <div className="hs-section">Reviews</div>
          {REVIEWS.map(({ discipline, person, beat }) => (
            <div key={discipline} className="hs-row">
              <Check on={s.beat >= beat} pending={s.beat >= 9} />
              <span className="hs-row-label">{discipline}</span>
              <span className="hs-row-person">
                <Avatar name={person} size={18} />
                {person}
              </span>
            </div>
          ))}
        </>
      ) : (
        // The phone keeps the check and the three reviews as one row
        <div className="hs-row">
          <Check on={approved} pending={s.beat >= 7} />
          <span className="hs-row-label">Checks and reviews</span>
          <States
            align="end"
            className="hs-row-detail"
            value={`n${passed}` as "n0" | "n1" | "n2" | "n3" | "n4"}
            states={{
              n0: "0 of 4",
              n1: "1 of 4",
              n2: "2 of 4",
              n3: "3 of 4",
              n4: "4 of 4",
            }}
          />
        </div>
      )}

      <div className="hs-merge">
        {wide ? (
          <States
            align="start"
            className="hs-merge-note"
            value={merged ? "merged" : approved ? "ready" : "waiting"}
            states={{
              waiting: "Waiting for required reviews.",
              ready: "3 required reviews approved this exact result.",
              merged: "Published as revision 13 of the specification.",
            }}
          />
        ) : null}
        <States
          align="start"
          value={merged ? "merged" : "merge"}
          states={{
            merge: (
              <span
                className="hs-button"
                data-target="merge"
                data-ready={approved || undefined}
              >
                <GitMerge /> Merge pull request
              </span>
            ),
            merged: (
              <span className="hs-button" data-done>
                View revision 13
              </span>
            ),
          }}
        />
      </div>
      <span className="hs-rest" data-target="rest" />
    </aside>
  );
}

function Changes({ layout }: { layout: Layout }) {
  const wide = layout === "wide";
  return (
    <div className="hs-changes">
      <div className="hs-section">Changes on retry-policy</div>
      <div className="hs-diff" data-kind="add">
        <span className="hs-sign">+</span>
        Retries reuse the original transaction ID.
      </div>
      <div className="hs-diff" data-kind="del">
        <span className="hs-sign">−</span>
        Each retry starts a new transaction.
      </div>
      <div className="hs-diff" data-kind="add">
        <span className="hs-sign">+</span>
        <Bar w={wide ? 360 : 200} h={7} r={3.5} tone={3} />
      </div>
      <div className="hs-diff">
        <span className="hs-sign" />
        <Bar w={wide ? 260 : 150} h={7} r={3.5} tone={2} />
      </div>
      <div className="hs-diff">
        <span className="hs-sign" />
        <Bar w={wide ? 330 : 170} h={7} r={3.5} tone={2} />
      </div>
    </div>
  );
}

function Scene({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  const lead = (
    <div className="hs-lead">
      <span className="hs-key">PAY-142</span>
      <span className="hs-item">Retry failed payments</span>
      {wide ? (
        <span className="hs-tabs">
          <span>Specification</span>
          <span data-active>Branches</span>
          <span>Discussions</span>
        </span>
      ) : null}
    </div>
  );
  const toolbar = wide ? (
    <Facepile
      names={["Theo Martin", "Maya Chen", "Priya Shah", "Jonas Weber"]}
      size={22}
    />
  ) : undefined;
  return (
    <Window lead={lead} toolbar={toolbar} className="hs-window">
      <div className="hs-body">
        <div className="hs-work">
          <Graph s={s} layout={layout} />
          {wide ? <Changes layout={layout} /> : null}
        </div>
        <PullRequest s={s} layout={layout} />
      </div>
    </Window>
  );
}

export function HeroScene() {
  const theme = useSiteTheme();
  return (
    <SceneFrame
      className="hero-scene"
      label="Theo from engineering, Litto and Ana’s agent change the payment retry specification on parallel branches. Their work merges into one pull request, which passes its Lictory Intelligence check and collects product, engineering and QA approval. A person merges it as revision 13."
    >
      {(run) => (
        <Stage<S>
          key={run}
          width={1184}
          height={560}
          compact={{ below: 860, width: 390, height: 370 }}
          initial={initial}
          poster={poster}
          script={script}
          play="once"
          theme={theme}
          cursor={{ at: { at: "rest", x: 0.5, y: 0.5 } }}
          className="lx hs"
        >
          {(s, _rect, layout) => <Scene s={s} layout={layout} />}
        </Stage>
      )}
    </SceneFrame>
  );
}
