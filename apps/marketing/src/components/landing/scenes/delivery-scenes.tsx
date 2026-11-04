"use client";

import type { ReactNode } from "react";
import { Check as CheckIcon, Send } from "lucide-react";

import { Stage } from "@lictory/marketing/vendor/stageshow/stage";
import type { Layout } from "@lictory/marketing/vendor/stageshow/looks";
import { Window } from "@lictory/marketing/vendor/stageshow/window";
import { Avatar } from "@lictory/marketing/vendor/stageshow/parts/Avatar";
import { Facepile } from "@lictory/marketing/vendor/stageshow/parts/Facepile";
import { useSiteTheme } from "@lictory/marketing/components/landing/scenes/scene-frame";
import "./delivery-scenes.css";

/*
 * Two stills for the two delivery modes, one per card. Each is the product
 * window pinned a gutter in from the top and sides of its card, running off
 * the bottom. Real strings: the delivery items that came from revision 13,
 * the columns or the published keys. Everything else is filler.
 */

function Story({ id, title }: { id: string; title: string }) {
  return (
    <div className="dl-card">
      <div className="dl-card-title">{title}</div>
      <div className="dl-card-meta">
        <span className="dl-id">{id}</span>
        <span className="dl-from">Revision 13</span>
      </div>
    </div>
  );
}

function Board({ layout }: { layout: Layout }) {
  const wide = layout === "wide";
  return (
    <Window
      title="Payments board"
      toolbar={
        <Facepile
          names={["Theo Martin", "Priya Shah", "Jonas Weber"]}
          size={20}
        />
      }
      className="dl-window"
    >
      <div className="dl-board" data-columns={wide ? 3 : 2}>
        <div className="dl-column">
          <div className="dl-column-head">
            Backlog <span>2</span>
          </div>
          <Story id="PAY-145" title="Add timeout scenarios to tests" />
          <Story id="PAY-146" title="Log every retry attempt" />
        </div>
        <div className="dl-column">
          <div className="dl-column-head">
            Started <span>2</span>
          </div>
          <Story id="PAY-143" title="Cap retries at three attempts" />
          <Story id="PAY-144" title="Reject retries after settlement" />
        </div>
        {wide ? (
          <div className="dl-column">
            <div className="dl-column-head">
              Done <span>3</span>
            </div>
            <div className="dl-card">
              <div className="dl-card-title">
                Show the retry count on receipts
              </div>
              <div className="dl-card-meta">
                <span className="dl-id">PAY-139</span>
                <Avatar plain size={16} />
              </div>
            </div>
            <div className="dl-card">
              <div className="dl-card-title">Document the retry limit</div>
              <div className="dl-card-meta">
                <span className="dl-id">PAY-137</span>
                <Avatar plain size={16} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Window>
  );
}

// A different project, which hands delivery to Jira: each piece of work is
// tracked in exactly one system
const PUBLISHED = [
  { type: "Story", title: "Export invoices as CSV", key: "BIL-41" },
  { type: "Story", title: "Filter exports by date range", key: "BIL-42" },
  { type: "Task", title: "Record each export in history", key: "BIL-43" },
] as const;

function Publish({ layout }: { layout: Layout }) {
  const wide = layout === "wide";
  return (
    <Window
      title="Publish to Jira"
      toolbar={<span className="dl-project">BIL</span>}
      className="dl-window"
    >
      <div className="dl-publish">
        <div className="dl-publish-head">
          <span>INV-88, revision 5</span>
          <span className="dl-publish-count">3 items published</span>
        </div>
        {PUBLISHED.map(({ type, title, key }) => (
          <div key={key} className="dl-publish-row">
            <span className="dl-done">
              <CheckIcon />
            </span>
            {wide ? <span className="dl-type">{type}</span> : null}
            <span className="dl-publish-title">{title}</span>
            <span className="dl-key">{key}</span>
          </div>
        ))}
        <div className="dl-publish-foot">
          <span className="dl-button">
            <Send /> Published
          </span>
        </div>
      </div>
    </Window>
  );
}

function DeliveryStill({
  label,
  children,
}: {
  label: string;
  children: (layout: Layout) => ReactNode;
}) {
  const theme = useSiteTheme();
  return (
    <div role="img" aria-label={label} className="delivery-still">
      <Stage
        width={560}
        height={250}
        compact={{ below: 520, width: 358, height: 230 }}
        theme={theme}
        className="lx dl"
      >
        {(_s, _rect, layout) => children(layout)}
      </Stage>
    </div>
  );
}

export function BoardStill() {
  return (
    <DeliveryStill label="A Lictory board for payments. Its stories and tasks show that they came from revision 13 of the specification.">
      {(layout) => <Board layout={layout} />}
    </DeliveryStill>
  );
}

export function PublishStill() {
  return (
    <DeliveryStill label="Three delivery items from revision 5 of an invoicing specification, published to Jira as BIL-41, BIL-42 and BIL-43.">
      {(layout) => <Publish layout={layout} />}
    </DeliveryStill>
  );
}
