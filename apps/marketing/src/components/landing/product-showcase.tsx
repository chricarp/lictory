"use client";

import type { ReactNode } from "react";
import {
  ArrowUp,
  Bell,
  Bookmark,
  BookOpenCheck,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Circle,
  CircleDashed,
  GitBranch,
  GitPullRequest,
  Inbox,
  KanbanSquare,
  ListOrdered,
  Menu,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Square,
  UserRound,
  Zap,
} from "lucide-react";
import { Avatar, Kbd } from "@lictory/ui/primitives";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import "./product-showcase.css";

/** Read-only illustration of ItemDetail and the workspace shell. Layout,
 * theme tokens, avatars and iconography follow the actual platform; no live
 * workspace state, interactive-looking OS frame or invented review panel.
 */
export function ProductShowcase() {
  return (
    <div
      className="product-showcase"
      role="img"
      aria-label="People and agents refining a payment specification through branches and review"
    >
      <div className="app-preview dark" data-theme="lictory">
        <div className="preview-shell">
          <Sidebar />
          <div className="preview-item">
            <div className="preview-mobile-header">
              <Menu />
              <span>Payments</span>
              <Search />
              <Plus />
            </div>
            <div className="preview-item-header">
              <PanelLeft />
              <span>Work items</span>
              <ChevronRight />
              <StoryIcon />
              <code>PAY-142</code>
              <span className="preview-watch">
                <Bell /> Watching
              </span>
              <MoreHorizontal />
            </div>
            <div className="preview-item-layout">
              <div className="preview-document">
                <div className="preview-item-title">Retry failed payments</div>
                <div className="preview-mobile-properties">
                  <CircleDashed /> Backlog <span>·</span>
                  <Circle /> In review <Avatar name="Theo Martin" size="xs" />
                </div>
                <div className="preview-spec-header">
                  <span className="preview-section-label">Specification</span>
                  <span>Revision 13 · Theo Martin</span>
                  <span className="preview-edit">Edit</span>
                </div>
                <div className="preview-prose">
                  <div className="preview-prose-heading">Expected behavior</div>
                  <p>
                    When a payment fails, retry the transaction up to 3 times
                    using the original transaction ID. A retry must never create
                    a second charge.
                  </p>
                  <div className="preview-prose-heading">
                    Acceptance criteria
                  </div>
                  <div className="preview-criterion">
                    <Square />
                    <span>Retries reuse the transaction ID</span>
                  </div>
                  <div className="preview-criterion">
                    <Square />
                    <span>Stop after the third attempt</span>
                  </div>
                  <div className="preview-criterion">
                    <Square />
                    <span>Record each failed attempt</span>
                  </div>
                </div>
                <div className="preview-branches">
                  <div className="preview-branch-main">
                    <GitBranch />
                    <strong>main</strong>
                    <span>Revision 13</span>
                    <span className="preview-branch-action">
                      <GitPullRequest /> Branches &amp; pull requests
                    </span>
                  </div>
                  <div className="preview-pr">
                    <GitPullRequest />
                    <span>Define retry failure scenarios</span>
                    <span className="preview-pr-author">
                      <IntelligenceMark /> Lictory Intelligence
                    </span>
                    <ChevronRight />
                  </div>
                </div>
                <div className="preview-discussion">
                  <div className="preview-section-label">
                    Discussions <span>0 open</span>
                  </div>
                  <div className="preview-discussion-header">
                    <Avatar name="Maya Chen" size="xs" />
                    <span>Maya Chen</span>
                    <span>Resolved</span>
                  </div>
                  <blockquote>
                    How many retries? Could we charge twice?
                  </blockquote>
                  <p>The limit and idempotency are defined in revision 13.</p>
                </div>
              </div>
              <Properties />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StoryIcon() {
  return (
    <span className="preview-type-icon">
      <Bookmark />
    </span>
  );
}

function Sidebar() {
  return (
    <aside className="preview-sidebar">
      <div className="preview-org">
        <span className="preview-org-mark">A</span>
        <strong>Acme</strong>
        <ChevronsUpDown />
        <PanelLeft />
        <Search />
      </div>
      <div className="preview-new">
        <Plus />
        New item <Kbd>C</Kbd>
      </div>
      <div className="preview-nav">
        <span>
          <Inbox /> Inbox
        </span>
        <span>
          <IntelligenceMark /> Litto
        </span>
      </div>
      <div className="preview-project">
        <code>PAY</code>
        <strong>Payments</strong>
        <ChevronsUpDown />
      </div>
      <div className="preview-section-label">Work</div>
      <div className="preview-nav">
        <span>
          <span className="preview-epic-icon">
            <Zap />
          </span>{" "}
          Epics
        </span>
        <span className="preview-nav-active">
          <StoryIcon /> Work items
        </span>
        <span>
          <BookOpenCheck /> Reviews
        </span>
      </div>
      <div className="preview-section-label">Delivery</div>
      <div className="preview-nav">
        <span>
          <KanbanSquare /> Board
        </span>
        <span>
          <ListOrdered /> Backlog &amp; sprints
        </span>
      </div>
      <div className="preview-sidebar-bottom">
        <Settings /> Organization settings
      </div>
      <div className="preview-account">
        <Avatar name="Theo Martin" size="xs" />
        <span>Theo Martin</span>
        <ChevronsUpDown />
      </div>
    </aside>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="preview-property">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Properties() {
  return (
    <aside className="preview-properties">
      <div className="preview-section-label">Properties</div>
      <Property label="Status">
        <CircleDashed />
        Backlog
      </Property>
      <Property label="Refinement">
        <Circle />
        In review
      </Property>
      <Property label="Type">
        <StoryIcon />
        Story
      </Property>
      <Property label="Team">
        <UserRound />
        Payments
      </Property>
      <Property label="Priority">
        <span>−</span>No priority
      </Property>
      <Property label="Owner">
        <Avatar name="Theo Martin" size="xs" />
        Theo Martin
      </Property>
      <Property label="Labels">None</Property>
      <div className="preview-section-label preview-panel-heading">
        Review <span>Request</span>
      </div>
      <div className="preview-review-card" data-approved>
        <div>
          <ShieldCheck />
          <strong>Engineering</strong>
          <span>Approved</span>
        </div>
        <p>
          <Avatar name="Theo Martin" size="xs" />
          Theo Martin · revision 13
        </p>
      </div>
      <div className="preview-review-card">
        <div>
          <CircleDashed />
          <strong>QA</strong>
          <span>Requested</span>
        </div>
        <p>
          <Avatar name="Maya Chen" size="xs" />
          Maya Chen
        </p>
      </div>
      <div className="preview-section-label preview-panel-heading">
        Readiness <span>3 / 4 checks</span>
      </div>
      <div className="preview-check">
        <Check />
        The specification is not empty
      </div>
      <div className="preview-check">
        <Check />
        No blocking discussion is open
      </div>
      <div className="preview-check">
        <Check />
        At least one required review is requested
      </div>
      <div className="preview-check">
        <Circle />
        Every required review approved
      </div>
    </aside>
  );
}

/** Presentation-only excerpt of Litto's actual dock: context, user bubble,
 * tool activity and a plain assistant answer. */
export function AgentPreview() {
  return (
    <div
      className="agent-preview app-preview dark"
      data-theme="lictory"
      role="img"
      aria-label="An example Litto conversation proposing a specification change"
    >
      <div className="agent-preview-header">
        <IntelligenceMark />
        <span>Litto</span>
        <MoreHorizontal />
      </div>
      <div className="agent-preview-thread">
        <div className="agent-preview-context">
          <StoryIcon />
          <span>PAY-142 · Retry failed payments</span>
        </div>
        <div className="agent-preview-user">
          Review the retry proposal for missing failure scenarios and propose a
          fix on a branch.
        </div>
        <div className="agent-preview-activity">
          <span>
            <Check />
            Read specification
          </span>
          <span>
            <GitBranch />
            Created failure-scenarios
          </span>
          <span>
            <GitPullRequest />
            Opened a pull request
          </span>
        </div>
        <div className="agent-preview-answer">
          <IntelligenceMark />
          <p>
            I proposed a retry limit and an idempotency check on a separate
            branch. The changes are ready for your review.
          </p>
        </div>
        <div className="agent-preview-reference">
          <GitPullRequest />
          <span>Define retry failure scenarios</span>
          <ChevronRight />
        </div>
      </div>
      <div className="agent-preview-composer">
        <span>Ask Litto…</span>
        <ArrowUp />
      </div>
    </div>
  );
}
