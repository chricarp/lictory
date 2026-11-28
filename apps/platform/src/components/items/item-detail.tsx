import { DropdownItem } from "@lictory/ui/dropdown";
import { replaceQuote } from "@lictory/core/editor/markdown-text";
import { ItemCode } from "@lictory/platform/components/code/item-code";
import { Link } from "@lictory/platform/lib/navigation";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@ui-sdk/react/drawer";
import { popupContainer } from "@lictory/ui/popup";
import { PhoneChromeContext } from "@lictory/platform/components/shell/page-header";
import { createPortal, flushSync } from "react-dom";
import { usePaneWidth } from "@lictory/platform/lib/pane-width";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  CornerLeftUp,
  GitCompareArrows,
  Link2,
  MoreHorizontal,
  PanelRight,
  Upload,
  Bot,
  X,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { scrimClass } from "@lictory/ui/dialog";
import { track } from "@lictory/core/lib/analytics/client";
import {
  identifier,
  enabledTypes,
  refinementMeta,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Popover } from "@lictory/ui/popover";
import {
  PaneResizer,
  usePaneResize,
  type PaneSpec,
} from "@lictory/platform/components/workspace/pane-resizer";
import { Badge, SectionLabel } from "@lictory/ui/primitives";
import {
  useItemView,
  useWorkspace,
} from "@lictory/platform/components/workspace/provider";
import { IssueIdentifier } from "@lictory/platform/components/items/identifier";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { Presence } from "@lictory/platform/components/items/presence";
import { WatchButton } from "@lictory/platform/components/notifications/watch-button";
import { useAgents } from "@lictory/platform/components/claims/claims";
import {
  StartSessionDialog,
  startableAgents,
} from "@lictory/platform/components/factory/start-session";
import {
  IssueStatus,
  RefinementStatus,
} from "@lictory/platform/components/items/status";
import {
  EstimatePicker,
  IterationPicker,
  Relations,
  TeamPicker,
  TypePicker,
} from "@lictory/platform/components/items/delivery-properties";
import {
  IssuePriority,
  ParentPicker,
} from "@lictory/platform/components/items/properties";
import {
  LabelChip,
  LabelPicker,
  MilestoneBadge,
  MilestonePicker,
} from "@lictory/platform/components/items/labels";
import {
  ItemContext,
  useItem,
  useItemContextValue,
} from "@lictory/platform/components/items/item-context";
import { Specification } from "@lictory/platform/components/items/specification";
import { Attachments } from "@lictory/platform/components/items/attachments";
import { ItemConversations } from "@lictory/platform/components/channels/item-conversations";
import {
  ItemKnowledge,
  KnowledgeJump,
} from "@lictory/platform/components/knowledge/item-knowledge";
import { EpicStories } from "@lictory/platform/components/items/epic-stories";
import { InlineTitle } from "@lictory/platform/components/items/inline-title";
import { ItemScreenTitle } from "@lictory/platform/components/items/screen-title";
import { ReviewAnnouncer } from "@lictory/platform/components/review/announce";
import {
  useListPanel,
  WorkItemListToggle,
} from "@lictory/platform/components/items/split-view";
import { Discussions } from "@lictory/platform/components/review/threads";
import {
  BranchEntry,
  BranchWorkspace,
  useProposeBreakdown,
  useSuggestChange,
  type BranchScreen,
} from "@lictory/platform/components/review/branch-workspace";
import {
  ReviewPanel,
  useMyReview,
} from "@lictory/platform/components/review/review-panel";
import { Readiness } from "@lictory/platform/components/review/readiness";
import {
  ClaimPanel,
  DefinitionOfDonePanel,
} from "@lictory/platform/components/claims/item-panels";
import { OwnerField } from "@lictory/platform/components/claims/claim-badge";
import { AiReviewView } from "@lictory/platform/components/review/ai-review";
import { DockItemSource } from "@lictory/platform/components/intelligence/dock/item-source";
import { Activity } from "@lictory/platform/components/review/activity";
import {
  DecisionComposerScope,
  Decisions,
} from "@lictory/platform/components/review/decisions";
import { DeliveryScope } from "@lictory/platform/components/items/delivery-scope";
import { ItemWorkflow } from "@lictory/platform/components/items/item-workflow";
import {
  ItemStatusStrip,
  railSectionSelector,
} from "@lictory/platform/components/items/status-strip";
import {
  itemOrigin,
  originLink,
  originParams,
} from "@lictory/platform/components/items/queues";
import {
  HistoryNav,
  RevisionPanel,
  SpecVersions,
  type HistoryScreen,
} from "@lictory/platform/components/review/revisions";
import {
  SpecDiscussionsContext,
  useSpecDiscussions,
  useSpecDiscussionsState,
} from "@lictory/platform/components/review/spec-discussions";
import {
  CommentsJump,
  DiscussionsToggle,
  SpecDiscussionPanel,
} from "@lictory/platform/components/review/discussion-panel";
import { DiscussionSheet } from "@lictory/platform/components/discussions/presentation";
import { useElementWidth } from "@lictory/platform/components/discussions/width";
import { diffStats } from "@lictory/ui/diff";
import {
  ExportDialog,
  ExternalDelivery,
  useExportAvailability,
} from "@lictory/platform/components/delivery/export";
import {
  LittoConcerns,
  LittoLauncher,
} from "@lictory/platform/components/intelligence/dock/launcher";

export type DetailMode =
  | { kind: "read" }
  | { kind: "edit" }
  | BranchScreen
  | HistoryScreen
  | { kind: "ai"; id: string };

// The surface a URL names: Litto's review, a pull request, a branch, the
// branch list, the specification's history, or the specification.
function modeFrom(params: URLSearchParams): DetailMode {
  const pr = params.get("pr"),
    branch = params.get("branch"),
    ai = params.get("ai"),
    history = params.get("history");
  if (ai) return { kind: "ai", id: ai };
  if (pr) return { kind: "pr", id: pr };
  if (branch) return { kind: "branch", id: branch };
  if (params.has("branches")) return { kind: "branches" };
  if (history !== null)
    return {
      kind: "history",
      revision: history || null,
      compare: params.get("compare"),
      thread: params.get("thread"),
    };
  return { kind: "read" };
}
const sameMode = (a: DetailMode, b: DetailMode) =>
  JSON.stringify(a) === JSON.stringify(b);

const seenKey = (id: string) => `lictory:seen:${id}`;

export function ItemDetail({
  item,
  project,
  pendingCreate,
}: {
  item: WorkItem;
  project: Project;
  pendingCreate: boolean;
}) {
  const workspace = useWorkspace();
  const lastOpened = useRef<string | null>(null);
  useEffect(() => {
    const key = `${workspace.organization.id}:${item.id}`;
    if (lastOpened.current === key) return;
    lastOpened.current = key;
    track("work_item_opened", {
      organization_id: workspace.organization.id,
      project_id: item.projectId,
      work_item_id: item.id,
      team_id: item.teamId,
      type_id: item.typeId,
    });
  }, [
    workspace.organization.id,
    item.id,
    item.projectId,
    item.teamId,
    item.typeId,
  ]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const itemView = useItemView(item.id, !pendingCreate);
  const type = typeOf(workspace.delivery, item);
  const native = project.deliveryMode === "native";
  const { capabilitiesIn } = workspace;
  // Stable inputs keep the item context (and every consumer) from being
  // rebuilt on renders that changed nothing about this item.
  const capabilities = useMemo(
    () => capabilitiesIn(item.projectId),
    [capabilitiesIn, item.projectId],
  );
  const ctx = useItemContextValue({
    item,
    type,
    project,
    entities: itemView.entities,
    view: itemView.view,
    userId: workspace.userId,
    disciplineIds: workspace.disciplineIds,
    memberName: workspace.memberName,
    disciplineName: workspace.disciplineName,
    capabilities,
    mutate: itemView.mutate,
    mutateConfirmed: workspace.mutateConfirmed,
  });
  // Branch and pull request workspaces are linkable and survive navigation.
  const [mode, setModeState] = useState<DetailMode>(() =>
    modeFrom(new URLSearchParams(searchParams.toString())),
  );
  // The document pane's scroller: a new screen opens at its top, not at
  // the scroll position of the one it replaced (sending a breakdown for
  // review from the bottom of the editor landed at the review's activity).
  const setMode = useCallback(
    (next: DetailMode) => {
      if (
        next.kind === "pr" ||
        next.kind === "branch" ||
        next.kind === "branches"
      )
        requestAnimationFrame(() =>
          document.querySelector("[data-pane-document]")?.scrollTo({ top: 0 }),
        );
      track("specification_mode_selected", {
        organization_id: workspace.organization.id,
        project_id: item.projectId,
        work_item_id: item.id,
        mode: next.kind,
      });
      setModeState(next);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("suggestion");
      params.delete("pr");
      params.delete("branch");
      params.delete("branches");
      params.delete("ai");
      params.delete("history");
      params.delete("compare");
      params.delete("thread");
      if (next.kind === "history") {
        params.set("history", next.revision ?? "");
        if (next.compare) params.set("compare", next.compare);
        if (next.thread) params.set("thread", next.thread);
      }
      if (next.kind === "ai") params.set("ai", next.id);
      if (next.kind === "pr") params.set("pr", next.id);
      if (next.kind === "branch") params.set("branch", next.id);
      if (next.kind === "branches") params.set("branches", "1");
      const query = params.toString();
      // Branch and pull request screens are real places: keep them in history
      // so Back returns to the previous step of the flow.
      const href = query ? `${pathname}?${query}` : pathname;
      if (
        next.kind === "branches" ||
        next.kind === "branch" ||
        next.kind === "pr" ||
        next.kind === "history"
      )
        router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [
      pathname,
      router,
      searchParams,
      workspace.organization.id,
      item.projectId,
      item.id,
    ],
  );
  const query = searchParams.toString();
  useEffect(() => {
    // Keep browser back/forward and incoming links aligned with the surface.
    const next = modeFrom(new URLSearchParams(query));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState((current) => (sameMode(current, next) ? current : next));
  }, [query]);
  const branchScreen =
    mode.kind === "branch" ||
    mode.kind === "pr" ||
    mode.kind === "branches" ||
    mode.kind === "history";
  // Full-width surfaces that replace the specification.
  const focusScreen = branchScreen || mode.kind === "ai";
  const showHistory = useCallback(
    (screen: Omit<HistoryScreen, "kind">) =>
      setMode({ kind: "history", ...screen }),
    [setMode],
  );
  // Discussions of the specification, beside its text: a column next to
  // the review rail while the text keeps a comfortable measure (the item
  // list steps aside for it first, like a page tree beside comments), in
  // the rail's place when only one of them fits, a sheet when the text
  // would not keep its readable minimum.
  const [row, setRow] = useState<HTMLElement | null>(null);
  const list = useListPanel();
  const frameWidth = useElementWidth(
    (row?.closest("[data-item-split]") as HTMLElement | null) ?? row,
  );
  const listWidth = list && !list.collapsed ? list.width : 0;
  // The rail as laid out (0 while folded into a drawer on narrow frames;
  // its last width while discussions hold its place).
  const [railElement, setRailElement] = useState<HTMLElement | null>(null);
  const railWidth = useElementWidth(railElement);
  // Docked down to a narrower text than the list and rail make room for: a
  // sheet over the specification hides the passage being discussed, which
  // costs more than a shorter line (200% zoom on a laptop is ~720px).
  const wide = frameWidth >= DISCUSSIONS_WIDTH + DOCKED_READABLE;
  const room = (list: number, rail: number) =>
    frameWidth - list - rail - DISCUSSIONS_WIDTH;
  const roomy = room(listWidth, railWidth) >= ROOMY;
  const discussions = useSpecDiscussionsState({
    content: ctx.current?.content ?? "",
    threads: ctx.threads,
    reviewable: ctx.reviewable,
    roomy,
    docked: wide,
    onShowRevision: useCallback(
      (revision: string, thread?: string) =>
        setMode({ kind: "history", revision, compare: "none", thread }),
      [setMode],
    ),
  });
  const discussionsShown =
    ctx.reviewable &&
    !pendingCreate &&
    (mode.kind === "read" || mode.kind === "edit");
  const discussionsColumn = discussionsShown && discussions.panelOpen && wide;
  // The specification is the primary surface: the list, then the rail,
  // step aside before the text drops below a comfortable measure (the
  // rail's state is summarized in the status card and the header's
  // "Review & details" brings it back).
  const listAside =
    discussionsColumn && room(listWidth, railWidth) < COMFORTABLE;
  const railHidden =
    listAside && railWidth > 0 && room(0, railWidth) < COMFORTABLE;
  // The column takes room the text does not need: wider (easier to
  // write in) when the text keeps a comfortable measure beside it.
  const discussionsWidth =
    DISCUSSIONS_WIDTH +
    Math.max(
      0,
      Math.min(
        DISCUSSIONS_EXTRA,
        room(listAside ? 0 : listWidth, railHidden ? 0 : railWidth) -
          COMFORTABLE,
      ),
    );
  // A width someone dragged the column to, never more than the room the
  // text leaves at its readable minimum (a smaller window, the rail or the
  // list beside it): the text keeps READABLE whatever was chosen earlier.
  const [chosenDiscussionsWidth] = usePaneWidth("discussions");
  const discussionsRoom =
    room(listAside ? 0 : listWidth, railHidden ? 0 : railWidth) +
    DISCUSSIONS_WIDTH -
    READABLE;
  const shownDiscussionsWidth =
    chosenDiscussionsWidth === null
      ? discussionsWidth
      : Math.max(
          DISCUSSIONS_WIDTH,
          Math.min(chosenDiscussionsWidth, discussionsRoom),
        );
  const setListAside = list?.setAside;
  useEffect(() => {
    setListAside?.(listAside);
  }, [setListAside, listAside]);
  useEffect(() => () => setListAside?.(false), [setListAside]);
  const [discussionsSlot, setDiscussionsSlot] = useState<HTMLElement | null>(
    null,
  );
  const [panelOpen, setPanelOpen] = useState(false);
  // The item's header is the page's header: on phones it takes the shell's
  // top bar (see PageHeader).
  const phone = useContext(PhoneChromeContext);
  useLayoutEffect(() => phone?.claim(), [phone]);
  // Scroll the review rail to one of its sections (checks and reviews, the
  // claim, the Definition of Done, code), or open the drawer at it when the
  // rail is folded away. The rail steps aside for discussions on mid-size
  // frames; asking for one of its sections brings it back.
  const openRailAt = (section: string) => {
    if (railHidden) discussions.setPanelOpen(false);
    const reveal = (panel: string) =>
      document
        .querySelector(`${panel} ${section}`)
        ?.scrollIntoView({ block: "start" });
    requestAnimationFrame(() => {
      const rail = document.querySelector("[data-desktop-item-panel]");
      if (rail?.getClientRects().length)
        return reveal("[data-desktop-item-panel]");
      flushSync(() => setPanelOpen(true));
      // Scroll the sheet's body only: its header stays in view, and the
      // sheet's own position is the drawer's.
      const scroller = document.querySelector<HTMLElement>(
        "[data-item-panel-scroll]",
      );
      const target = scroller?.querySelector(section);
      if (scroller && target)
        scroller.scrollTop +=
          target.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top;
    });
  };
  const rail = usePaneResize<HTMLElement>(railPane);
  // The discussions column can be dragged wider for long conversations.
  const discussionsPane = usePaneResize<HTMLElement>(discussionsPaneSpec);
  const attachDiscussions = discussionsPane.pane.attach;
  const discussionsRef = useCallback(
    (element: HTMLElement | null) => {
      setDiscussionsSlot(element);
      attachDiscussions(element);
    },
    [attachDiscussions],
  );
  const { attach: attachRail } = rail.pane;
  const attachMeasuredRail = useCallback(
    (element: HTMLElement | null) => {
      attachRail(element);
      if (element) setRailElement(element);
    },
    [attachRail],
  );
  const [exporting, setExporting] = useState(false);
  const exportAvailability = useExportAvailability(item);
  // Start an agent on this item: native delivery, for people with an agent
  // they may start. The dialog says what the agent works from and whether
  // the readiness policy would let agents take it on their own.
  const [startingAgent, setStartingAgent] = useState(false);
  const agents = useAgents();
  const canStartAgent =
    native &&
    !pendingCreate &&
    !item.archivedAt &&
    startableAgents(agents.values(), workspace.userId).length > 0;
  // Hand-off is offered for ready specifications of projects delivered in an
  // external tool.
  const canExport =
    type.hasSpecification &&
    exportAvailability.configured &&
    exportAvailability.allowed &&
    !item.archivedAt;
  // A comment being written on plain work (specifications use the panel).
  const [draft, setDraft] = useState<{
    quote?: string;
    section: string;
  } | null>(null);
  // Revision the user saw on their previous visit (this browser). Written back
  // on every confirmed revision so the banner is about what changed meanwhile.
  const [lastSeen, setLastSeen] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : localStorage.getItem(seenKey(item.id)),
  );
  const current = ctx.current;
  // First visit: the baseline is whatever revision was current when the page
  // opened, so edits that land while the reviewer is reading are surfaced too.
  if (!lastSeen && current && !current.id.startsWith("pending:"))
    setLastSeen(current.id);
  useEffect(() => {
    if (!current || current.id.startsWith("pending:")) return;
    localStorage.setItem(seenKey(item.id), current.id);
  }, [item.id, current]);
  // Baseline for "what changed": my most recent approval when it is newer than
  // the revision I last looked at, otherwise that revision.
  const seenRevision = useMemo(() => {
    const seen = lastSeen
      ? ctx.revisions.find((r) => r.id === lastSeen)
      : undefined;
    const approved = ctx.approvals
      .filter((a) => a.reviewerId === workspace.userId)
      .map((a) => ctx.revisions.find((r) => r.id === a.revisionId))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => b.number - a.number)[0];
    return approved && (!seen || approved.number > seen.number)
      ? approved
      : seen;
  }, [lastSeen, ctx.revisions, ctx.approvals, workspace.userId]);
  const changedSinceSeen = useMemo(() => {
    if (!seenRevision || !current || seenRevision.id === current.id)
      return undefined;
    if (current.authorId === workspace.userId) return undefined;
    return {
      ...diffStats(seenRevision.content, current.content),
      from: seenRevision,
      to: current,
    };
  }, [seenRevision, current, workspace.userId]);
  const parent = item.parentId
    ? workspace.items.find((i) => i.id === item.parentId)
    : undefined;
  const origin = originLink(
    workspace.organization.slug,
    project.key,
    itemOrigin(searchParams),
    searchParams,
  );
  const parentHref = parent
    ? paths.item(
        workspace.organization.slug,
        project.key,
        identifier(project, parent.number),
        originParams(searchParams),
      )
    : undefined;
  const compareRevisions =
    ctx.revisions.length > 1 && !branchScreen
      ? () =>
          showHistory({
            revision: current!.id,
            compare: (changedSinceSeen?.from ?? ctx.revisions[1])!.id,
          })
      : undefined;
  const involved =
    // Merging a breakdown makes no one the owner of its children
    // (notifications/server.ts owners()).
    (item.createdById === workspace.userId && !item.sourceRevisionId) ||
    item.assigneeId === workspace.userId ||
    ctx.messages.some((m) => m.authorId === workspace.userId) ||
    ctx.suggestions.some((x) => x.authorId === workspace.userId);
  const update = (
    patch: Omit<
      Extract<Parameters<typeof ctx.mutate>[0], { type: "updateWorkItem" }>,
      "type" | "workItemId"
    >,
  ) =>
    void ctx.mutate({ type: "updateWorkItem", workItemId: item.id, ...patch });
  const failing = ctx.readiness?.checks.filter((c) => !c.passed) ?? [];
  const openAiReview = useCallback(
    (id: string) => setMode({ kind: "ai", id }),
    [setMode],
  );
  // Readiness policy of the project, surfaced next to started statuses.
  const startHint =
    type.hasSpecification &&
    item.refinementState !== "ready" &&
    project.readinessPolicy !== "off"
      ? project.readinessPolicy === "block"
        ? "Blocked until the specification is ready"
        : "Specification not ready yet"
      : undefined;
  // Without the "change properties" capability the panel is informative only;
  // the server rejects the command regardless of what the UI renders.
  const canChange = ctx.canChangeProperties;
  const milestone = workspace.milestones.find((m) => m.id === item.milestoneId);
  const itemLabels = workspace.labels.filter((l) =>
    item.labelIds.includes(l.id),
  );
  const properties = (
    <div className="space-y-1">
      {native && (
        <Property label="Status">
          <IssueStatus
            projectId={item.projectId}
            statusId={item.statusId}
            onChange={
              canChange ? (statusId) => update({ statusId }) : undefined
            }
            hint={startHint}
          />
        </Property>
      )}
      {item.refinementState && (
        <Property label="Refinement">
          <RefinementStatus
            state={item.refinementState}
            onChange={
              canChange
                ? (refinementState) => update({ refinementState })
                : undefined
            }
            readyHint={
              item.refinementState === "ready"
                ? "Every readiness check passes"
                : failing.length
                  ? `${refinementMeta.ready.label} when ${failing.length} failing check${failing.length > 1 ? "s pass" : " passes"}`
                  : undefined
            }
          />
        </Property>
      )}
      <Property label="Type">
        <TypePicker
          item={item}
          onChange={canChange ? (typeId) => update({ typeId }) : undefined}
        />
      </Property>
      <Property label="Team">
        <TeamPicker
          projectId={item.projectId}
          teamId={item.teamId}
          onChange={canChange ? (teamId) => update({ teamId }) : undefined}
        />
      </Property>
      {native && project.iterationMode !== "off" && (
        <Property
          label={project.iterationMode === "automatic" ? "Cycle" : "Sprint"}
        >
          <IterationPicker
            item={item}
            onChange={
              canChange ? (iterationId) => update({ iterationId }) : undefined
            }
          />
        </Property>
      )}
      {native && project.estimateScale !== "none" && (
        <Property label="Estimate">
          <EstimatePicker
            item={item}
            onChange={
              canChange ? (estimate) => update({ estimate }) : undefined
            }
          />
        </Property>
      )}
      <Property label="Priority">
        <IssuePriority
          priority={item.priority}
          onChange={canChange ? (priority) => update({ priority }) : undefined}
        />
      </Property>
      {native && (
        <Property label="Owner">
          <OwnerField
            itemId={item.id}
            assigneeId={item.assigneeId}
            onChange={
              canChange ? (assigneeId) => update({ assigneeId }) : undefined
            }
          />
        </Property>
      )}
      {(Boolean(parent) ||
        enabledTypes(workspace.delivery, item.projectId).some(
          (candidate) => candidate.level > type.level,
        )) && (
        <Property label="Parent">
          {canChange ? (
            <ParentPicker
              parentId={item.parentId}
              projectId={item.projectId}
              childTypeId={item.typeId}
              project={project}
              onChange={(parentId) => update({ parentId })}
            />
          ) : (
            <span className="truncate px-1.5 text-[13px]">
              {parent
                ? `${identifier(project, parent.number)} ${parent.title}`
                : "No parent"}
            </span>
          )}
        </Property>
      )}
      <Property label="Milestone">
        {canChange ? (
          <MilestonePicker
            projectId={item.projectId}
            milestoneId={item.milestoneId}
            onChange={(milestoneId) => update({ milestoneId })}
          />
        ) : milestone ? (
          <MilestoneBadge milestone={milestone} />
        ) : (
          <span className="px-1.5 text-[13px] text-muted-foreground">None</span>
        )}
      </Property>
      <Property label="Labels">
        {canChange ? (
          <LabelPicker
            projectId={item.projectId}
            labelIds={item.labelIds}
            onChange={(labelIds) => update({ labelIds })}
          />
        ) : itemLabels.length ? (
          <div className="flex flex-wrap gap-1">
            {itemLabels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </div>
        ) : (
          <span className="px-1.5 text-[13px] text-muted-foreground">None</span>
        )}
      </Property>
    </div>
  );
  // The workflow card names accepted and delivered revisions; the scope
  // panel appears when there is a decision to make: accepting a ready
  // revision, or an amendment of the accepted one.
  const scopeInDocument =
    native &&
    (item.committedRevisionId
      ? item.committedRevisionId !== item.revisionId
      : item.refinementState === "ready");
  // Properties lead, readiness follows, then the review and the rest.
  const panel = (
    <div className="space-y-6 p-4">
      <section>
        <SectionLabel className="mb-2">Properties</SectionLabel>
        {properties}
      </section>
      {/* Who works on it (an agent's claim) and the evidence that it is
          done sit beside readiness (docs/internals/claims.md). */}
      <ClaimPanel />
      {ctx.reviewable ? (
        <div data-review-panel className="scroll-mt-4 space-y-6">
          <Readiness />
          <DefinitionOfDonePanel />
          <ReviewPanel />
        </div>
      ) : (
        <DefinitionOfDonePanel />
      )}
      <ExternalDelivery item={item} />
      {!pendingCreate && (
        <ItemCode item={item} project={project} canChange={canChange} />
      )}
      {ctx.reviewable ? (
        <RevisionPanel onHistory={showHistory} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {type.name} items have no reviews or readiness checks.
        </p>
      )}
    </div>
  );
  return (
    <ItemContext.Provider value={ctx}>
      <SpecDiscussionsContext.Provider value={discussions}>
        {!pendingCreate && ctx.reviewable && <ReviewAnnouncer />}
        {!pendingCreate && (
          <DockItemSource
            viewing={mode.kind === "ai" ? mode.id : null}
            onOpen={openAiReview}
          />
        )}
        <div className="flex h-full flex-col">
          {/* On phones the header keeps the way back, the item's key and
              the actions a reviewer reaches for (Knowledge, Discussions,
              Review & details); the parent and the rest move into More.
              Like every page header it takes the shell's top bar there:
              one 48px bar with the navigation button and search. */}
          <header
            data-page-header
            className="flex h-11 shrink-0 items-center gap-1.5 border-b px-3 text-[13px] max-lg:h-12 max-sm:gap-1 max-sm:px-1.5"
          >
            {phone && <div className="contents lg:hidden">{phone.leading}</div>}
            <WorkItemListToggle />
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-1 text-muted-foreground"
            >
              <Link
                href={origin.href}
                title={origin.label}
                className="shrink-0 hover:text-foreground max-sm:grid max-sm:size-8 max-sm:place-items-center max-sm:rounded-full max-sm:hover:bg-muted"
              >
                <ChevronLeft className="size-4 sm:hidden" aria-hidden />
                <span className="max-sm:sr-only">{origin.label}</span>
              </Link>
              {parent && (
                <>
                  <ChevronRight className="size-3.5 shrink-0 max-sm:hidden" />
                  <Link
                    href={parentHref!}
                    className="flex min-w-0 items-center gap-1 hover:text-foreground max-sm:hidden"
                    title={parent.title}
                  >
                    <TypeIcon type={typeOf(workspace.delivery, parent)} />
                    <span className="truncate @max-[62rem]/frame:sr-only">
                      {parent.title}
                    </span>
                  </Link>
                </>
              )}
              <ChevronRight className="size-3.5 shrink-0 max-sm:hidden" />
              <TypeIcon type={type} />
              <IssueIdentifier
                project={project}
                number={item.number}
                copyable
                className="shrink-0 text-foreground"
              />
            </nav>
            {item.archivedAt && <Badge tone="warning">Archived</Badge>}
            {!pendingCreate && <Presence itemId={item.id} />}
            <div className="ml-auto flex items-center gap-1">
              {!pendingCreate && (
                <KnowledgeJump
                  item={item}
                  project={project}
                  inline={!focusScreen}
                />
              )}
              {discussionsShown && (
                <DiscussionsToggle controls="item-discussions" />
              )}
              {!ctx.reviewable && !pendingCreate && !focusScreen && (
                <CommentsJump />
              )}
              {mode.kind === "history" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="max-sm:size-8 max-sm:px-0"
                  onClick={() => setMode({ kind: "read" })}
                >
                  <X className="size-3.5" aria-hidden />
                  <span className="max-sm:sr-only">Close history</span>
                </Button>
              ) : (
                compareRevisions && (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Compare revisions"
                    className="max-sm:hidden"
                    onClick={compareRevisions}
                  >
                    <GitCompareArrows className="size-3.5" />
                    <span className="max-sm:sr-only @max-[62rem]/frame:sr-only">
                      Changes
                    </span>
                  </Button>
                )
              )}
              {canExport && exportAvailability.external && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="max-sm:hidden"
                  disabled={item.refinementState !== "ready"}
                  title={
                    item.refinementState === "ready"
                      ? `Hand off to ${exportAvailability.connection?.name ?? exportAvailability.tool.name}`
                      : "Only ready specifications can be handed off."
                  }
                  onClick={() => setExporting(true)}
                >
                  <Upload className="size-3.5" /> Hand off to{" "}
                  {exportAvailability.tool.name}
                </Button>
              )}
              {!pendingCreate && (
                <WatchButton
                  organizationId={workspace.organization.id}
                  workItemId={item.id}
                  involved={involved}
                  className="max-sm:hidden"
                />
              )}
              <Popover
                width={200}
                align="end"
                trigger={(props) => (
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                )}
              >
                {(close) => (
                  <div className="p-1">
                    {/* Phones: what the header has no room for. */}
                    {parent && (
                      <DropdownItem
                        render={<Link href={parentHref!} onClick={close} />}
                        className="sm:hidden"
                      >
                        <CornerLeftUp
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 truncate">
                          Parent ·{" "}
                          <span className="font-mono text-xs">
                            {identifier(project, parent.number)}
                          </span>{" "}
                          {parent.title}
                        </span>
                      </DropdownItem>
                    )}
                    {mode.kind !== "history" && compareRevisions && (
                      <DropdownItem
                        className="sm:hidden"
                        onClick={() => {
                          close();
                          compareRevisions();
                        }}
                      >
                        <GitCompareArrows
                          className="size-3.5 text-muted-foreground"
                          aria-hidden
                        />
                        Compare revisions
                      </DropdownItem>
                    )}
                    {!pendingCreate && (
                      <WatchButton
                        organizationId={workspace.organization.id}
                        workItemId={item.id}
                        involved={involved}
                        appearance="menuitem"
                        className="sm:hidden"
                      />
                    )}
                    <DropdownItem
                      onClick={async () => {
                        await navigator.clipboard?.writeText(
                          window.location.href,
                        );
                        close();
                      }}
                    >
                      <Link2 className="size-3.5 text-muted-foreground" /> Copy
                      link
                    </DropdownItem>
                    {canStartAgent && (
                      <DropdownItem
                        onClick={() => {
                          close();
                          setStartingAgent(true);
                        }}
                      >
                        <Bot
                          className="size-3.5 text-muted-foreground"
                          aria-hidden
                        />
                        Start agent…
                      </DropdownItem>
                    )}
                    {canExport && (
                      <DropdownItem
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-50",
                          // External delivery has its own header button
                          // where there is room for it.
                          exportAvailability.external && "sm:hidden",
                        )}
                        disabled={item.refinementState !== "ready"}
                        title={
                          item.refinementState === "ready"
                            ? undefined
                            : "Only ready specifications can be handed off."
                        }
                        onClick={() => {
                          close();
                          setExporting(true);
                        }}
                      >
                        <Upload className="size-3.5 text-muted-foreground" />
                        Hand off to {exportAvailability.tool.name}…
                      </DropdownItem>
                    )}
                    <DropdownItem
                      disabled={!ctx.capabilities.changeProperties}
                      title={
                        ctx.capabilities.changeProperties
                          ? undefined
                          : "Your roles cannot archive or restore items."
                      }
                      onClick={() => {
                        close();
                        void ctx.mutate({
                          type: "archiveWorkItem",
                          workItemId: item.id,
                          archived: !item.archivedAt,
                        });
                      }}
                    >
                      {item.archivedAt ? (
                        <ArchiveRestore className="size-3.5 text-muted-foreground" />
                      ) : (
                        <Archive className="size-3.5 text-muted-foreground" />
                      )}
                      {item.archivedAt ? "Restore" : "Archive"}
                    </DropdownItem>
                  </div>
                )}
              </Popover>
              {/* The review rail folded away: say what it holds. */}
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "max-sm:size-8 max-sm:px-0",
                  !railHidden && "@min-[53rem]/frame:hidden",
                )}
                aria-label="Review & details"
                onClick={() => setPanelOpen(true)}
              >
                <PanelRight className="size-4" />
                <span className="max-sm:hidden">Review & details</span>
              </Button>
              {!pendingCreate && (
                <>
                  <span
                    aria-hidden
                    className="mx-1 h-4 w-px bg-border max-lg:hidden"
                  />
                  <LittoConcerns />
                  <LittoLauncher />
                </>
              )}
              {/* On phones the shell's "+" stays in the navigation drawer
                  (as in a channel), so the bar fits at 320px. */}
              {phone && (
                <div className="contents max-sm:hidden lg:hidden">
                  {phone.trailing}
                </div>
              )}
            </div>
          </header>
          <div ref={setRow} className="flex min-h-0 flex-1">
            <div data-pane-document className="min-w-0 flex-1 overflow-y-auto">
              <div
                className={
                  branchScreen
                    ? "mx-auto max-w-6xl px-4 py-6 lg:px-8"
                    : discussionsColumn
                      ? // Beside discussions the text keeps its measure:
                        // the gutters give way first.
                        "mx-auto max-w-3xl px-5 py-7"
                      : "mx-auto max-w-3xl px-5 py-7 lg:px-8 @min-[81rem]/frame:px-10"
                }
              >
                {changedSinceSeen && !focusScreen && (
                  <ChangedSince
                    changed={changedSinceSeen}
                    onShow={() =>
                      showHistory({
                        revision: changedSinceSeen.to.id,
                        compare: changedSinceSeen.from.id,
                      })
                    }
                  />
                )}
                {!focusScreen && <InlineTitle />}
                {!focusScreen && (
                  <ItemWorkflow
                    onStartRefinement={
                      canChange
                        ? () => update({ refinementState: "refinement" })
                        : undefined
                    }
                    onReview={() => openRailAt("[data-review-panel]")}
                    onOpen={(place) =>
                      place === "discussions"
                        ? discussions.setPanelOpen(true)
                        : openRailAt(`[data-rail-section="${place}"]`)
                    }
                    onChanges={() => setMode({ kind: "branches" })}
                    onCompare={(from, to) =>
                      showHistory({ revision: to, compare: from })
                    }
                    onBreakdown={() =>
                      document
                        .querySelector("[data-item-breakdown]")
                        ?.scrollIntoView({ block: "start" })
                    }
                  >
                    {scopeInDocument && (
                      <DeliveryScope
                        embedded
                        onCompare={(from, to) =>
                          showHistory({ revision: to, compare: from })
                        }
                      />
                    )}
                  </ItemWorkflow>
                )}
                {!focusScreen && !pendingCreate && (
                  <ItemStatusStrip
                    onOpen={(section) =>
                      openRailAt(railSectionSelector[section])
                    }
                    className={cn(
                      "mt-3",
                      !railHidden && "@min-[53rem]/frame:hidden",
                    )}
                  />
                )}
                {!focusScreen && (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 @min-[53rem]/frame:hidden">
                      {/* Once a revision is accepted the workflow card shows the
                        delivery status; the panel still changes it. */}
                      {native && item.committedRevisionNumber == null && (
                        <IssueStatus
                          projectId={item.projectId}
                          statusId={item.statusId}
                          onChange={
                            canChange
                              ? (statusId) => update({ statusId })
                              : undefined
                          }
                          hint={startHint}
                        />
                      )}
                      <IssuePriority
                        priority={item.priority}
                        onChange={
                          canChange
                            ? (priority) => update({ priority })
                            : undefined
                        }
                      />
                      {native && (
                        // Shares the row with priority instead of taking a line.
                        <div className="min-w-40 flex-1">
                          <OwnerField
                            itemId={item.id}
                            assigneeId={item.assigneeId}
                            onChange={
                              canChange
                                ? (assigneeId) => update({ assigneeId })
                                : undefined
                            }
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
                <div className="mt-6">
                  {mode.kind === "history" ? (
                    <div className="space-y-6">
                      {/* Named like the item's other screens (branches, a
                          pull request); the tabs below say it visibly. */}
                      <ItemScreenTitle className="sr-only">
                        Version history of {identifier(project, item.number)}
                      </ItemScreenTitle>
                      <HistoryNav
                        current="versions"
                        onVersions={() =>
                          showHistory({ revision: null, compare: null })
                        }
                        onBranches={() => setMode({ kind: "branches" })}
                      />
                      <SpecVersions screen={mode} onChange={setMode} />
                    </div>
                  ) : mode.kind === "ai" ? (
                    <AiReviewView
                      runId={mode.id}
                      onClose={() => setMode({ kind: "read" })}
                      onOpenRun={(id) => setMode({ kind: "ai", id })}
                    />
                  ) : mode.kind === "branch" ||
                    mode.kind === "pr" ||
                    mode.kind === "branches" ? (
                    <BranchWorkspace
                      screen={mode}
                      onNavigate={setMode}
                      onMain={() => setMode({ kind: "read" })}
                      nav={
                        ctx.reviewable ? (
                          <HistoryNav
                            current="branches"
                            onVersions={() =>
                              showHistory({ revision: null, compare: null })
                            }
                            onBranches={() => setMode({ kind: "branches" })}
                          />
                        ) : undefined
                      }
                    />
                  ) : (
                    <SuggestingSpecification
                      mode={mode.kind}
                      setMode={(kind) => setMode({ kind })}
                      onQuote={discussions.startDiscussion}
                      onNavigate={setMode}
                    />
                  )}
                </div>
                {!focusScreen && ctx.reviewable && (
                  <BranchEntry onNavigate={setMode} />
                )}
                {!focusScreen && (
                  <DecisionComposerScope>
                    {/* Plain work talks right under its description, before
                      the item's links; specifications discuss in the panel
                      beside the text. */}
                    {!ctx.reviewable && (
                      <section
                        id="item-comments"
                        aria-label="Discussions"
                        className="mt-10 scroll-mt-4"
                      >
                        <Discussions draft={draft} onDraftChange={setDraft} />
                      </section>
                    )}
                    <section
                      data-item-breakdown
                      aria-label="Breakdown"
                      className="mt-10 scroll-mt-4"
                    >
                      <Breakdown onNavigate={setMode} />
                    </section>
                    {/* Reading context for the specification, beside the
                      item's other links (Relations). */}
                    {!pendingCreate && (
                      <div className="mt-10">
                        <ItemKnowledge
                          item={item}
                          project={project}
                          canChange={canChange}
                        />
                      </div>
                    )}
                    <section className="mt-10">
                      <Relations item={item} canChange={canChange} />
                    </section>
                    {/* Where it was promoted from (Lictory Channels). */}
                    {!pendingCreate && (
                      <ItemConversations workItemId={item.id} />
                    )}
                    <>
                      {ctx.reviewable &&
                        discussionsShown &&
                        discussions.panelOpen &&
                        (wide ? (
                          discussionsSlot &&
                          createPortal(
                            <SpecDiscussionPanel
                              onClose={() => discussions.setPanelOpen(false)}
                            />,
                            discussionsSlot,
                          )
                        ) : (
                          <DiscussionSheet
                            label="Discussions"
                            onClose={() => discussions.setPanelOpen(false)}
                          >
                            <div id="item-discussions" data-discussions>
                              <SpecDiscussionPanel
                                onClose={() => discussions.setPanelOpen(false)}
                                onLeave={() => discussions.setPanelOpen(false)}
                              />
                            </div>
                          </DiscussionSheet>
                        ))}
                      <section className="mt-10">
                        <Decisions />
                      </section>
                    </>
                  </DecisionComposerScope>
                )}
                {/* The item's files belong beside its specification, not
                    under a proposed change or its review. */}
                {!pendingCreate && !focusScreen && (
                  <Attachments
                    context={{
                      organizationId: item.organizationId,
                      workItemId: item.id,
                    }}
                    userId={workspace.userId}
                  />
                )}
                {/* Room for the Intelligence dock at the bottom. */}
                <section className="mt-10 mb-24">
                  <Activity />
                </section>
              </div>
            </div>
            {discussionsColumn && (
              <>
                <PaneResizer
                  resize={{ ...discussionsPane.handle, id: "item-discussions" }}
                />
                <aside
                  ref={discussionsRef}
                  id="item-discussions"
                  data-discussions
                  aria-label="Discussions"
                  // While dragging, the resizer writes --pane-w itself; this
                  // value is where the drag starts and what it settles to.
                  style={
                    discussionsPane.pane.sized
                      ? ({
                          "--pane-w": `${shownDiscussionsWidth}px`,
                        } as CSSProperties)
                      : { width: discussionsWidth }
                  }
                  className={cn(
                    "flex shrink-0 flex-col overflow-y-auto overscroll-contain border-l px-4 pb-6",
                    discussionsPane.pane.sized && "w-(--pane-w)",
                  )}
                />
              </>
            )}
            {!branchScreen && !railHidden && (
              <>
                <PaneResizer
                  resize={rail.handle}
                  className="hidden @min-[53rem]/frame:block"
                />
                <aside
                  id={rail.pane.id}
                  ref={attachMeasuredRail}
                  aria-label="Details"
                  style={rail.pane.style}
                  data-desktop-item-panel
                  className={cn(
                    "hidden shrink-0 overflow-y-auto border-l bg-shell/60 @min-[53rem]/frame:block",
                    rail.pane.sized
                      ? "w-(--pane-w)"
                      : "w-72 @min-[100rem]/frame:w-80",
                  )}
                >
                  {panel}
                </aside>
              </>
            )}
            {/* Review & details as a sheet where the rail has no room:
                Escape and a press outside close it, focus stays inside,
                and its header stays put while the body scrolls to the
                section asked for. */}
            <Drawer
              open={panelOpen}
              onOpenChange={setPanelOpen}
              side="right"
              container={popupContainer()}
            >
              <DrawerBackdrop
                className={cn(
                  "fixed inset-0 z-40",
                  scrimClass,
                  !railHidden && "@min-[53rem]/frame:hidden",
                )}
              />
              <DrawerContent
                data-item-panel-drawer
                className="z-50 flex h-dvh max-h-none w-[min(360px,90vw)] flex-col gap-0 overflow-hidden border-0 border-l bg-background p-0 text-foreground shadow-xl"
              >
                <div className="flex h-12 shrink-0 items-center justify-between border-b pr-2 pl-4">
                  <DrawerTitle className="m-0 text-sm font-medium">
                    Review & details
                  </DrawerTitle>
                  <DrawerClose
                    aria-label="Close details"
                    className="grid size-8 place-items-center rounded-md bg-transparent text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" aria-hidden />
                  </DrawerClose>
                </div>
                <div
                  data-item-panel-scroll
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                >
                  {panel}
                </div>
              </DrawerContent>
            </Drawer>
          </div>
        </div>
        {exporting && (
          <ExportDialog item={item} onClose={() => setExporting(false)} />
        )}
        {startingAgent && (
          <StartSessionDialog
            workItemId={item.id}
            onClose={() => setStartingAgent(false)}
          />
        )}
      </SpecDiscussionsContext.Provider>
    </ItemContext.Provider>
  );
}

// The discussions column, the document's readable minimum beside it and
// the room from which discussions open by default.
const DISCUSSIONS_WIDTH = 304;
// Up to this much wider when the text keeps COMFORTABLE beside it (a
// comfortable reading measure plus its gutters: the specification is the
// primary surface, so the column widens only from room the text spares).
const DISCUSSIONS_EXTRA = 88;
const COMFORTABLE = 680;
const READABLE = 420;
// The narrowest text discussions still sit beside; below it they are a sheet.
const DOCKED_READABLE = 360;
const ROOMY = 640;

// Discussions beside the specification: 304px to 392px by the room the
// text leaves (see discussionsWidth), or the width someone dragged it to;
// the text keeps its readable minimum.
const discussionsPaneSpec: PaneSpec = {
  pane: "discussions",
  label: "discussions",
  edge: "start",
  min: DISCUSSIONS_WIDTH,
  max: 640,
  share: { fraction: 0.45, floor: DISCUSSIONS_WIDTH, of: "frame" },
  preferred: () => DISCUSSIONS_WIDTH + DISCUSSIONS_EXTRA,
  neighbour: () => document.querySelector("[data-pane-document]"),
  keep: READABLE,
};

// Review & details beside the document: 18rem, 20rem on large frames.
const railPane: PaneSpec = {
  pane: "review-rail",
  label: "review and details",
  edge: "start",
  min: 256,
  max: 560,
  share: { fraction: 0.28, floor: 288, of: "frame" },
  preferred: ({ frame }) => (frame >= 1600 ? 320 : 288),
  neighbour: () => document.querySelector("[data-pane-document]"),
  keep: 440,
};

// Children of the item; proposing a breakdown opens the breakdown editor on a
// branch (inside the item context the proposal needs).
function Breakdown({
  onNavigate,
}: {
  onNavigate: (screen: BranchScreen) => void;
}) {
  const propose = useProposeBreakdown(onNavigate);
  return <EpicStories onPropose={() => void propose()} />;
}

// "Changed since you last looked", unless the status card already tells a
// requested reviewer what changed since their outdated approval.
function ChangedSince({
  changed,
  onShow,
}: {
  changed: {
    from: { number: number };
    to: { number: number };
    added: number;
    removed: number;
  };
  onShow: () => void;
}) {
  const mine = useMyReview();
  if (mine.review && mine.staleRevision) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[13px]">
      <GitCompareArrows className="size-4 text-primary" />
      <span>
        Changed since you last looked: revision {changed.from.number} →{" "}
        {changed.to.number}
        {" · "}
        <span className="text-success">+{changed.added}</span>{" "}
        <span className="text-destructive">−{changed.removed}</span> lines
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="ml-auto"
        onClick={onShow}
      >
        View changes
      </Button>
    </div>
  );
}

// The specification, with "Suggest a change" on selected text: a plain
// passage is rewritten beside the text, accepted there or, once the
// specification is ready, sent for review; a passage with formatting opens
// the editor on a branch (it needs the item context the branch commands
// run in).
function SuggestingSpecification({
  onNavigate,
  ...props
}: Omit<Parameters<typeof Specification>[0], "onSuggest"> & {
  onNavigate: (screen: BranchScreen) => void;
}) {
  const { current } = useItem();
  const discussions = useSpecDiscussions();
  const suggest = useSuggestChange(onNavigate);
  const inEditor = (quote: string) => void suggest(quote);
  useEffect(() => {
    if (!discussions) return;
    const ref = discussions.editSuggestion;
    ref.current = inEditor;
    return () => {
      ref.current = null;
    };
  });
  return (
    <Specification
      {...props}
      onSuggest={(draft) => {
        const inline =
          discussions &&
          current &&
          replaceQuote(current.content, draft, draft.quote) !== null;
        if (inline) discussions.startSuggestion(draft);
        else inEditor(draft.quote);
      }}
    />
  );
}

function Property({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center gap-2 text-[13px]">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
