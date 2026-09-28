"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Link2,
  Loader2,
  Unlink,
  Upload,
  XCircle,
} from "lucide-react";
import type { EntityOf, WorkItem } from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Badge, SectionLabel } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import { cn } from "~/lib/utils";

// Export to Jira: a preview that says exactly what each item would do, an
// explicit per-item confirmation before overwriting changes made in Jira,
// and per-item results. All authority is on the server (/api/delivery).

type ExternalLink = EntityOf<"externalLink">;
type PlanEntry = {
  workItemId: string;
  key: string;
  title: string;
  typeName: string;
  depth: number;
  action:
    | "create"
    | "update"
    | "unchanged"
    | "not_ready"
    | "parent_excluded"
    | "no_target"
    | "unmapped";
  reason?: string;
  externalKey?: string;
  externalUrl?: string;
  conflict?: ("title" | "content" | "labels" | "linked")[];
};
type Plan = {
  connectionId: string | null;
  connectionName: string | null;
  entries: PlanEntry[];
};
type Outcome =
  | "pending"
  | "created"
  | "updated"
  | "unchanged"
  | "conflict"
  | "failed"
  | "skipped";
type Publication = {
  id: string;
  status: "running" | "completed" | "partial" | "failed";
  itemIds: string[];
  results: Record<
    string,
    { outcome: Outcome; message?: string; externalKey?: string }
  >;
};

export async function deliveryRequest<T>(
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/api/delivery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(json.error?.message ?? "The delivery action failed.");
  return json as T;
}

export function useExternalLinks(workItemId: string) {
  const { view } = useWorkspace();
  return useMemo(
    () =>
      Object.values(view.entities).filter(
        (e): e is ExternalLink =>
          e.type === "externalLink" && e.workItemId === workItemId,
      ),
    [view.entities, workItemId],
  );
}

// Whether exporting is possible at all for this item's team, and whether the
// team works in an external tool (then export is the primary action).
export function useExportAvailability(item: WorkItem) {
  const { directory, capabilities } = useWorkspace();
  const target =
    directory.delivery.targets.find((t) => t.teamId === item.teamId) ??
    directory.delivery.targets.find((t) => t.teamId === null);
  const connection = directory.delivery.connections.find(
    (c) => c.id === target?.connectionId,
  );
  const team = directory.teams.find((t) => t.id === item.teamId);
  return {
    configured: Boolean(target && connection),
    connection,
    target,
    allowed: capabilities.publishDelivery,
    external: team?.deliveryMode === "external",
  };
}

const fieldLabel = {
  title: "summary",
  content: "description",
  labels: "labels",
  linked: "linked, never exported",
} as const;

export function ExportDialog({
  item,
  onClose,
}: {
  item: WorkItem;
  onClose: () => void;
}) {
  const { organization } = useWorkspace();
  const [plan, setPlan] = useState<Plan>();
  const [error, setError] = useState<string>();
  const [overwrite, setOverwrite] = useState<Set<string>>(new Set());
  const [publication, setPublication] = useState<Publication>();
  const [busy, setBusy] = useState(false);
  // The preview reads Jira (external edits), so it is fetched on open.
  useEffect(() => {
    let live = true;
    deliveryRequest<Plan>({
      action: "preview",
      organizationId: organization.id,
      rootId: item.id,
    }).then(
      (p) => live && setPlan(p),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [organization.id, item.id]);
  const exportable =
    plan?.entries.filter((e) =>
      ["create", "update", "unchanged"].includes(e.action),
    ) ?? [];
  const blockedByConflict = exportable.filter(
    (e) => e.conflict?.length && !overwrite.has(e.workItemId),
  );
  const run = async (itemIds?: string[]) => {
    setBusy(true);
    setError(undefined);
    try {
      setPublication(
        await deliveryRequest<Publication>({
          action: "publish",
          organizationId: organization.id,
          ...(itemIds ? { itemIds } : { rootId: item.id }),
          overwriteItemIds: [...overwrite],
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const failed = publication
    ? publication.itemIds.filter((id) =>
        ["failed", "conflict"].includes(publication.results[id]?.outcome ?? ""),
      )
    : [];
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[10vh] pb-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button
        aria-label="Close"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal
        aria-label="Export to Jira"
        className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-popover shadow-(--shadow-panel)"
      >
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            {publication ? "Export results" : "Export to Jira"}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {publication
              ? summary(publication)
              : "Only ready items are exported. Summary, description (latest revision with acceptance criteria) and labels are written to Jira; status, assignee and sprint stay Jira’s."}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!plan && !error && (
            <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking what would
              change in Jira…
            </p>
          )}
          {plan && (
            <ul className="divide-y">
              {plan.entries.map((entry) => {
                const result = publication?.results[entry.workItemId];
                return (
                  <li
                    key={entry.workItemId}
                    className="flex items-start gap-2 px-4 py-2 text-[13px]"
                    style={{ paddingLeft: 16 + entry.depth * 18 }}
                  >
                    <span className="mt-0.5">
                      {result ? (
                        <OutcomeIcon outcome={result.outcome} />
                      ) : (
                        <ActionIcon entry={entry} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {entry.key}
                        </span>
                        <span className="truncate">{entry.title}</span>
                        <span className="ml-auto shrink-0">
                          {result ? (
                            <OutcomeBadge
                              outcome={result.outcome}
                              externalKey={result.externalKey}
                            />
                          ) : (
                            <ActionBadge entry={entry} />
                          )}
                        </span>
                      </div>
                      {(result?.message ?? (!result && entry.reason)) && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {result?.message ?? entry.reason}
                        </p>
                      )}
                      {(!publication && entry.conflict?.length) ||
                      result?.outcome === "conflict" ? (
                        <label className="mt-1 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                          <input
                            type="checkbox"
                            checked={overwrite.has(entry.workItemId)}
                            onChange={(e) =>
                              setOverwrite((current) => {
                                const next = new Set(current);
                                if (e.target.checked)
                                  next.add(entry.workItemId);
                                else next.delete(entry.workItemId);
                                return next;
                              })
                            }
                          />
                          {entry.conflict?.includes("linked")
                            ? `Overwrite ${entry.externalKey ?? "the linked issue"} with this specification`
                            : entry.conflict?.length
                              ? `Changed in Jira since the last export (${entry.conflict.map((c) => fieldLabel[c]).join(", ")}). Overwrite Jira’s changes`
                              : "Overwrite Jira’s changes"}
                          {entry.externalUrl && (
                            <a
                              href={entry.externalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
                            >
                              Review in Jira <ArrowUpRight className="size-3" />
                            </a>
                          )}
                        </label>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {error && (
            <p role="alert" className="px-4 py-4 text-[13px] text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t px-4 py-3">
          {plan?.connectionName && (
            <span className="text-xs text-muted-foreground">
              To {plan.connectionName}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              {publication ? "Done" : "Cancel"}
            </Button>
            {publication ? (
              failed.length > 0 && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(failed)}
                >
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  {failed.every((id) => overwrite.has(id)) &&
                  failed.some(
                    (id) => publication.results[id]?.outcome === "conflict",
                  )
                    ? "Overwrite and export"
                    : `Retry ${failed.length} ${failed.length === 1 ? "item" : "items"}`}
                </Button>
              )
            ) : (
              <Button
                disabled={busy || !plan || exportable.length === 0}
                title={
                  blockedByConflict.length
                    ? `${blockedByConflict.length} item(s) changed in Jira will be skipped unless you confirm overwriting.`
                    : undefined
                }
                onClick={() => void run()}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                {exportable.every((e) => e.action === "unchanged")
                  ? "Refresh Jira status"
                  : `Export ${exportable.length} ${exportable.length === 1 ? "item" : "items"}`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function summary(p: Publication) {
  const counts = new Map<Outcome, number>();
  for (const id of p.itemIds) {
    const o = p.results[id]?.outcome ?? "pending";
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  const parts = (
    [
      ["created", "created"],
      ["updated", "updated"],
      ["unchanged", "unchanged"],
      ["conflict", "need confirmation"],
      ["failed", "failed"],
      ["skipped", "skipped"],
      ["pending", "still in progress"],
    ] as const
  )
    .filter(([o]) => counts.get(o))
    .map(([o, label]) => `${counts.get(o)} ${label}`);
  return `${parts.join(", ")}.${p.status === "running" ? " Lictory will finish the remaining items shortly." : ""}`;
}

function ActionIcon({ entry }: { entry: PlanEntry }) {
  if (entry.conflict?.length)
    return <AlertTriangle className="size-4 text-warning" />;
  if (entry.action === "create" || entry.action === "update")
    return <Upload className="size-4 text-primary" />;
  if (entry.action === "unchanged")
    return <CheckCircle2 className="size-4 text-muted-foreground" />;
  return <CircleSlash className="size-4 text-muted-foreground" />;
}

function ActionBadge({ entry }: { entry: PlanEntry }) {
  switch (entry.action) {
    case "create":
      return <Badge tone="info">Create</Badge>;
    case "update":
      return (
        <Badge tone={entry.conflict?.length ? "warning" : "info"}>
          Update {entry.externalKey}
        </Badge>
      );
    case "unchanged":
      return <Badge>Up to date {entry.externalKey}</Badge>;
    case "not_ready":
      return <Badge tone="warning">Not ready</Badge>;
    default:
      return <Badge>Skipped</Badge>;
  }
}

function OutcomeIcon({ outcome }: { outcome: Outcome }) {
  if (outcome === "created" || outcome === "updated" || outcome === "unchanged")
    return <CheckCircle2 className="size-4 text-success" />;
  if (outcome === "conflict")
    return <AlertTriangle className="size-4 text-warning" />;
  if (outcome === "failed")
    return <XCircle className="size-4 text-destructive" />;
  if (outcome === "pending")
    return <CircleDashed className="size-4 text-muted-foreground" />;
  return <CircleSlash className="size-4 text-muted-foreground" />;
}

function OutcomeBadge({
  outcome,
  externalKey,
}: {
  outcome: Outcome;
  externalKey?: string;
}) {
  const label = {
    created: `Created ${externalKey ?? ""}`,
    updated: `Updated ${externalKey ?? ""}`,
    unchanged: `Up to date ${externalKey ?? ""}`,
    conflict: "Needs confirmation",
    failed: "Failed",
    skipped: "Skipped",
    pending: "In progress",
  }[outcome];
  const tone =
    outcome === "failed"
      ? "danger"
      : outcome === "conflict"
        ? "warning"
        : outcome === "skipped" || outcome === "pending"
          ? "neutral"
          : "good";
  return <Badge tone={tone}>{label.trim()}</Badge>;
}

// Sidebar section: where this item lives in Jira and how current it is.
export function ExternalDelivery({ item }: { item: WorkItem }) {
  const { organization } = useWorkspace();
  const links = useExternalLinks(item.id);
  const availability = useExportAvailability(item);
  const [exporting, setExporting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!availability.configured && links.length === 0) return null;
  const link =
    links.find((l) => l.connectionId === availability.connection?.id) ??
    links[0];
  const stale =
    link?.publishedRevisionNumber != null &&
    link.publishedRevisionNumber < item.revisionNumber;
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await deliveryRequest({ organizationId: organization.id, ...body });
      setLinking(false);
      setKey("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ready = item.refinementState === "ready";
  return (
    <section>
      <SectionLabel className="mb-2">Jira</SectionLabel>
      {link?.externalKey ? (
        <div className="space-y-1.5 rounded-lg border bg-card px-3 py-2 text-[13px]">
          <div className="flex items-center gap-2">
            <a
              href={link.externalUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
            >
              {link.externalKey} <ArrowUpRight className="size-3" />
            </a>
            {link.externalStatus && <Badge>{link.externalStatus}</Badge>}
            <span className="ml-auto">
              <LinkStatus link={link} stale={stale} />
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {link.publishedRevisionNumber != null
              ? `Exported revision ${link.publishedRevisionNumber} · current ${item.revisionNumber}`
              : "Linked, not exported yet"}
            {link.syncedAt &&
              ` · ${new Date(link.syncedAt).toLocaleDateString()}`}
          </p>
          {link.lastError && (
            <p className="text-xs text-destructive">{link.lastError}</p>
          )}
        </div>
      ) : link?.status === "pending" ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Exporting…
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {ready
            ? "Not exported yet."
            : "Exportable once the specification is ready."}
        </p>
      )}
      {availability.allowed && availability.configured && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={availability.external ? "primary" : "secondary"}
            disabled={!ready || link?.status === "pending"}
            title={ready ? undefined : "Only ready items can be exported."}
            onClick={() => setExporting(true)}
          >
            <Upload className="size-3.5" />
            {link?.externalKey ? "Export changes" : "Export to Jira"}
          </Button>
          {link?.externalKey ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title="Remove the link. The Jira issue is not changed."
              onClick={() =>
                void act({
                  action: "unlink",
                  workItemId: item.id,
                  connectionId: link.connectionId,
                })
              }
            >
              <Unlink className="size-3.5" /> Unlink
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLinking((v) => !v)}
            >
              <Link2 className="size-3.5" /> Link existing
            </Button>
          )}
        </div>
      )}
      {linking && (
        <form
          className="mt-2 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void act({
              action: "linkExisting",
              workItemId: item.id,
              externalKey: key,
            });
          }}
        >
          <input
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Jira key, e.g. PAY-12"
            aria-label="Jira issue key"
            className="h-7 min-w-0 flex-1 rounded-md border bg-card px-2 text-[13px] outline-none focus:border-primary/60"
          />
          <Button size="sm" type="submit" disabled={busy || !key.trim()}>
            Link
          </Button>
        </form>
      )}
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      {exporting && (
        <ExportDialog item={item} onClose={() => setExporting(false)} />
      )}
    </section>
  );
}

function LinkStatus({ link, stale }: { link: ExternalLink; stale: boolean }) {
  if (link.status === "pending") return <Badge>Exporting…</Badge>;
  if (link.status === "conflict")
    return <Badge tone="warning">Changed in Jira</Badge>;
  if (link.status === "failed") return <Badge tone="danger">Failed</Badge>;
  if (stale) return <Badge tone="warning">Out of date</Badge>;
  return (
    <Badge
      tone="good"
      className={cn(!link.publishedRevisionNumber && "hidden")}
    >
      Up to date
    </Badge>
  );
}
