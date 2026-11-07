import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, FileText, Scale } from "lucide-react";
import type { ReferenceTarget } from "@lictory/core/contracts/references";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  absoluteTime,
  refinementMeta,
  relativeTime,
} from "@lictory/core/lib/work-items";
import { cn } from "@lictory/core/lib/utils";
import { Link } from "@lictory/platform/lib/navigation";
import {
  RefinementIcon,
  StatusIcon,
} from "@lictory/platform/components/items/status";
import { SpaceIcon } from "@lictory/platform/components/spaces/space-meta";
import { usePageHistory } from "@lictory/platform/components/spaces/store";
import { versionOf } from "@lictory/platform/components/spaces/editor/line";
import {
  useLocalDecision,
  useReferences,
  type DecisionReference,
  type ItemReference,
  type PageReference,
} from "@lictory/platform/components/references/data";
import {
  HoverCard,
  type HoverCardAnchor,
} from "@lictory/platform/components/references/hover-card";

// Live references to work items, pages and decisions, the same in page
// content, the specification reader, discussions and every editor. A chip
// shows its target as I can read it now; a target I cannot read shows only
// the label stored in the content (a page without one: "Unavailable page"),
// and no card.
//
// `mode`: "link" chips navigate (readers); "static" chips sit inside an
// editor, where a click selects the reference, and their card's "Open"
// opens the target in a new tab so unsaved text stays.

export type ChipMode = "link" | "static";

// The label stored in the content, or what stands in for an empty one.
const stored = (label: string | null, fallback: string) =>
  label?.trim() ? label.trim() : fallback;

type ChipProps = {
  label: string | null;
  mode?: ChipMode;
  // An editor's selection rests on the reference: show its card.
  selected?: boolean;
};

const chip =
  "relative -top-px -my-0.5 inline-flex h-[1.375rem] max-w-full items-center gap-1.5 rounded-md bg-muted/80 pr-1.5 pl-[0.3125rem] align-middle text-[0.875em] leading-none font-medium text-foreground no-underline shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 hover:bg-accent motion-safe:transition-[background-color] motion-safe:duration-150";
const plainChip =
  "font-mono text-[0.85em] text-muted-foreground [overflow-wrap:anywhere]";
const titleClass = "min-w-0 max-w-[28ch] truncate";
const keyClass =
  "shrink-0 font-mono text-xs font-normal text-muted-foreground tabular-nums";

function Anchor({
  mode,
  href,
  anchor,
  spoken,
  children,
  data,
}: {
  mode: ChipMode;
  href: string | undefined;
  anchor: HoverCardAnchor;
  // Read after the visible text (status, version), never instead of it.
  spoken: string;
  children: ReactNode;
  data: Record<string, string>;
}) {
  const { ref, onClick, ...handlers } = anchor;
  if (mode === "link" && href)
    return (
      <Link
        ref={ref}
        href={href}
        className={chip}
        {...handlers}
        {...data}
      >
        {children}
        {spoken && <span className="sr-only">{spoken}</span>}
      </Link>
    );
  if (mode === "link")
    // A reader's reference without an address of its own (a decision
    // recorded elsewhere): a button that shows its card.
    return (
      <button
        ref={ref}
        type="button"
        className={cn(chip, "cursor-default")}
        onClick={onClick}
        {...handlers}
        {...data}
      >
        {children}
        {spoken && <span className="sr-only">{spoken}</span>}
      </button>
    );
  return (
    <span
      ref={ref}
      // Inside an editor the reference is part of the text: the card is
      // reached by pointing at it or moving the selection onto it.
      className={chip}
      onPointerEnter={handlers.onPointerEnter}
      onPointerLeave={handlers.onPointerLeave}
      aria-describedby={handlers["aria-describedby"]}
      {...data}
    >
      {children}
      {spoken && <span className="sr-only">{spoken}</span>}
    </span>
  );
}

function Plain({ children, kind }: { children: ReactNode; kind: string }) {
  return (
    <span className={plainChip} data-reference={kind} data-resolved="false">
      {children}
    </span>
  );
}

function CardLink({
  href,
  mode,
  children,
}: {
  href: string;
  mode: ChipMode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      // The reference itself is the keyboard path (see hover-card.tsx).
      tabIndex={-1}
      target={mode === "static" ? "_blank" : undefined}
      rel={mode === "static" ? "noopener" : undefined}
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
    >
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5">{children}</dd>
    </>
  );
}

// ------------------------------------------------------------------ items

export function ItemChip({
  id,
  label,
  mode = "link",
  selected,
}: ChipProps & { id: string }) {
  const item = useReferences().item(id);
  if (!item) return <Plain kind="item">{stored(label, "Work item")}</Plain>;
  // The name starts with what is shown (WCAG 2.5.3) and ends with the
  // status the icon draws.
  const spoken = `, ${item.status.label}`;
  return (
    <HoverCard
      forceOpen={selected}
      content={() => <ItemCard item={item} mode={mode} />}
    >
      {(anchor) => (
        <Anchor
          mode={mode}
          href={item.href}
          anchor={anchor}
          spoken={spoken}
          data={{ "data-reference": "item", "data-key": item.key }}
        >
          <StatusIcon
            category={item.status.category}
            color={item.status.color}
          />
          <span className={keyClass}>{item.key}</span>
          <span className={titleClass}>{item.title}</span>
        </Anchor>
      )}
    </HoverCard>
  );
}

function ItemCard({ item, mode }: { item: ItemReference; mode: ChipMode }) {
  return (
    <div className="space-y-2.5 p-3">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{item.key}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{item.typeName}</span>
          {item.archived && <span>· Archived</span>}
        </p>
        <p className="line-clamp-3 text-[14px] leading-snug font-semibold break-words">
          {item.title}
        </p>
      </div>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5">
        <Field label="Status">
          <StatusIcon
            category={item.status.category}
            color={item.status.color}
          />
          <span className="truncate">{item.status.label}</span>
        </Field>
        {item.refinement && (
          <Field label="Refinement">
            <RefinementIcon state={item.refinement} />
            <span className="truncate">
              {refinementMeta[item.refinement].label}
            </span>
          </Field>
        )}
        {item.readiness && (
          <Field label="Readiness">
            <span
              className={cn(
                "tabular-nums",
                item.readiness.passed === item.readiness.total
                  ? "text-success"
                  : item.readiness.blocked
                    ? "text-destructive"
                    : undefined,
              )}
            >
              {item.readiness.passed}/{item.readiness.total} checks
            </span>
          </Field>
        )}
        <Field label="Owner">
          <span
            className={cn("truncate", !item.owner && "text-muted-foreground")}
          >
            {item.owner ?? "Unassigned"}
          </span>
        </Field>
        {item.iteration && (
          <Field label="Iteration">
            <span className="truncate">{item.iteration}</span>
          </Field>
        )}
      </dl>
      {item.href && (
        <div className="flex justify-end">
          <CardLink href={item.href} mode={mode}>
            Open {item.key}
          </CardLink>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pages

export function PageChip({
  id,
  commitId,
  label,
  mode = "link",
  selected,
}: ChipProps & { id: string; commitId?: string | null }) {
  const page = useReferences().page(id);
  if (!page)
    return <Plain kind="page">{stored(label, "Unavailable page")}</Plain>;
  return commitId ? (
    <PinnedPageChip
      page={page}
      commitId={commitId}
      mode={mode}
      selected={selected}
    />
  ) : (
    <PageChipView page={page} mode={mode} selected={selected} version={null} />
  );
}

type Version = {
  pinned: number | undefined;
  latest: number | undefined;
  newer: boolean;
  commitId: string;
};

function PinnedPageChip({
  page,
  commitId,
  mode,
  selected,
}: {
  page: PageReference;
  commitId: string;
  mode: ChipMode;
  selected?: boolean;
}) {
  const history = usePageHistory(page.id);
  const version: Version = {
    pinned: versionOf(history.commits, commitId),
    latest: versionOf(
      history.commits,
      history.head?.id ?? page.publishedCommitId,
    ),
    newer: page.publishedCommitId !== commitId,
    commitId,
  };
  return (
    <PageChipView
      page={page}
      mode={mode}
      selected={selected}
      version={version}
    />
  );
}

function PageChipView({
  page,
  mode,
  selected,
  version,
}: {
  page: PageReference;
  mode: ChipMode;
  selected?: boolean;
  version: Version | null;
}) {
  const href = version
    ? `${page.href}?commit=${encodeURIComponent(version.commitId)}`
    : page.href;
  const spoken = [
    version
      ? version.pinned
        ? `version ${version.pinned}`
        : "pinned version"
      : null,
    version?.newer ? "a newer version is published" : null,
  ]
    .filter(Boolean)
    .map((part) => `, ${part}`)
    .join("");
  return (
    <HoverCard
      forceOpen={selected}
      content={() => (
        <PageCard page={page} mode={mode} version={version} href={href} />
      )}
    >
      {(anchor) => (
        <Anchor
          mode={mode}
          href={href}
          anchor={anchor}
          spoken={spoken}
          data={{
            "data-reference": "page",
            ...(version ? { "data-pinned": "true" } : {}),
          }}
        >
          <SpaceIcon space={page.space} className="size-3.5 text-[12px]" />
          <span className={titleClass}>{page.title}</span>
          {version && (
            <span className={keyClass}>
              {version.pinned ? `v${version.pinned}` : "pinned"}
            </span>
          )}
          {version?.newer && (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-warning"
            />
          )}
        </Anchor>
      )}
    </HoverCard>
  );
}

function PageCard({
  page,
  mode,
  version,
  href,
}: {
  page: PageReference;
  mode: ChipMode;
  version: Version | null;
  href: string;
}) {
  return (
    <div className="space-y-2.5 p-3">
      <div className="space-y-1">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <SpaceIcon space={page.space} className="size-3.5 text-[12px]" />
          <span className="truncate">
            {[page.space.name, ...page.path].join(" / ")}
          </span>
        </p>
        <p className="flex items-center gap-1.5 text-[14px] leading-snug font-semibold">
          <FileText
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="line-clamp-2 break-words">{page.title}</span>
        </p>
      </div>
      {version ? (
        <div className="space-y-1 rounded-lg bg-muted/50 p-2 text-xs">
          <p>
            Cites{" "}
            <span className="font-medium">
              {version.pinned
                ? `version ${version.pinned}`
                : "an earlier version"}
            </span>
            .
          </p>
          {version.newer && (
            <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-warning"
                />
                {version.latest
                  ? `Version ${version.latest} is published.`
                  : "A newer version is published."}
              </span>
              <Link
                href={`${page.href}/history`}
                tabIndex={-1}
                target={mode === "static" ? "_blank" : undefined}
                className="font-medium text-foreground underline underline-offset-2"
              >
                Compare in history
              </Link>
            </p>
          )}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Last published{" "}
        <time
          dateTime={page.publishedAt}
          title={absoluteTime(page.publishedAt)}
        >
          {relativeTime(page.publishedAt)}
        </time>
        {page.publishedBy ? ` by ${page.publishedBy}` : ""}
        {page.archived ? " · Archived" : ""}
      </p>
      <div className="flex justify-end">
        <CardLink href={href} mode={mode}>
          {version ? "Open this version" : "Open page"}
        </CardLink>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- decisions

// Decisions outside the open item are looked up when a card opens, through
// the same search people use (it authorizes on the server); kept for the tab.
const fetched = new Map<string, Promise<DecisionReference | null>>();
function lookupDecision(organizationId: string, id: string, label: string) {
  const key = `${organizationId}:${id}`;
  let pending = fetched.get(key);
  if (!pending) {
    pending = callCapability<{
      results: {
        kind: string;
        id: string;
        title: string;
        key: string;
        href: string;
        revisionNumber?: number;
      }[];
    }>("searchProductKnowledge", {
      organizationId,
      query: label.slice(0, 200),
      limit: 20,
    })
      .then(({ results }) => {
        const found = results.find((r) => r.kind === "decision" && r.id === id);
        return found
          ? {
              id,
              title: found.title,
              itemKey: found.key,
              itemHref: found.href,
              revisionNumber: found.revisionNumber ?? null,
            }
          : null;
      })
      .catch(() => {
        fetched.delete(key);
        return null;
      });
    fetched.set(key, pending);
  }
  return pending;
}

export function DecisionChip({
  id,
  label,
  mode = "link",
  selected,
}: ChipProps & { id: string }) {
  const local = useLocalDecision(id);
  const { organizationId } = useReferences();
  const fallback = stored(label, "Decision");
  if (!organizationId) return <Plain kind="decision">{fallback}</Plain>;
  const title = local?.title ?? fallback;
  return (
    <HoverCard
      forceOpen={selected}
      content={() => (
        <DecisionCard
          id={id}
          label={fallback}
          local={local}
          organizationId={organizationId}
          mode={mode}
        />
      )}
    >
      {(anchor) => (
        <Anchor
          mode={mode}
          href={local?.itemHref ?? undefined}
          anchor={anchor}
          spoken=""
          data={{ "data-reference": "decision" }}
        >
          <Scale
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="sr-only">Decision: </span>
          <span className={titleClass}>{title}</span>
        </Anchor>
      )}
    </HoverCard>
  );
}

function DecisionCard({
  id,
  label,
  local,
  organizationId,
  mode,
}: {
  id: string;
  label: string;
  local: DecisionReference | undefined;
  organizationId: string;
  mode: ChipMode;
}) {
  const [remote, setRemote] = useState<DecisionReference | null | undefined>(
    local ? null : undefined,
  );
  useEffect(() => {
    if (local) return;
    let live = true;
    void lookupDecision(organizationId, id, label).then((found) => {
      if (live) setRemote(found);
    });
    return () => {
      live = false;
    };
  }, [local, organizationId, id, label]);
  const decision = local ?? remote ?? null;
  return (
    <div className="space-y-2 p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Scale className="size-3.5" aria-hidden /> Recorded decision
      </p>
      <p className="line-clamp-3 text-[14px] leading-snug font-semibold break-words">
        {decision?.title ?? label}
      </p>
      {decision ? (
        <p className="text-xs text-muted-foreground">
          {decision.itemKey ? `On ${decision.itemKey}` : "On a work item"}
          {decision.revisionNumber != null
            ? ` · recorded at revision ${decision.revisionNumber}`
            : ""}
        </p>
      ) : remote === undefined ? (
        <p className="text-xs text-muted-foreground" aria-busy="true">
          Looking up the decision…
        </p>
      ) : null}
      {decision?.itemHref && (
        <div className="flex justify-end">
          <CardLink href={decision.itemHref} mode={mode}>
            Open {decision.itemKey ?? "work item"}
          </CardLink>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- generic

/** A chip for any reference target. */
export function ReferenceChip({
  target,
  label,
  mode,
  selected,
}: ChipProps & { target: ReferenceTarget }) {
  if (target.kind === "item")
    return (
      <ItemChip id={target.id} label={label} mode={mode} selected={selected} />
    );
  if (target.kind === "page")
    return (
      <PageChip
        id={target.id}
        commitId={target.commitId}
        label={label}
        mode={mode}
        selected={selected}
      />
    );
  return (
    <DecisionChip
      id={target.id}
      label={label}
      mode={mode}
      selected={selected}
    />
  );
}
