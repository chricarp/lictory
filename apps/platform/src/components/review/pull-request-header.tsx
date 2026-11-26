import type { ReactNode } from "react";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import { TabsList, TabsTab } from "@ui-sdk/react/tabs";
import { cn } from "@lictory/core/lib/utils";
import { StatusChip, type StatusTone } from "@lictory/ui/status-chip";
import { BranchChip } from "@lictory/platform/components/review/flow-ui";
import { ScrollStrip } from "@lictory/platform/components/shell/scroll-strip";

// The head of a pull request, the same for code (a code host's pull
// request) and specifications (a branch of a specification): its title, a
// state chip, who wants to merge how many commits into which branch from
// which, and the views below it as underlined tabs. The page's own
// `PageHeader` stays above it; this is the pull request's heading inside
// the page.
//
// Tabs are ui-sdk tabs: wrap the header and its panels in one `Tabs` root
// (from `@ui-sdk/react/tabs`) and pass `PullRequestTabs` as `tabs`.

export type PullRequestState = "draft" | "open" | "merged" | "closed";

const states: Record<
  PullRequestState,
  { label: string; tone: StatusTone; icon: ReactNode }
> = {
  draft: { label: "Draft", tone: "neutral", icon: <GitPullRequestDraft /> },
  open: { label: "Open", tone: "success", icon: <GitPullRequest /> },
  merged: { label: "Merged", tone: "info", icon: <GitMerge /> },
  closed: { label: "Closed", tone: "neutral", icon: <GitPullRequestClosed /> },
};

export function PullRequestStateChip({
  state,
  label,
}: {
  state: PullRequestState;
  label?: string;
}) {
  const s = states[state];
  return (
    <StatusChip tone={s.tone} icon={s.icon}>
      {label ?? s.label}
    </StatusChip>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function PullRequestHeader({
  title,
  number,
  state,
  stateLabel,
  author,
  mergedBy,
  commits,
  summary,
  base,
  head,
  onHeadClick,
  headGone = false,
  meta,
  tabs,
  headingLevel = 2,
  className,
}: {
  title: ReactNode;
  // The host's number ("#3"), shown after the title.
  number?: number;
  state: PullRequestState;
  // The state in the subject's words ("Applied" for a specification's
  // change); the code host's words by default.
  stateLabel?: string;
  // Who opened it: an `Actor`, or an `AgentActor` for agent-authored work.
  author: ReactNode;
  // Who merged it, when not the author (a person merging an agent's work,
  // Autopilot): the sentence names them and says who opened it after.
  mergedBy?: ReactNode;
  // How many commits it merges, when known.
  commits?: number;
  // Says what it does in the words of its subject instead of "wants to
  // merge N commits into base from head" (a specification's breakdown).
  summary?: ReactNode;
  // The branch it merges into, and the branch it merges from.
  base: string;
  head: string;
  // Opens the source branch (specification pull requests).
  onHeadClick?: () => void;
  // The source branch was deleted after the merge.
  headGone?: boolean;
  // More quiet facts after the sentence ("head 1a2b3c4 · updated 5m ago").
  meta?: ReactNode;
  // `PullRequestTabs`.
  tabs?: ReactNode;
  // The page's h1 is its `PageHeader`; this heading sits under it. A
  // specification's pull request takes the item's place under the item's
  // bar, which has no heading of its own, so it is the page's h1 there
  // (like `ItemScreenTitle`).
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const Heading = ({ 1: "h1", 2: "h2", 3: "h3" } as const)[headingLevel];
  const merger = state === "merged" ? mergedBy : undefined;
  return (
    <header data-pull-request-header className={cn("min-w-0", className)}>
      <Heading className="text-xl leading-7 font-semibold tracking-[-0.01em] wrap-break-word">
        {title}
        {number !== undefined && (
          <span className="ml-2 font-normal text-muted-foreground">
            #{number}
          </span>
        )}
      </Heading>
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[13px] text-muted-foreground [--actor-ring:var(--background)]">
        <PullRequestStateChip state={state} label={stateLabel} />
        <span className="inline-flex min-w-0 items-center font-medium text-foreground">
          {merger ?? author}
        </span>
        {summary ? (
          <span>{summary}</span>
        ) : (
          <>
            <span>
              {state === "merged" ? "merged" : "wants to merge"}
              {commits !== undefined && ` ${plural(commits, "commit")}`} into
            </span>
            <BranchChip name={base} />
            <span>from</span>
            <BranchChip name={head} muted={headGone} onClick={onHeadClick} />
          </>
        )}
        {merger && (
          <>
            <span aria-hidden>·</span>
            <span>opened by</span>
            <span className="inline-flex min-w-0 items-center font-medium text-foreground">
              {author}
            </span>
          </>
        )}
        {meta}
      </p>
      {tabs && <div className="mt-4">{tabs}</div>}
    </header>
  );
}

// The views of a pull request (Conversation, Commits, Checks, Files
// changed) as underlined tabs; arrow keys move between them.
export function PullRequestTabs({
  label,
  tabs,
}: {
  // Names the tab list: "Pull request views".
  label: string;
  tabs: readonly {
    value: string;
    label: string;
    count?: number;
    icon?: ReactNode;
  }[];
}) {
  return (
    <ScrollStrip>
      <TabsList
        aria-label={label}
        className="flex [scrollbar-width:none] gap-1 overflow-x-auto border-b"
      >
        {tabs.map((t) => (
          <TabsTab
            key={t.value}
            value={t.value}
            className="relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[13px] whitespace-nowrap text-muted-foreground focus-ring-inset transition-colors outline-none hover:text-foreground data-selected:border-foreground data-selected:font-medium data-selected:text-foreground [&_svg]:size-3.5"
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">
                {t.count}
              </span>
            )}
          </TabsTab>
        ))}
      </TabsList>
    </ScrollStrip>
  );
}
