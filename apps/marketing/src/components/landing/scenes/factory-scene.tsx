"use client";

import type { ReactNode } from "react";
import {
  Bot,
  Check as CheckIcon,
  CircleDot,
  FileText,
  GitMerge,
  GitPullRequest,
  Hash,
  MessageSquare,
  PackageCheck,
} from "lucide-react";

import { Stage } from "@lictory/marketing/vendor/stageshow/stage";
import type { Act } from "@lictory/marketing/vendor/stageshow/act";
import type { Layout } from "@lictory/marketing/vendor/stageshow/looks";
import { Window } from "@lictory/marketing/vendor/stageshow/window";
import { Avatar } from "@lictory/marketing/vendor/stageshow/parts/Avatar";
import { Check } from "@lictory/marketing/vendor/stageshow/parts/Check";
import { Facepile } from "@lictory/marketing/vendor/stageshow/parts/Facepile";
import { Badge } from "@lictory/marketing/vendor/stageshow/controls/Badge";
import { States } from "@lictory/marketing/vendor/stageshow/motion/States";
import { Collapse } from "@lictory/marketing/vendor/stageshow/motion/Collapse";
import {
  SceneFrame,
  useSiteTheme,
} from "@lictory/marketing/components/landing/scenes/scene-frame";
import "./factory-scene.css";

/*
 * The hero: the whole factory loop, told in one channel thread.
 *
 * Story (what the system does, with people deciding at each gate): Maya
 * mentions a customer request in #payments and promotes it to a proposal.
 * Product, engineering and QA approve revision 4 of its specification. Forge,
 * Priya's agent, claims the ready item on runner build-01 and opens a code
 * pull request; CI passes and the reviewer agent approves. Priya merges, and
 * the item is done with the revision it delivered. The rail beside the
 * thread is the item's loop: each stage, and who moved it past its gate.
 * Plays once and rests on the shipped result; Replay remounts it.
 *
 * Real strings: the channel, the people, the agent and its owner, the
 * item, the revision, the checks and the merge. Fictional data, never a
 * live workspace.
 */

type S = { beat: number };

const initial: S = { beat: 0 };
const SHIPPED = 7;
const poster: S = { beat: SHIPPED };

// beat 1: promoted · 2: revision approved · 3: claimed · 4: pull request
// opened · 5: checks passed · 6: merge pressed · 7: done
async function script(a: Act<S>) {
  const step = async (beat: number, ms: number) => {
    a.put({ beat });
    await a.wait(ms);
  };
  await a.wait(900);
  a.mark("promote");
  await step(1, 1300);
  a.mark("approve");
  await step(2, 1500);
  a.mark("claim");
  await step(3, 1300);
  a.mark("code");
  await step(4, 1000);
  await step(5, 900);
  // A person makes the decision: green checks merge nothing on their own
  a.mark("merge");
  if (a.layout === "wide") {
    await a.move({ at: "merge", x: 0.5, y: 0.55 });
    await a.wait(250);
    await a.click();
  }
  await step(6, 600);
  a.mark("shipped");
  await step(SHIPPED, 600);
  if (a.layout === "wide") await a.move({ at: "rest", x: 0.5, y: 0.5 });
  await a.wait(2400);
}

const STAGES: {
  name: string;
  icon: ReactNode;
  /** The beat that moves the item past this stage. */
  done: number;
  gate: string;
}[] = [
  {
    name: "Conversation",
    icon: <MessageSquare />,
    done: 1,
    gate: "Promoted by Maya Chen",
  },
  {
    name: "Specification",
    icon: <FileText />,
    done: 2,
    gate: "Revision 4 approved by 3 people",
  },
  {
    name: "Agents",
    icon: <Bot />,
    done: 4,
    gate: "Forge via Priya · build-01",
  },
  {
    name: "Code",
    icon: <GitPullRequest />,
    done: 6,
    gate: "Merged by Priya Shah",
  },
  {
    name: "Shipped",
    icon: <PackageCheck />,
    done: SHIPPED,
    gate: "Definition of Done passed",
  },
];

function Rail({ s }: { s: S }) {
  return (
    <aside className="fs-rail">
      <div className="fs-rail-head">
        <span className="fs-key">PAY-142</span>
        <span className="fs-rail-title">Refunds over the API</span>
      </div>
      <ol className="fs-stages">
        {STAGES.map(({ name, icon, done, gate }, index) => {
          const previous = index === 0 ? 0 : STAGES[index - 1]!.done;
          const state =
            s.beat >= done ? "done" : s.beat >= previous ? "current" : "next";
          return (
            <li key={name} className="fs-stage" data-state={state}>
              <span className="fs-stage-icon">
                {state === "done" ? <CheckIcon /> : icon}
              </span>
              <span className="fs-stage-text">
                <span className="fs-stage-name">{name}</span>
                <States
                  align="start"
                  className="fs-stage-gate"
                  value={state === "done" ? "done" : "open"}
                  states={{
                    open: state === "current" ? "In progress" : "",
                    done: gate,
                  }}
                />
              </span>
            </li>
          );
        })}
      </ol>
      <p className="fs-rail-note">
        Build policy: agents open pull requests, people merge them.
      </p>
    </aside>
  );
}

function Message({
  who,
  via,
  agent,
  time,
  children,
}: {
  who: string;
  via?: string;
  agent?: boolean;
  time: string;
  children: ReactNode;
}) {
  return (
    <div className="fs-message">
      {agent ? (
        <span className="fs-agent-avatar">
          <Bot />
        </span>
      ) : (
        <Avatar name={who} size={28} />
      )}
      <div className="fs-message-body">
        <div className="fs-message-head">
          <span className="fs-who">{who}</span>
          {via ? <span className="fs-via">via {via}</span> : null}
          {agent ? <span className="fs-agent-tag">Agent</span> : null}
          <span className="fs-time">{time}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Thread({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  const merged = s.beat >= 6;
  return (
    <div className="fs-thread">
      <Message who="Maya Chen" time="09:12">
        <p className="fs-text">
          {wide
            ? "Customers keep asking for refunds over the API, partial ones too."
            : "Customers keep asking for refunds over the API."}
        </p>
      </Message>

      <Collapse open={s.beat >= 1} reveal="drop">
        <div className="fs-card" data-kind="proposal">
          <CircleDot className="fs-card-icon" />
          <div className="fs-card-main">
            <span className="fs-card-title">
              <span className="fs-key">PAY-142</span> Refunds over the API
            </span>
            <span className="fs-card-meta">
              {wide
                ? "Proposal promoted from this thread by Maya Chen"
                : "Proposal promoted by Maya Chen"}
            </span>
          </div>
        </div>
      </Collapse>

      <Collapse open={s.beat >= 2} reveal="drop">
        <div className="fs-card" data-kind="spec">
          <FileText className="fs-card-icon" />
          <div className="fs-card-main">
            <span className="fs-card-title">
              Specification approved
              <span className="fs-revision">Revision 4</span>
            </span>
            {wide ? (
              <span className="fs-approvals">
                {["Product", "Engineering", "QA"].map((discipline) => (
                  <span key={discipline} className="fs-approval">
                    <CheckIcon /> {discipline}
                  </span>
                ))}
              </span>
            ) : (
              <span className="fs-card-meta">
                Product, engineering and QA approved
              </span>
            )}
          </div>
        </div>
      </Collapse>

      <Collapse open={s.beat >= 3} reveal="drop">
        <Message who="Forge" via="Priya Shah" agent time="09:41">
          <p className="fs-text">
            Claimed <span className="fs-key">PAY-148</span>{" "}
            {wide ? "Add the refund endpoint, " : ""}on runner{" "}
            <span className="fs-mono">build-01</span>.
          </p>
        </Message>
      </Collapse>

      <Collapse open={s.beat >= 4} reveal="drop">
        <div className="fs-card fs-pr" data-kind="pr">
          <GitPullRequest className="fs-card-icon" />
          <div className="fs-card-main">
            <span className="fs-card-title">
              <span className="fs-mono">#318</span> Add the refund endpoint
              <States
                align="end"
                className="fs-pr-state"
                value={merged ? "merged" : "open"}
                states={{
                  open: <Badge tone="success">Open</Badge>,
                  merged: <Badge className="fs-merged">Merged</Badge>,
                }}
              />
            </span>
            {wide ? (
              <span className="fs-checks">
                <span className="fs-check">
                  <Check on={s.beat >= 5} pending size={14} /> CI
                </span>
                <span className="fs-check">
                  <Check on={s.beat >= 5} pending size={14} /> Reviewer agent
                </span>
                <span className="fs-check">
                  <Check on={s.beat >= SHIPPED} pending={merged} size={14} />
                  Definition of Done
                </span>
              </span>
            ) : (
              <span className="fs-card-meta">
                <States
                  align="start"
                  value={s.beat >= 5 ? "passed" : "running"}
                  states={{
                    running: "Checks running",
                    passed: "CI passed · reviewer agent approved",
                  }}
                />
              </span>
            )}
            <div className="fs-pr-foot">
              <States
                align="start"
                value={merged ? "merged" : "merge"}
                states={{
                  merge: (
                    <span
                      className="fs-button"
                      data-target="merge"
                      data-ready={s.beat >= 5 || undefined}
                    >
                      <GitMerge /> Merge
                    </span>
                  ),
                  merged: (
                    <span className="fs-merged-by">
                      <Avatar name="Priya Shah" size={18} /> Merged by Priya
                      Shah
                    </span>
                  ),
                }}
              />
            </div>
          </div>
        </div>
      </Collapse>

      <Collapse open={s.beat >= SHIPPED} reveal="drop">
        <div className="fs-shipped">
          <PackageCheck />
          <span>
            <span className="fs-key">PAY-148</span> is done. Delivered revision
            4.
          </span>
        </div>
      </Collapse>
    </div>
  );
}

const SIDEBAR = (
  <div className="fs-side">
    <div className="fs-side-label">Channels</div>
    <span className="fs-side-item" data-active>
      <Hash /> payments
    </span>
    <span className="fs-side-item">
      <Hash /> pay-releases
    </span>
    <span className="fs-side-item">
      <Hash /> general
    </span>
    <div className="fs-side-label">Direct messages</div>
    <span className="fs-side-item">
      <Avatar name="Maya Chen" size={16} /> Maya Chen
    </span>
    <span className="fs-side-item">
      <Avatar name="Jonas Weber" size={16} /> Jonas Weber
    </span>
    <div className="fs-side-label">Agents</div>
    <span className="fs-side-item">
      <span className="fs-side-agent">
        <Bot />
      </span>
      Forge
      <span className="fs-side-owner">Priya</span>
    </span>
    <span className="fs-side-item">
      <span className="fs-side-agent">
        <Bot />
      </span>
      Atlas
      <span className="fs-side-owner">Theo</span>
    </span>
  </div>
);

function Scene({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  const toolbar = wide ? (
    <Facepile
      names={["Maya Chen", "Priya Shah", "Theo Martin", "Jonas Weber"]}
      size={22}
    />
  ) : undefined;
  if (!wide)
    return (
      <Window title="# payments" className="fs-window">
        <div className="fs-body">
          <Thread s={s} layout={layout} />
          <span className="fs-rest" data-target="rest" />
        </div>
      </Window>
    );
  return (
    <Window
      sidebar={SIDEBAR}
      sidebarWidth={200}
      title="# payments"
      toolbar={toolbar}
      className="fs-window"
    >
      <div className="fs-body">
        <Thread s={s} layout={layout} />
        <Rail s={s} />
        <span className="fs-rest" data-target="rest" />
      </div>
    </Window>
  );
}

export function FactoryScene() {
  const theme = useSiteTheme();
  return (
    <SceneFrame
      className="hero-scene"
      label="In the payments channel, Maya promotes a customer request to the proposal PAY-142. Product, engineering and QA approve revision 4 of its specification. Forge, Priya’s agent, claims the ready item PAY-148 on runner build-01 and opens pull request 318. CI passes and the reviewer agent approves, Priya merges it, and PAY-148 is done with revision 4 delivered."
    >
      {(run) => (
        <Stage<S>
          key={run}
          width={1184}
          height={560}
          compact={{ below: 860, width: 390, height: 500 }}
          initial={initial}
          poster={poster}
          script={script}
          play="once"
          theme={theme}
          cursor={{ at: { at: "rest", x: 0.5, y: 0.5 } }}
          className="lx fs"
        >
          {(st, _rect, layout) => <Scene s={st} layout={layout} />}
        </Stage>
      )}
    </SceneFrame>
  );
}
