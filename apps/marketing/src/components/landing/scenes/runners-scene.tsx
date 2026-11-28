"use client";

import type { ReactNode } from "react";
import {
  Bot,
  Check as CheckIcon,
  GitPullRequest,
  Hand,
  Laptop,
  Server,
} from "lucide-react";

import { Stage } from "@lictory/marketing/vendor/stageshow/stage";
import type { Act } from "@lictory/marketing/vendor/stageshow/act";
import type { Layout } from "@lictory/marketing/vendor/stageshow/looks";
import { Window } from "@lictory/marketing/vendor/stageshow/window";
import { Avatar } from "@lictory/marketing/vendor/stageshow/parts/Avatar";
import { Badge } from "@lictory/marketing/vendor/stageshow/controls/Badge";
import { States } from "@lictory/marketing/vendor/stageshow/motion/States";
import { Collapse } from "@lictory/marketing/vendor/stageshow/motion/Collapse";
import {
  SceneFrame,
  useSiteTheme,
} from "@lictory/marketing/components/landing/scenes/scene-frame";
import "./runners-scene.css";

/*
 * The Factory view: agent sessions on the team's own runners.
 *
 * Story (what the system does, then one human answer): a queued session is
 * assigned to runner build-01 and starts. Atlas, Theo's agent, needs a
 * permission it does not have and asks; the session waits, holding its
 * claim. Theo approves, the session resumes. Forge finishes and opens a
 * pull request. Plays once and rests on that result; Replay remounts it.
 *
 * Real strings: the runners and their platforms, the agents and their
 * owners, the harnesses, the items, the session statuses (the declared
 * state machine) and the approval request. Fictional data.
 */

type S = { beat: number };

const initial: S = { beat: 0 };
const DONE = 6;
const poster: S = { beat: DONE };

// 1: PAY-150 assigned · 2: PAY-150 running · 3: Atlas waits and asks ·
// 4: Theo approves · 5: Atlas running again · 6: Forge completed, PR opened
async function script(a: Act<S>) {
  const step = async (beat: number, ms: number) => {
    a.put({ beat });
    await a.wait(ms);
  };
  await a.wait(900);
  a.mark("assign");
  await step(1, 900);
  await step(2, 1000);
  a.mark("ask");
  await step(3, 1200);
  // The person answers: the agent cannot grant itself the permission
  if (a.layout === "wide") {
    await a.move({ at: "approve", x: 0.5, y: 0.55 });
    await a.wait(250);
    await a.click();
  } else await a.wait(700);
  a.mark("resume");
  await step(4, 700);
  await step(5, 900);
  a.mark("done");
  await step(DONE, 600);
  if (a.layout === "wide") await a.move({ at: "rest", x: 0.5, y: 0.5 });
  await a.wait(2400);
}

type Status = "queued" | "assigned" | "running" | "waiting" | "completed";

const STATUS: Record<
  Status,
  { text: string; tone: "neutral" | "success" | "warning" }
> = {
  queued: { text: "Queued", tone: "neutral" },
  assigned: { text: "Assigned", tone: "neutral" },
  running: { text: "Running", tone: "success" },
  waiting: { text: "Waiting", tone: "warning" },
  completed: { text: "Completed", tone: "neutral" },
};

type Session = {
  item: string;
  title: string;
  agent: string;
  owner: string;
  harness: string;
  runner: (beat: number) => string;
  status: (beat: number) => Status;
  detail: (beat: number) => string;
};

const SESSIONS: Session[] = [
  {
    item: "PAY-148",
    title: "Add the refund endpoint",
    agent: "Forge",
    owner: "Priya",
    harness: "Claude Code",
    runner: () => "build-01",
    status: (beat) => (beat >= DONE ? "completed" : "running"),
    detail: (beat) =>
      beat >= DONE ? "Opened pull request #318" : "Running the test suite",
  },
  {
    item: "PAY-149",
    title: "Send refund webhooks",
    agent: "Atlas",
    owner: "Theo",
    harness: "Codex",
    runner: () => "mac-mini",
    status: (beat) => (beat >= 3 && beat < 5 ? "waiting" : "running"),
    detail: (beat) =>
      beat >= 5
        ? "Applying the migration"
        : beat >= 3
          ? "Asked Theo for approval"
          : "Writing the migration",
  },
  {
    item: "PAY-150",
    title: "Show refunds on receipts",
    agent: "Forge",
    owner: "Priya",
    harness: "Claude Code",
    runner: (beat) => (beat >= 1 ? "build-01" : "No runner yet"),
    status: (beat) =>
      beat >= 2 ? "running" : beat >= 1 ? "assigned" : "queued",
    detail: (beat) =>
      beat >= 2
        ? "Created worktree pay-150"
        : beat >= 1
          ? "Lease taken by build-01"
          : "Ready, waiting for a slot",
  },
];

const RUNNERS = [
  {
    name: "build-01",
    platform: "Linux · x64",
    kind: "Organization",
    icon: <Server />,
    slots: (beat: number) =>
      beat >= DONE ? "1 of 4" : beat >= 1 ? "2 of 4" : "1 of 4",
  },
  {
    name: "mac-mini",
    platform: "macOS · arm64",
    kind: "Organization",
    icon: <Server />,
    slots: () => "1 of 2",
  },
  {
    name: "priya-laptop",
    platform: "macOS · arm64",
    kind: "Personal",
    icon: <Laptop />,
    slots: () => "Idle",
  },
] as const;

function StatusBadge({ status }: { status: Status }) {
  return (
    <States
      align="start"
      value={status}
      states={
        Object.fromEntries(
          (Object.keys(STATUS) as Status[]).map((key) => [
            key,
            <Badge key={key} tone={STATUS[key].tone} dot={key === "running"}>
              {STATUS[key].text}
            </Badge>,
          ]),
        ) as Record<Status, ReactNode>
      }
    />
  );
}

function Runners({ s }: { s: S }) {
  return (
    <aside className="rn-runners">
      <div className="rn-section">Runners</div>
      {RUNNERS.map((runner) => (
        <div key={runner.name} className="rn-runner">
          <span className="rn-runner-icon">{runner.icon}</span>
          <span className="rn-runner-main">
            <span className="rn-runner-name">{runner.name}</span>
            <span className="rn-runner-meta">
              {runner.platform} · {runner.kind}
            </span>
          </span>
          <span className="rn-slots">
            <States
              align="end"
              value={runner.slots(s.beat)}
              states={{
                "1 of 4": "1 of 4",
                "2 of 4": "2 of 4",
                "1 of 2": "1 of 2",
                Idle: "Idle",
              }}
            />
          </span>
        </div>
      ))}
      <p className="rn-runners-note">
        Outbound HTTPS only. Each session gets its own worktree and short-lived
        credentials.
      </p>
    </aside>
  );
}

function Sessions({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  return (
    <div className="rn-sessions">
      {wide ? (
        <div className="rn-head" aria-hidden>
          <span>Item</span>
          <span>Agent</span>
          <span>Harness</span>
          <span>Runner</span>
          <span>Status</span>
        </div>
      ) : null}
      {SESSIONS.map((session) => {
        const status = session.status(s.beat);
        return (
          <div key={session.item} className="rn-row" data-status={status}>
            <span className="rn-item">
              <span className="rn-key">{session.item}</span>
              <span className="rn-title">{session.title}</span>
              <States
                align="start"
                className="rn-detail"
                value={session.detail(s.beat)}
                states={Object.fromEntries(
                  [0, 1, 2, 3, 4, 5, 6].map((beat) => [
                    session.detail(beat),
                    session.detail(beat),
                  ]),
                )}
              />
            </span>
            <span className="rn-agent">
              <span className="rn-agent-mark">
                <Bot />
              </span>
              <span>
                {session.agent}
                <span className="rn-via"> via {session.owner}</span>
              </span>
            </span>
            {wide ? (
              <>
                <span className="rn-cell">{session.harness}</span>
                <span className="rn-cell rn-mono">
                  <States
                    align="start"
                    value={session.runner(s.beat)}
                    states={{
                      "No runner yet": "—",
                      "build-01": "build-01",
                      "mac-mini": "mac-mini",
                    }}
                  />
                </span>
              </>
            ) : null}
            <span className="rn-status">
              <StatusBadge status={status} />
            </span>
          </div>
        );
      })}

      <Collapse open={s.beat >= 3} reveal="drop">
        <div className="rn-ask">
          <Hand className="rn-ask-icon" />
          <div className="rn-ask-main">
            <span className="rn-ask-title">
              Atlas asks Theo Martin for approval
            </span>
            <span className="rn-ask-body">
              {wide
                ? "Run the database migration for PAY-149 in its worktree."
                : "Run the PAY-149 migration in its worktree."}
            </span>
          </div>
          <States
            align="end"
            className="rn-ask-actions"
            value={s.beat >= 4 ? "approved" : "ask"}
            states={{
              ask: (
                <span className="rn-ask-buttons">
                  {wide ? <span className="rn-ghost">Deny</span> : null}
                  <span className="rn-button" data-target="approve">
                    Approve
                  </span>
                </span>
              ),
              approved: (
                <span className="rn-approved">
                  <Avatar name="Theo Martin" size={18} />
                  <CheckIcon /> Approved
                </span>
              ),
            }}
          />
        </div>
      </Collapse>

      <Collapse open={s.beat >= DONE} reveal="drop">
        <div className="rn-pr">
          <GitPullRequest />
          <span>
            <span className="rn-mono">#318</span> Add the refund endpoint ·
            opened by Forge via Priya · waiting for review
          </span>
        </div>
      </Collapse>
    </div>
  );
}

function Scene({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  const lead = (
    <div className="rn-lead">
      <span className="rn-lead-title">Factory</span>
      {wide ? (
        <span className="rn-tabs">
          <span data-active>Sessions</span>
          <span>Runners</span>
          <span>Agents</span>
        </span>
      ) : null}
    </div>
  );
  return (
    <Window lead={lead} className="rn-window">
      <div className="rn-body">
        <Sessions s={s} layout={layout} />
        {wide ? <Runners s={s} /> : null}
        <span className="rn-rest" data-target="rest" />
      </div>
    </Window>
  );
}

export function RunnersScene() {
  const theme = useSiteTheme();
  return (
    <SceneFrame
      className="runners-scene"
      label="The Factory view lists agent sessions on the team’s own runners. A queued session is assigned to runner build-01 and starts. Atlas, Theo’s agent, waits for approval to run a database migration; Theo approves and it resumes. Forge, Priya’s agent, completes and opens pull request 318 for review."
    >
      {(run) => (
        <Stage<S>
          key={run}
          width={1184}
          height={500}
          compact={{ below: 860, width: 390, height: 500 }}
          initial={initial}
          poster={poster}
          script={script}
          play="once"
          theme={theme}
          cursor={{ at: { at: "rest", x: 0.5, y: 0.5 } }}
          className="lx rn"
        >
          {(st, _rect, layout) => <Scene s={st} layout={layout} />}
        </Stage>
      )}
    </SceneFrame>
  );
}
