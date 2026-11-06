"use client";

import { ChevronRight, GitMerge } from "lucide-react";

import { Stage } from "@lictory/marketing/vendor/stageshow/stage";
import type { Act } from "@lictory/marketing/vendor/stageshow/act";
import type { Layout } from "@lictory/marketing/vendor/stageshow/looks";
import { Window } from "@lictory/marketing/vendor/stageshow/window";
import { Check } from "@lictory/marketing/vendor/stageshow/parts/Check";
import { Avatar } from "@lictory/marketing/vendor/stageshow/parts/Avatar";
import { Badge } from "@lictory/marketing/vendor/stageshow/controls/Badge";
import { States } from "@lictory/marketing/vendor/stageshow/motion/States";
import {
  SceneFrame,
  useSiteTheme,
} from "@lictory/marketing/components/landing/scenes/scene-frame";
import "./spaces-review-scene.css";

/*
 * Spaces: a page change, reviewed.
 *
 * Story (one human decision): the Payments space is Reviewed, so Maria's
 * change to "Capture retries" waits in a pull request. The diff shows the
 * one word that changed, three to five. Dev Patel approves this exact
 * result, the merge checks pass, and Maria presses Merge: the page's
 * published version becomes v4, approved by Dev Patel. Plays once and rests
 * on the merged result; Replay remounts it.
 *
 * Real strings: the change, the reviewer, the application's own labels
 * ("Approval is required for this exact result.", "Contributors cannot
 * approve their own changes.", "Requires approval from", "All merge checks
 * pass.", "Merge pull request", "Merged by"). Maria wrote the change, so
 * the contributors note is the one she sees.
 */

type S = { beat: number };

const APPROVED = 1;
const CHECKED = 2;
const MERGED = 3;
const initial: S = { beat: 0 };
const poster: S = { beat: MERGED };

/** The reviewer approves, the checks pass, then Maria merges. */
async function script(a: Act<S>) {
  await a.wait(1100);
  a.mark("approve");
  a.put({ beat: APPROVED });
  await a.wait(650);
  a.put({ beat: CHECKED });
  await a.wait(900);
  // Approving doesn't merge anything: a person does
  a.mark("merge");
  await a.move({ at: "merge", x: 0.78, y: 0.6 });
  await a.wait(220);
  await a.click();
  a.put({ beat: MERGED });
  await a.wait(500);
  await a.move({ at: "rest", x: 0.5, y: 0.5 });
  await a.wait(2400);
}

/** The edited block, before and after, with the changed word marked. */
function Diff({ layout }: { layout: Layout }) {
  const wide = layout === "wide";
  const tail = wide ? " times with exponential backoff." : " times.";
  return (
    <div className="sr-diff">
      {wide ? <div className="sr-diff-head">Edited</div> : null}
      <div className="sr-row" data-kind="del">
        <span className="sr-sign">−</span>
        <div>
          <div className="sr-label">Before · main</div>
          <p>
            Failed captures are retried <del>three</del>
            {tail}
          </p>
        </div>
      </div>
      <div className="sr-row" data-kind="add">
        <span className="sr-sign">+</span>
        <div>
          <div className="sr-label">After · five-retries</div>
          <p>
            Failed captures are retried <ins>five</ins>
            {tail}
          </p>
        </div>
      </div>
    </div>
  );
}

/** The required reviewer and their decision on this exact result. */
function Review({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  const approved = s.beat >= APPROVED;
  return (
    <div className="sr-reviewer">
      <Avatar name="Dev Patel" size={wide ? 22 : 20} className="sr-dev" />
      <div className="sr-reviewer-who">
        <span className="sr-reviewer-name">Dev Patel</span>
        <span className="sr-required">Required</span>
      </div>
      <States
        align="end"
        value={approved ? "approved" : "pending"}
        states={{
          pending: <Badge tone="neutral">Pending</Badge>,
          approved: <Badge tone="success">Approved</Badge>,
        }}
      />
    </div>
  );
}

/** Merge pull request: disabled until the checks pass, then Merged. */
function MergeButton({ s }: { s: S }) {
  const ready = s.beat >= CHECKED;
  const merged = s.beat >= MERGED;
  return (
    <span
      className="sr-button"
      data-target="merge"
      data-ready={ready || undefined}
      data-done={merged || undefined}
    >
      <GitMerge />
      <States
        align="start"
        value={merged ? "merged" : "merge"}
        states={{
          merge: <span>Merge pull request</span>,
          merged: <span>Merged</span>,
        }}
      />
    </span>
  );
}

/** Reviewers, merge checks and the merge, as the pull request page shows them. */
function Side({ s }: { s: S }) {
  const merged = s.beat >= MERGED;
  return (
    <aside className="sr-side">
      <div className="sr-section">Reviewers</div>
      <Review s={s} layout="wide" />
      <p className="sr-note">Approval is required for this exact result.</p>
      <p className="sr-note">Contributors cannot approve their own changes.</p>
      <div className="sr-section">Merge checks</div>
      <div className="sr-check">
        <Check on={s.beat >= CHECKED} />
        <States
          align="start"
          value={s.beat >= CHECKED ? "pass" : "blocked"}
          states={{
            blocked: <span>Requires approval from Dev Patel</span>,
            pass: <span>All merge checks pass.</span>,
          }}
        />
      </div>
      <div className="sr-merge">
        <MergeButton s={s} />
        <States
          align="start"
          className="sr-merge-note"
          value={merged ? "merged" : "waiting"}
          states={{
            waiting: <span />,
            merged: (
              <span>
                Merged by Maria Chen. Published as{" "}
                <span className="sr-version">v4</span>, approved by Dev Patel.
              </span>
            ),
          }}
        />
      </div>
    </aside>
  );
}

/** The pull request window: change and review side by side wide, stacked on a phone. */
function Scene({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  const merged = s.beat >= MERGED;
  const lead = (
    <div className="sr-crumbs">
      {wide ? (
        <>
          <span>Payments</span>
          <ChevronRight />
        </>
      ) : null}
      <span>Capture retries</span>
    </div>
  );
  const toolbar = wide ? (
    <span className="sr-policy">Reviewed publishing</span>
  ) : undefined;
  return (
    <Window lead={lead} toolbar={toolbar} className="sr-window">
      <div className="sr-body">
        <div className="sr-main">
          <div className="sr-title-row">
            <span className="sr-title">Retry captures five times</span>
            <States
              align="end"
              value={merged ? "merged" : "open"}
              states={{
                open: <Badge tone="success">Open</Badge>,
                merged: <Badge className="sr-merged-badge">Merged</Badge>,
              }}
            />
          </div>
          <div className="sr-refs">
            <span>five-retries</span> → <span>main</span>
            {wide ? " · Maria Chen" : null}
          </div>
          {wide ? (
            <div className="sr-changes">
              Resulting changes <span>1 block changed</span>
            </div>
          ) : null}
          <Diff layout={layout} />
          {wide ? null : (
            // The phone keeps the review and the merge under the diff
            <div className="sr-compact">
              <Review s={s} layout={layout} />
              <MergeButton s={s} />
            </div>
          )}
          <span className="sr-rest" data-target="rest" />
        </div>
        {wide ? <Side s={s} /> : null}
      </div>
    </Window>
  );
}

/** The landing illustration of a page change reviewed and merged in a Reviewed space. */
export function SpacesReviewScene() {
  const theme = useSiteTheme();
  return (
    <SceneFrame
      className="spaces-review-scene"
      label="A pull request on the Capture retries page in a Reviewed space. The diff shows one word changed from three to five. Dev Patel, the required reviewer, approves this exact result, the merge checks pass, and Maria Chen merges it: the page is published as version 4, approved by Dev Patel."
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
          className="lx sr"
        >
          {(s, _rect, layout) => <Scene s={s} layout={layout} />}
        </Stage>
      )}
    </SceneFrame>
  );
}
