"use client";

import {
  Check as CheckIcon,
  GitPullRequest,
  SquareTerminal,
} from "lucide-react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";

import { Stage } from "@lictory/marketing/vendor/stageshow/stage";
import type { Act } from "@lictory/marketing/vendor/stageshow/act";
import type { Layout } from "@lictory/marketing/vendor/stageshow/looks";
import { Bar, Window } from "@lictory/marketing/vendor/stageshow/window";
import { Avatar } from "@lictory/marketing/vendor/stageshow/parts/Avatar";
import { States } from "@lictory/marketing/vendor/stageshow/motion/States";
import { Collapse } from "@lictory/marketing/vendor/stageshow/motion/Collapse";
import { Stream } from "@lictory/marketing/vendor/stageshow/motion/Stream";
import { SceneFrame } from "@lictory/marketing/components/landing/scenes/scene-frame";
import "./agents-scene.css";

/*
 * Agents: one platform, three ways in.
 *
 * Story (what the system does): Theo opens a pull request in the app. Maya
 * asks Litto to request a QA review. Ana's agent commits over MCP. Each call
 * is a workspace capability with the person's own permissions, and each
 * lands in the same history with who acted and from where. Plays once and
 * rests on the full history; Replay remounts it.
 *
 * Real strings: the three actions, their capability names (the real ones in
 * packages/core/src/capabilities) and the history. Identifiers are elided.
 */

type S = { beat: number; words: number; lines: number };

const REPLY = "Asked Jonas Weber from QA to review Retry policy.";
const REPLY_WORDS = REPLY.split(" ").length;
const TERMINAL_LINES = 7;

const initial: S = { beat: 0, words: 0, lines: 3 };
const DONE = 6;
const poster: S = { beat: DONE, words: REPLY_WORDS, lines: TERMINAL_LINES };

async function script(a: Act<S>) {
  const compact = a.layout === "compact";
  await a.wait(800);
  // 1. In the app: a person presses the button
  a.mark("app");
  if (!compact) {
    await a.move({ at: "open", x: 0.8, y: 0.6 });
    await a.wait(200);
    await a.click();
  }
  a.put({ beat: 1 });
  await a.wait(500);
  a.put({ beat: 2 });
  if (!compact) await a.move({ at: "rest", x: 0.5, y: 0.5 });
  await a.wait(700);
  // 2. Litto, asked by Maya, does the same kind of thing through the same door
  a.mark("litto");
  for (let i = 1; i <= REPLY_WORDS; i++) {
    a.put({ words: i });
    await a.wait(70);
  }
  await a.wait(250);
  a.put({ beat: 3 });
  await a.wait(1100);
  // 3. Ana's agent, over MCP
  a.mark("mcp");
  for (let i = 4; i <= TERMINAL_LINES; i++) {
    a.put({ lines: i });
    await a.wait(i === TERMINAL_LINES - 1 ? 520 : 260);
  }
  a.put({ beat: 4 });
  await a.wait(500);
  a.put({ beat: DONE });
  await a.wait(2400);
}

function AppWindow({ s }: { s: S }) {
  const opened = s.beat >= 1;
  return (
    <Window title="New pull request" className="ag-win ag-win--app">
      <div className="ag-app">
        <div className="ag-field">
          <span>Title</span>
          <span className="ag-value">Retry policy</span>
        </div>
        <div className="ag-field">
          <span>Merge</span>
          <span className="ag-value ag-mono">retry-policy → main</span>
        </div>
        <div className="ag-field">
          <span>Reviewers</span>
          <span className="ag-value">Product, Engineering</span>
        </div>
        <States
          align="start"
          className="ag-app-action"
          value={opened ? "opened" : "open"}
          states={{
            open: (
              <span className="ag-button" data-target="open">
                <GitPullRequest /> Open pull request
              </span>
            ),
            opened: (
              <span className="ag-button" data-done>
                <CheckIcon /> Opened
              </span>
            ),
          }}
        />
      </div>
    </Window>
  );
}

function LittoWindow({ s }: { s: S }) {
  return (
    <Window title="Litto" className="ag-win ag-win--litto">
      <div className="ag-chat">
        <p className="ag-ask">
          Ask QA to review the retry policy pull request.
        </p>
        <div className="ag-answer">
          <span className="ag-litto-mark">
            <IntelligenceMark />
          </span>
          <p>
            <Stream text={REPLY} count={s.words} />
          </p>
        </div>
        <Collapse open={s.beat >= 3} reveal="drop">
          <div className="ag-call">
            <CheckIcon /> requestPullRequestReview
          </div>
        </Collapse>
      </div>
    </Window>
  );
}

// The agent's session opens on an earlier read, so the terminal is never a
// blank window; the commit is the new call.
const LINES = [
  <span key="0" className="dim">
    Lictory · connected over MCP
  </span>,
  <span key="1" className="dim">
    → tools/call getWorkItem PAY-142
  </span>,
  <span key="2" className="dim">
    ← Retry failed payments, revision 12
  </span>,
  <span key="3">
    <span className="dim">→ tools/call</span> commitBranch
  </span>,
  <span key="4">
    {"   "}
    <span className="dim">branch </span> qa-boundaries
  </span>,
  <span key="5">
    {"   "}
    <span className="dim">message</span> {`"Add boundary cases"`}
  </span>,
  <span key="6" className="ok">
    ← committed
  </span>,
];

function TerminalWindow({ s }: { s: S }) {
  return (
    <Window
      chrome="terminal"
      title="ana — agent"
      className="ag-win ag-win--term"
    >
      <div className="ag-term">
        {LINES.map((line, i) => (
          <div
            key={i}
            className="ag-term-line"
            data-on={i < s.lines || undefined}
          >
            {line}
          </div>
        ))}
      </div>
    </Window>
  );
}

const HISTORY = [
  {
    beat: 2,
    mark: (
      <Avatar
        name="Theo Martin"
        size={24}
        style={{ background: "var(--lx-theo)" }}
      />
    ),
    who: "Theo Martin",
    what: "opened Retry policy",
    capability: "createPullRequest",
    from: "App",
  },
  {
    beat: 3,
    mark: (
      <span className="ag-mark ag-mark--litto">
        <IntelligenceMark />
      </span>
    ),
    who: "Litto for Maya Chen",
    what: "asked QA to review",
    capability: "requestPullRequestReview",
    from: "Litto",
  },
  {
    beat: 4,
    mark: (
      <span className="ag-mark ag-mark--ana">
        <SquareTerminal />
      </span>
    ),
    who: "Ana’s agent",
    // A non-breaking hyphen keeps the branch name on one line
    what: "committed to qa\u2011boundaries",
    capability: "commitBranch",
    from: "MCP",
  },
];

function History({ s }: { s: S }) {
  return (
    <div className="ag-history">
      <div className="ag-history-head">
        <span>History</span>
        <span className="ag-history-key">PAY-142</span>
      </div>
      <div className="ag-track" data-crop>
        {HISTORY.map((row) => (
          <Collapse
            key={row.capability}
            open={s.beat >= row.beat}
            reveal="drop"
          >
            <div className="ag-row">
              {row.mark}
              <span className="ag-row-text">
                <strong>{row.who}</strong> {row.what}
              </span>
              <span className="ag-capability">{row.capability}</span>
              <span className="ag-from">{row.from}</span>
            </div>
          </Collapse>
        ))}
        {/* Earlier entries: new ones push them down and out of the card */}
        {[180, 150, 200].map((w) => (
          <div key={w} className="ag-row ag-row--old">
            <Avatar plain size={24} />
            <Bar w={w} h={7} r={3.5} tone={3} />
            <span />
            <Bar w={34} h={16} r={8} tone={2} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Scene({ s, layout }: { s: S; layout: Layout }) {
  return (
    <>
      {layout === "wide" ? (
        <>
          <AppWindow s={s} />
          <LittoWindow s={s} />
        </>
      ) : null}
      <TerminalWindow s={s} />
      <History s={s} />
      <span className="ag-rest" data-target="rest" />
    </>
  );
}

export function AgentsScene() {
  return (
    <SceneFrame
      className="agents-scene"
      label="Theo opens a pull request in the app, Litto requests a QA review for Maya, and Ana’s agent commits over MCP. All three calls are workspace capabilities with their person’s permissions, and all three appear in the same history with who acted and from where."
    >
      {(run) => (
        <Stage<S>
          key={run}
          width={1184}
          height={520}
          compact={{ below: 860, width: 390, height: 572 }}
          initial={initial}
          poster={poster}
          script={script}
          play="once"
          theme="dark"
          cursor={{ at: { at: "rest", x: 0.5, y: 0.5 } }}
          className="lx ag"
        >
          {(s, _rect, layout) => <Scene s={s} layout={layout} />}
        </Stage>
      )}
    </SceneFrame>
  );
}
