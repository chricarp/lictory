"use client";

import { Check, ChevronDown, ChevronRight, FileText, Send } from "lucide-react";

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
import "./spaces-editor-scene.css";

/*
 * Spaces: a page written together, live.
 *
 * Story (how it feels to use): Maria has the live draft of "Payments
 * service" open in the Engineering Handbook. Dev Patel is in the same draft
 * and adds a sentence; his caret carries his name. Maria adds a list item
 * at the same time. The editor says "Saving…" while their edits travel and
 * "Saved" once the server has stored them, and "Unpublished changes" until
 * someone publishes. Maria presses Publish: the draft becomes v4. A blocking
 * comment stays anchored to the sentence it quotes throughout. Plays once and
 * rests on the published result; Replay remounts it.
 *
 * Real strings: the page tree, the page's text, the save states, the
 * presence line, the comment. These are the application's own labels
 * (apps/platform/src/components/spaces). Nothing here is a live workspace.
 */

type S = {
  dev: number;
  maria: string;
  item: boolean;
  caret: boolean;
  saving: boolean;
  unpublished: boolean;
  published: boolean;
};

const DEV = "It never stores card numbers.";
const DEV_WORDS = DEV.split(" ");
const MARIA = "Publish PaymentCaptured and PaymentRefunded events.";

const initial: S = {
  dev: 0,
  maria: "",
  item: false,
  caret: false,
  saving: false,
  unpublished: false,
  published: false,
};
const poster: S = {
  dev: DEV_WORDS.length,
  maria: MARIA,
  item: true,
  caret: false,
  saving: false,
  unpublished: false,
  published: true,
};

async function script(a: Act<S>) {
  const wide = a.layout === "wide";
  await a.wait(900);
  a.mark("together");
  // Dev types in his paragraph while Maria starts a list item in hers: two
  // people in one draft, neither waiting for the other
  const dev = async () => {
    for (let i = 1; i <= DEV_WORDS.length; i++) {
      a.put({ dev: i, saving: true, unpublished: true });
      await a.wait(i === 1 ? 260 : 190);
    }
  };
  const maria = async () => {
    await a.wait(500);
    await a.move({ at: "item", x: 0.8, y: 0.6 });
    await a.wait(150);
    await a.click();
    // Return at the end of the item opens the next one
    a.put({ item: true, caret: true });
    await a.wait(450);
    a.put({ saving: true });
    await a.type("maria", MARIA, { interval: wide ? 38 : 34 });
  };
  await Promise.all([dev(), maria()]);
  // Stored on the server: only now does it say Saved
  await a.wait(550);
  a.put({ saving: false });
  await a.wait(900);
  a.mark("publish");
  await a.move({ at: "publish", x: 0.7, y: 0.6 });
  await a.wait(200);
  await a.click();
  a.put({ caret: false, published: true, unpublished: false });
  await a.wait(500);
  await a.move({ at: "rest", x: 0.5, y: 0.5 });
  await a.wait(2400);
}

const TREE = [
  { name: "Onboarding", depth: 0, open: true },
  { name: "Local setup", depth: 1 },
  { name: "Code review", depth: 1 },
  { name: "Architecture", depth: 0, open: true },
  { name: "Payments service", depth: 1, active: true },
  { name: "Event catalog", depth: 1 },
  { name: "Runbooks", depth: 0, open: false },
] as const;

function Tree() {
  return (
    <nav className="se-tree" aria-hidden>
      <div className="se-space">Engineering Handbook</div>
      <div className="se-space-meta">
        <Send /> Direct publishing
      </div>
      <div className="se-section">Pages</div>
      <ul>
        {TREE.map((page) => (
          <li
            key={page.name}
            data-depth={page.depth}
            data-active={("active" in page && page.active) || undefined}
          >
            <span className="se-chevron">
              {"open" in page ? (
                page.open ? (
                  <ChevronDown />
                ) : (
                  <ChevronRight />
                )
              ) : null}
            </span>
            <FileText />
            <span className="se-tree-name">{page.name}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Status({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  return (
    <div className="se-status">
      {/* The phone keeps the version, the save state and what's unpublished */}
      {wide ? (
        <>
          <span className="se-live">
            <span className="se-live-dot" />
            Live draft
          </span>
          <span className="se-sep">·</span>
        </>
      ) : null}
      <span className="se-based">
        based on{" "}
        <States
          align="start"
          value={s.published ? "v4" : "v3"}
          states={{
            v3: <span className="se-version">v3</span>,
            v4: (
              <span className="se-version" data-new>
                v4
              </span>
            ),
          }}
        />
      </span>
      <span className="se-sep">·</span>
      <States
        align="start"
        className="se-save"
        value={s.saving ? "saving" : "saved"}
        states={{
          saving: <span>Saving…</span>,
          saved: (
            <span className="se-saved">
              <Check /> Saved
            </span>
          ),
        }}
      />
      <span className="se-unpublished" data-on={s.unpublished || undefined}>
        <span className="se-sep">·</span>
        Unpublished changes
      </span>
      {wide ? (
        <span className="se-presence">
          <Avatar name="Dev Patel" size={18} className="se-dev-avatar" />
          Dev Patel is editing
        </span>
      ) : null}
    </div>
  );
}

function Doc({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  const devText = DEV_WORDS.slice(0, s.dev).join(" ");
  return (
    <div className="se-doc" data-cursor="ibeam">
      <div className="se-title">Payments service</div>
      <Status s={s} layout={layout} />
      <p className="se-p">
        {wide
          ? "The payments service authorizes, captures and refunds card payments for every checkout."
          : "The payments service captures and refunds card payments."}{" "}
        <span className="se-typed">{devText}</span>
        <span className="se-peer" aria-hidden>
          <span className="se-flag">Dev Patel</span>
        </span>
      </p>
      <div className="se-h">Responsibilities</div>
      <ul className="se-list">
        <li>Authorize and capture card payments within 2 seconds.</li>
        <li>
          Retry declined captures with the original idempotency key.
          {/* Where Maria clicks: just past the item's last word */}
          <span className="se-anchor" data-target="item" />
        </li>
      </ul>
      <Collapse open={s.item}>
        <ul className="se-list se-list-new">
          <li>
            {s.maria}
            <span className="se-caret" data-on={s.caret || undefined} />
          </li>
        </ul>
      </Collapse>
      <div className="se-h">Retry policy</div>
      <p className="se-p">
        <mark>
          Failed captures are retried three times with exponential backoff.
        </mark>{" "}
        {wide ? (
          <>
            The decision is tracked in{" "}
            <span className="se-chip">
              <span className="se-chip-status" />
              <span className="se-chip-key">PAY-1</span>
              Retry failed card captures
            </span>
            .
          </>
        ) : null}
      </p>
      <span className="se-rest" data-target="rest" />
    </div>
  );
}

function Comments() {
  return (
    <aside className="se-comments" aria-hidden>
      <div className="se-comments-head">
        <span className="se-comments-title">Comments</span>
        <span className="se-comments-count">1 open</span>
        <span className="se-comments-blocking">1 blocking</span>
      </div>
      <div className="se-thread">
        <Badge tone="danger">Blocking</Badge>
        <div className="se-quote">
          Failed captures are retried three times with exponential backoff.
        </div>
        <div className="se-msg">
          <Avatar name="Jonas Weber" size={20} />
          <div>
            <div className="se-who">Jonas Weber</div>
            <p>
              Should the third retry page the on-call engineer, or only mark the
              payment failed?
            </p>
          </div>
        </div>
        <div className="se-thread-foot">
          <span>Reply</span>
          <span>Resolve</span>
        </div>
      </div>
    </aside>
  );
}

function Scene({ s, layout }: { s: S; layout: Layout }) {
  const wide = layout === "wide";
  const lead = (
    <div className="se-crumbs">
      {wide ? (
        <>
          <span>Spaces</span>
          <ChevronRight />
          <span>Engineering Handbook</span>
          <ChevronRight />
        </>
      ) : null}
      <span>Architecture</span>
    </div>
  );
  const toolbar = (
    <div className="se-actions">
      {wide ? <span className="se-close">Close editor</span> : null}
      <span className="se-publish" data-target="publish">
        <Send /> Publish
      </span>
    </div>
  );
  return (
    <Window lead={lead} toolbar={toolbar} className="se-window">
      <div className="se-body">
        {wide ? <Tree /> : null}
        <Doc s={s} layout={layout} />
        {wide ? <Comments /> : null}
      </div>
    </Window>
  );
}

export function SpacesEditorScene() {
  const theme = useSiteTheme();
  return (
    <SceneFrame
      className="spaces-editor-scene"
      label="The live draft of the Payments service page in the Engineering Handbook space. Dev Patel adds a sentence while Maria adds a list item at the same time; the editor says Saving and then Saved once the server has stored their edits, and Unpublished changes until Maria publishes the draft as version 4. A blocking comment stays attached to the sentence about capture retries."
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
          className="lx se"
        >
          {(s, _rect, layout) => <Scene s={s} layout={layout} />}
        </Stage>
      )}
    </SceneFrame>
  );
}
