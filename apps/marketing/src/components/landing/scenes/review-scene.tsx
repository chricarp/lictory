"use client";

import { Stage } from "@lictory/marketing/vendor/stageshow/stage";
import type { Act } from "@lictory/marketing/vendor/stageshow/act";
import type { Layout } from "@lictory/marketing/vendor/stageshow/looks";
import { Bar, Window } from "@lictory/marketing/vendor/stageshow/window";
import { Check } from "@lictory/marketing/vendor/stageshow/parts/Check";
import { Avatar } from "@lictory/marketing/vendor/stageshow/parts/Avatar";
import { Badge } from "@lictory/marketing/vendor/stageshow/controls/Badge";
import { States } from "@lictory/marketing/vendor/stageshow/motion/States";
import { Collapse } from "@lictory/marketing/vendor/stageshow/motion/Collapse";
import { Stream } from "@lictory/marketing/vendor/stageshow/motion/Stream";
import {
  SceneFrame,
  useSiteTheme,
} from "@lictory/marketing/components/landing/scenes/scene-frame";
import "./review-scene.css";

/*
 * Review: approvals belong to revisions.
 *
 * Story: QA has a blocking question on one sentence of revision 12. Theo
 * answers it, and the answer goes into the specification as revision 13.
 * The product and engineering approvals were for revision 12, so they go
 * stale instead of carrying over. A person resolves the discussion, the
 * reviewers approve revision 13, and the specification is ready. Plays once
 * and rests on Ready; Replay remounts it.
 *
 * Real strings: the sentence under review, the question, the answer, the
 * revision, the reviews and readiness. The rest of the document is filler.
 */

type S = { beat: number; words: number };

const ADDED =
  "Each retry reuses the original transaction ID, so a late response can’t charge twice.";
const ADDED_WORDS = ADDED.split(" ").length;

const initial: S = { beat: 0, words: 0 };
const READY = 8;
const poster: S = { beat: READY, words: ADDED_WORDS };

async function script(a: Act<S>) {
  await a.wait(900);
  a.mark("reply");
  a.put({ beat: 1 });
  await a.wait(1300);
  // The answer goes into the specification: a new revision
  a.mark("revise");
  a.put({ beat: 2 });
  for (let i = 1; i <= ADDED_WORDS; i++) {
    a.put({ words: i });
    await a.wait(55);
  }
  await a.wait(350);
  a.put({ beat: 3 });
  await a.wait(1400);
  // Resolving is a person's decision
  a.mark("resolve");
  await a.move({ at: "resolve", x: 0.78, y: 0.6 });
  await a.wait(200);
  await a.click();
  a.put({ beat: 4 });
  await a.wait(400);
  await a.move({ at: "rest", x: 0.5, y: 0.5 });
  a.mark("approve");
  for (const beat of [5, 6, 7]) {
    a.put({ beat });
    await a.wait(520);
  }
  a.put({ beat: READY });
  await a.wait(2400);
}

const REVIEWS = [
  { discipline: "Product", approvedAgain: 6 },
  { discipline: "Engineering", approvedAgain: 5 },
  { discipline: "QA", approvedAgain: 7 },
] as const;

function Reviews({ s }: { s: S }) {
  return (
    <>
      {REVIEWS.map(({ discipline, approvedAgain }) => {
        // QA asked the question, so QA had not approved revision 12
        const before = discipline === "QA" ? "requested" : "r12";
        const value =
          s.beat >= approvedAgain
            ? "r13"
            : s.beat >= 3 && before === "r12"
              ? "stale"
              : before;
        return (
          <div key={discipline} className="rs-review">
            <Check on={value === "r12" || value === "r13"} />
            <span className="rs-review-name">{discipline}</span>
            <States
              align="end"
              className="rs-review-state"
              value={value}
              states={{
                requested: <span>Requested</span>,
                r12: <span>Revision 12</span>,
                stale: <span data-stale>Needs review</span>,
                r13: <span>Revision 13</span>,
              }}
            />
          </div>
        );
      })}
    </>
  );
}

function Thread({ s }: { s: S }) {
  const resolved = s.beat >= 4;
  return (
    <div className="rs-thread" data-resolved={resolved || undefined}>
      <div className="rs-msg">
        <Avatar name="Jonas Weber" size={22} />
        <div>
          <div className="rs-who">
            Jonas Weber <span>QA</span>
          </div>
          <p>What if the provider answers after we have already retried?</p>
        </div>
        <States
          align="end"
          value={resolved ? "resolved" : "blocking"}
          states={{
            blocking: <Badge tone="warning">Blocking</Badge>,
            resolved: <Badge tone="success">Resolved</Badge>,
          }}
        />
      </div>
      <Collapse open={s.beat >= 1} reveal="drop">
        <div className="rs-msg">
          <Avatar name="Theo Martin" size={22} />
          <div>
            <div className="rs-who">
              Theo Martin <span>Engineering</span>
            </div>
            <p>Retries reuse the transaction ID.</p>
          </div>
        </div>
      </Collapse>
      <Collapse open={!resolved}>
        <div className="rs-thread-foot">
          <span className="rs-resolve" data-target="resolve">
            Resolve
          </span>
        </div>
      </Collapse>
    </div>
  );
}

function Scene({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  const revised = s.beat >= 2;
  const lead = (
    <div className="rs-lead">
      <span className="rs-key">PAY-142</span>
      <span className="rs-item">Retry failed payments</span>
    </div>
  );
  const toolbar = (
    <States
      align="end"
      value={revised ? "r13" : "r12"}
      states={{
        r12: <span className="rs-revision">Revision 12</span>,
        r13: (
          <span className="rs-revision" data-new>
            Revision 13
          </span>
        ),
      }}
    />
  );
  return (
    <Window lead={lead} toolbar={toolbar} className="rs-window">
      <div className="rs-body">
        <div className="rs-doc">
          {wide ? (
            <>
              <div className="rs-heading">Failure behavior</div>
              <div className="rs-lines">
                <Bar w="92%" h={7} r={3.5} tone={2} />
                <Bar w="64%" h={7} r={3.5} tone={2} />
              </div>
            </>
          ) : null}
          <p className="rs-sentence">
            <mark data-resolved={s.beat >= 4 || undefined}>
              When a payment fails, retry it up to three times.
            </mark>{" "}
            <Stream
              className="rs-added"
              data-on={revised || undefined}
              text={ADDED}
              count={s.words}
            />
          </p>
          <Thread s={s} />
          {wide ? null : (
            // The phone keeps the three approvals as one row
            <div className="rs-compact-reviews rs-review">
              <Check on={s.beat >= 7} />
              <span className="rs-review-name">Approvals</span>
              <States
                align="end"
                className="rs-review-state"
                value={
                  s.beat >= 7 ? "current" : s.beat >= 3 ? "stale" : "before"
                }
                states={{
                  before: <span>2 of 3 on revision 12</span>,
                  stale: <span data-stale>Need review</span>,
                  current: <span>3 of 3 on revision 13</span>,
                }}
              />
            </div>
          )}
          <div className="rs-lines rs-tail">
            <Bar w="88%" h={7} r={3.5} tone={2} />
            <Bar w="72%" h={7} r={3.5} tone={2} />
            <Bar w="80%" h={7} r={3.5} tone={2} />
          </div>
          <span className="rs-rest" data-target="rest" />
        </div>
        {wide ? (
          <aside className="rs-side">
            <div className="rs-section">Reviews</div>
            <Reviews s={s} />
            <div className="rs-section">Readiness</div>
            <div className="rs-ready-row">
              <span>Blocking discussions</span>
              <States
                align="end"
                value={s.beat >= 4 ? "none" : "one"}
                states={{ one: <span>1</span>, none: <span>None</span> }}
              />
            </div>
            <div className="rs-ready-row">
              <span>Approvals</span>
              <States
                align="end"
                value={
                  s.beat >= 7
                    ? "current"
                    : s.beat >= 3 && s.beat < 6
                      ? "stale"
                      : "missing"
                }
                states={{
                  missing: <span>QA missing</span>,
                  stale: <span>Stale</span>,
                  current: <span>All current</span>,
                }}
              />
            </div>
            <div className="rs-section">Decisions</div>
            <Collapse open={s.beat >= 4} reveal="drop">
              <div className="rs-decision">
                Retries reuse the original transaction ID.
              </div>
            </Collapse>
            <States
              align="start"
              className="rs-verdict"
              value={s.beat >= READY ? "ready" : "not"}
              states={{
                not: <Badge tone="neutral">Not ready</Badge>,
                ready: <Badge tone="success">Ready</Badge>,
              }}
            />
          </aside>
        ) : null}
      </div>
    </Window>
  );
}

export function ReviewScene() {
  const theme = useSiteTheme();
  return (
    <SceneFrame
      className="review-scene"
      label="QA asks a blocking question about one sentence of revision 12. Engineering answers it and the specification becomes revision 13, so the earlier product and engineering approvals need review again. The discussion is resolved, all three disciplines approve revision 13, and the specification is ready."
    >
      {(run) => (
        <Stage<S>
          key={run}
          width={680}
          height={500}
          compact={{ below: 600, width: 390, height: 370 }}
          initial={initial}
          poster={poster}
          script={script}
          play="once"
          theme={theme}
          cursor={{ at: { at: "rest", x: 0.5, y: 0.5 } }}
          className="lx rs"
        >
          {(s, _rect, layout) => <Scene s={s} layout={layout} />}
        </Stage>
      )}
    </SceneFrame>
  );
}
