import type { ReactNode } from "react";
import {
  Archive,
  ChevronDown,
  CornerDownRight,
  GitBranch,
  GitPullRequest,
  History,
  MoreHorizontal,
  MoveRight,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Popover, usePopover } from "@lictory/ui/popover";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import {
  Menu,
  MenuItem,
  MenuSeparator,
} from "@lictory/platform/components/spaces/menu";
import {
  versionOf,
  type PageHistory,
  type PageLine,
} from "@lictory/platform/components/spaces/editor/line";
import { usePageBranchSelection } from "@lictory/platform/components/spaces/history/branch-selection";

// The page header's statement and controls: what is on screen (the
// published version, a branch, or the live draft) in one line, and one
// toolbar beside it: the line switcher, comments, the primary action and
// everything else in a "More" menu.

function When({ at }: { at: string }) {
  return (
    <time dateTime={at} title={absoluteTime(at)}>
      {relativeTime(at)}
    </time>
  );
}

// A status in the product's grammar: a dot and a word, colored only when it
// means something.
export function StateDot({
  tone,
  children,
}: {
  tone: "published" | "draft" | "branch" | "neutral";
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          tone === "published" && "bg-success",
          tone === "draft" && "bg-brand",
          tone === "branch" && "bg-ring",
          tone === "neutral" && "bg-muted-foreground/60",
        )}
      />
      {children}
    </span>
  );
}

// One fact of a status line, with the separator before it: a line that
// wraps never leaves a dot dangling at its end.
export function Fact({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className="text-muted-foreground/60">
        ·
      </span>
      {children}
    </span>
  );
}

// "Published version 3 · by Maria Chen · 2 min ago", or the branch on
// screen with its latest commit.
export function PageStatement({
  space,
  page,
  line,
  history,
  onOpenDraft,
}: {
  space: Space;
  page: SpacePage;
  line: PageLine;
  history: PageHistory;
  // Switches to the live draft (people who may edit it).
  onOpenDraft?: () => void;
}) {
  const { memberName } = useWorkspace();
  const head = line.head;
  const version = head ? versionOf(history.commits, head.id) : undefined;
  const row = "flex flex-wrap items-center gap-x-1.5 gap-y-1";
  if (!line.isMain && line.branch) {
    const pullRequest = history.pullRequests.some(
      (p) => p.sourceBranchId === line.branch?.id && p.status !== "merged",
    );
    return (
      <p className={row}>
        <StateDot tone="branch">Branch {line.branch.name}</StateDot>
        <Fact>
          <span>by {memberName(line.branch.authorId)}</span>
        </Fact>
        {head && (
          <Fact>
            <span>
              {version ? `version ${version}, ` : ""}committed{" "}
              <When at={head.createdAt} />
            </span>
          </Fact>
        )}
        {pullRequest && (
          <Fact>
            <span>pull request open</span>
          </Fact>
        )}
      </p>
    );
  }
  const approved =
    space.publishing === "reviewed" &&
    head !== undefined &&
    head.approverIds.length > 0 &&
    page.approvedCommitId === head.id;
  const unpublished =
    !line.reviewed && line.canEditSpace && line.draft?.uncommittedChanges;
  return (
    <p className={row}>
      <StateDot tone="published">
        {version ? `Published version ${version}` : "Published"}
      </StateDot>
      {approved && (
        <span
          title={`Approved by ${head.approverIds.map(memberName).join(", ")}`}
          className="inline-flex h-5 items-center rounded-full bg-success/8 px-2 text-[11px] font-medium text-success ring-1 ring-success/20 ring-inset"
        >
          Approved
        </span>
      )}
      <Fact>
        <span>by {memberName(head?.authorId ?? page.createdById)}</span>
      </Fact>
      <Fact>
        <When at={head?.createdAt ?? page.updatedAt} />
      </Fact>
      {unpublished && (
        <>
          {onOpenDraft && line.writable ? (
            <button
              type="button"
              onClick={onOpenDraft}
              title="The live draft was edited after this version was published. Open it."
              className="inline-flex h-6 items-center gap-1 rounded-full bg-warning/8 px-2 text-[11px] font-medium text-warning ring-1 ring-warning/25 transition-[background-color] duration-150 ease-out outline-none ring-inset hover:bg-warning/14 focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              Unpublished draft
            </button>
          ) : (
            <span
              title="The live draft was edited after this version was published."
              className="inline-flex h-5 items-center rounded-full bg-warning/8 px-2 text-[11px] font-medium text-warning ring-1 ring-warning/25 ring-inset"
            >
              Unpublished draft
            </span>
          )}
        </>
      )}
    </p>
  );
}

// Which line of the page is on screen: main (what readers get) or one of
// its branches. Shown once a page has branches.
export function LineSwitcher({
  page,
  history,
}: {
  page: SpacePage;
  history: PageHistory;
}) {
  const { memberName, organization } = useWorkspace();
  const { space } = usePageActions();
  const { branchId, branch, setBranch } = usePageBranchSelection();
  const branches = [...history.branches].sort(
    (a, b) =>
      Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name),
  );
  if (branches.length < 2 || !branch) return null;
  const historyHref = `${paths.spacePage(organization.slug, space.slug, page.id)}/history`;
  const openPulls = history.pullRequests.filter((p) => p.status !== "merged");
  return (
    <Popover
      width={300}
      align="end"
      trigger={(props) => (
        <Button
          {...props}
          variant="secondary"
          size="sm"
          aria-label={`Branch: ${branch.name}`}
          className="max-w-44 pr-2.5"
        >
          <GitBranch className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{branch.name}</span>
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </Button>
      )}
    >
      {(close) => (
        <>
          <SrTitle>Switch branch</SrTitle>
          <Menu label="Branches of this page">
            {branches.map((b) => {
              const open = openPulls.some((p) => p.sourceBranchId === b.id);
              const facts = b.isMain
                ? [
                    "Published",
                    space.publishing === "reviewed"
                      ? "changes by review"
                      : b.draft?.uncommittedChanges
                        ? "draft has unpublished changes"
                        : null,
                  ]
                : [
                    `by ${memberName(b.authorId)}`,
                    b.draft?.uncommittedChanges ? "uncommitted changes" : null,
                    open ? "pull request" : null,
                  ];
              return (
                <MenuItem
                  key={b.id}
                  checked={b.id === branchId}
                  icon={
                    b.id === branchId ? (
                      <span className="size-2 rounded-full bg-foreground" />
                    ) : (
                      <GitBranch />
                    )
                  }
                  onSelect={() => {
                    close();
                    setBranch(b.id);
                  }}
                >
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {facts.filter(Boolean).join(" · ")}
                  </span>
                </MenuItem>
              );
            })}
            <MenuSeparator />
            <MenuItem
              icon={<GitBranch />}
              href={`${historyHref}?view=branches`}
              onSelect={close}
            >
              All branches
            </MenuItem>
            <MenuItem
              icon={<GitPullRequest />}
              href={`${historyHref}?view=pulls`}
              hint={openPulls.length || undefined}
              onSelect={close}
            >
              Pull requests
            </MenuItem>
          </Menu>
        </>
      )}
    </Popover>
  );
}

function SrTitle({ children }: { children: ReactNode }) {
  const labelId = usePopover()?.labelId;
  return (
    <h2 id={labelId} className="sr-only">
      {children}
    </h2>
  );
}

// Everything that is not the primary action: page structure, history and
// review, and the page's facts.
export function PageMoreMenu({
  page,
  history,
}: {
  page: SpacePage;
  history: PageHistory;
}) {
  const { organization, memberName } = useWorkspace();
  const { space, canEdit, createPage, movePage, archivePage } =
    usePageActions();
  const href = `${paths.spacePage(organization.slug, space.slug, page.id)}/history`;
  const openPulls = history.pullRequests.filter(
    (p) => p.status !== "merged",
  ).length;
  const branches = history.branches.filter((b) => !b.isMain).length;
  const versions = history.commits.length;
  const editable = canEdit && !page.archivedAt;
  return (
    <Popover
      width={248}
      align="end"
      trigger={(props) => (
        <Button
          {...props}
          variant="ghost"
          size="icon"
          aria-label="More page actions"
          title="More page actions"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      )}
    >
      {(close) => (
        <>
          <SrTitle>Page actions</SrTitle>
          <Menu label="Page actions">
            {editable && (
              <>
                <MenuItem
                  icon={<CornerDownRight />}
                  onSelect={() => {
                    close();
                    createPage(page.id);
                  }}
                >
                  New subpage
                </MenuItem>
                <MenuItem
                  icon={<MoveRight />}
                  onSelect={() => {
                    close();
                    movePage(page);
                  }}
                >
                  Move…
                </MenuItem>
                <MenuItem
                  icon={<Archive />}
                  onSelect={() => {
                    close();
                    archivePage(page);
                  }}
                >
                  Archive
                </MenuItem>
                <MenuSeparator />
              </>
            )}
            <MenuItem icon={<History />} href={href} onSelect={close}>
              Version history
            </MenuItem>
            <MenuItem
              icon={<GitBranch />}
              href={`${href}?view=branches`}
              hint={branches || undefined}
              onSelect={close}
            >
              Branches
            </MenuItem>
            <MenuItem
              icon={<GitPullRequest />}
              href={`${href}?view=pulls`}
              hint={openPulls || undefined}
              onSelect={close}
            >
              Pull requests
            </MenuItem>
          </Menu>
          <p className="border-t px-3 py-2 text-xs leading-5 text-muted-foreground">
            Created by {memberName(page.createdById)},{" "}
            <When at={page.createdAt} />
            {history.loaded || versions ? (
              <>
                <br />
                {versions === 1 ? "1 version" : `${versions} versions`}
              </>
            ) : null}
          </p>
        </>
      )}
    </Popover>
  );
}
