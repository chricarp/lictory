import { absoluteTime } from "@lictory/core/lib/work-items";
import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import { ChevronRight, Download, ScrollText } from "lucide-react";
import type { AuditCategory, AuditEntry } from "@lictory/core/contracts/audit";
import { callCapability } from "@lictory/core/capabilities/client";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Input } from "@lictory/ui/input";
import { Badge } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  ReadOnlyNotice,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

const categories: { value: AuditCategory | "all"; label: string }[] = [
  { value: "all", label: "All activity" },
  { value: "membership", label: "Members & roles" },
  // Who and what can act or read: tokens, agents, runners, private
  // channels, Slack and event webhooks.
  { value: "access", label: "Access" },
  { value: "organization", label: "Organization" },
  { value: "configuration", label: "Configuration" },
  // Agents' calls, Autopilot's merges and Definition of Done checks people
  // passed by hand: what acted in place of a person or of evidence.
  { value: "agent", label: "Agents, Autopilot & Done" },
];
const categoryLabel = Object.fromEntries(
  categories.map((c) => [c.value, c.label]),
) as Record<AuditCategory, string>;

type Filters = {
  category: AuditCategory | "all";
  actorId: string;
  from: string;
  to: string;
};
type Page = { entries: AuditEntry[]; nextCursor: string | null };

const time = absoluteTime;

function query(filters: Filters) {
  return {
    category: filters.category === "all" ? null : filters.category,
    actorId: filters.actorId === "anyone" ? null : filters.actorId,
    from: filters.from || null,
    to: filters.to || null,
  };
}

// The organization audit log for administrators: newest first, filtered on
// the server, paged, and exportable as CSV with the same filters.
// The date filters take the shape of the selects beside them (a 32px pill,
// 13px medium text, the surface's edge), not the browser's own field; an
// empty date reads as a placeholder. The calendar button is styled in
// @lictory/ui's styles.css.
const dateFilterClass =
  "mt-1.5 h-8 w-full rounded-full border-0 px-3 text-[13px] font-medium shadow-(--shadow-border) hover:bg-muted/60 data-empty:text-muted-foreground/70";

export function OrganizationAudit() {
  const { isAdmin } = useWorkspace();
  if (!isAdmin)
    return (
      <ReadOnlyNotice>
        Only organization administrators can view the audit log.
      </ReadOnlyNotice>
    );
  return <AuditLog />;
}

function AuditLog() {
  const { organization, directory } = useWorkspace();
  const [filters, setFilters] = useState<Filters>({
    category: "all",
    actorId: "anyone",
    from: "",
    to: "",
  });
  const [page, setPage] = useState<Page | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    callCapability<Page>("listAuditLog", {
      organizationId: organization.id,
      ...query(filters),
    })
      .then((result) => {
        if (!current) return;
        setPage(result);
        setError("");
      })
      .catch(
        (e: unknown) =>
          current &&
          setError(e instanceof Error ? e.message : "Could not load."),
      );
    return () => {
      current = false;
    };
  }, [organization.id, filters]);

  const loadMore = async () => {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    setError("");
    try {
      const next = await callCapability<Page>("listAuditLog", {
        organizationId: organization.id,
        ...query(filters),
        cursor: page.nextCursor,
      });
      setPage({
        entries: [...page.entries, ...next.entries],
        nextCursor: next.nextCursor,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load.");
    } finally {
      setLoadingMore(false);
    }
  };

  const exportUrl = () => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query(filters)))
      if (value) params.set(key, value);
    const search = params.toString();
    return `/api/organizations/${encodeURIComponent(organization.id)}/audit-log.csv${search ? `?${search}` : ""}`;
  };

  const set = (patch: Partial<Filters>) =>
    setFilters((f) => ({ ...f, ...patch }));
  const members = [...directory.members].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <SettingsSection
      id="audit"
      icon={<ScrollText />}
      title="Audit log"
      action={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => window.location.assign(exportUrl())}
        >
          <Download className="size-3.5" /> Export CSV
        </Button>
      }
    >
      {/* One row of four equal fields on wide screens, two by two on
          phones: no field wraps alone, and each label sits above its
          control with the same gap. */}
      <SettingsBody className="grid grid-cols-2 items-end gap-x-3 gap-y-4 py-3 md:grid-cols-4">
        <div className="min-w-0 text-[13px] font-medium">
          <span id="audit-category-label">Activity</span>
          <DropdownSelect
            aria-labelledby="audit-category-label"
            className="mt-1.5 w-full"
            value={filters.category}
            onValueChange={(v) => set({ category: v as Filters["category"] })}
          >
            {categories.map((c) => (
              <DropdownSelectOption key={c.value} value={c.value}>
                {c.label}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
        </div>
        <div className="min-w-0 text-[13px] font-medium">
          <span id="audit-actor-label">Person</span>
          <DropdownSelect
            aria-labelledby="audit-actor-label"
            className="mt-1.5 w-full"
            value={filters.actorId}
            onValueChange={(v) => set({ actorId: v })}
          >
            <DropdownSelectOption value="anyone">Anyone</DropdownSelectOption>
            {members.map((m) => (
              <DropdownSelectOption key={m.id} value={m.id}>
                {m.name}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
        </div>
        <label className="block min-w-0 text-[13px] font-medium">
          From (UTC)
          <Input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => set({ from: e.target.value })}
            data-empty={!filters.from || undefined}
            className={dateFilterClass}
          />
        </label>
        <label className="block min-w-0 text-[13px] font-medium">
          To (UTC)
          <Input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => set({ to: e.target.value })}
            data-empty={!filters.to || undefined}
            className={dateFilterClass}
          />
        </label>
      </SettingsBody>
      {error && (
        <SettingsBody className="py-2">
          <InlineError>{error}</InlineError>
        </SettingsBody>
      )}
      <div className="border-t border-border">
        {page === null ? (
          !error && (
            <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
              Loading…
            </p>
          )
        ) : (
          <SettingsList isEmpty={page.entries.length === 0} empty="No entries">
            {page.entries.map((entry) => (
              <AuditRow key={`${entry.source}:${entry.id}`} entry={entry} />
            ))}
          </SettingsList>
        )}
      </div>
      {page?.nextCursor && (
        <div className="border-t border-border px-5 py-3 text-center">
          <Button
            size="sm"
            variant="ghost"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Show older entries"}
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const hasDetail = Object.keys(entry.detail).length > 0;
  return (
    <div className="px-5 py-2.5 text-[13px]" data-testid="audit-entry">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-medium">{entry.actor?.name ?? "Lictory"}</span>
        <span className="min-w-0 flex-1">{entry.summary}</span>
        <time
          dateTime={entry.at}
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
        >
          {time(entry.at)}
        </time>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge>{categoryLabel[entry.category]}</Badge>
        {entry.actor?.email && <span>{entry.actor.email}</span>}
        {hasDetail && (
          <Collapsible className="w-full">
            <CollapsibleTrigger className="group inline-flex w-fit cursor-pointer items-center gap-1 select-none hover:text-foreground">
              <ChevronRight className="size-3 transition-transform duration-150 group-data-open:rotate-90" />
              Details
            </CollapsibleTrigger>
            <CollapsiblePanel className="text-[length:inherit] leading-[inherit] text-inherit">
              <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-foreground">
                {JSON.stringify(entry.detail, null, 2)}
              </pre>
            </CollapsiblePanel>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
