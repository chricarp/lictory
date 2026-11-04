import { useCallback, useEffect, useState } from "react";
import { Download, PackageOpen } from "lucide-react";
import type { ExportSummaryView } from "@lictory/core/export/types";
import { callCapability } from "@lictory/core/capabilities/client";
import { Button } from "@lictory/ui/button";
import { Badge } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  ReadOnlyNotice,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

type Listing = { exports: ExportSummaryView[]; retentionDays: number };

const date = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function bytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(2)} GB`;
}

const statusLabel: Record<ExportSummaryView["status"], string> = {
  queued: "Queued",
  running: "Preparing",
  ready: "Ready",
  failed: "Failed",
  expired: "Expired",
};

// Organization data export for administrators: start an export, watch it
// finish in the background, download the archive while it is kept.
export function OrganizationExport() {
  const { isAdmin, organization } = useWorkspace();
  if (!isAdmin)
    return (
      <ReadOnlyNotice>
        Only organization administrators can export the organization&apos;s
        data.
      </ReadOnlyNotice>
    );
  return <Exports organizationId={organization.id} />;
}

// Also shown to owners on the page of an organization scheduled for
// deletion, outside the (locked) workspace.
export function Exports({ organizationId }: { organizationId: string }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      setListing(
        await callCapability<Listing>("listOrganizationExports", {
          organizationId,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load exports.");
    }
  }, [organizationId]);

  const active = listing?.exports.some(
    (e) => e.status === "queued" || e.status === "running",
  );
  useEffect(() => {
    let current = true;
    callCapability<Listing>("listOrganizationExports", {
      organizationId,
    })
      .then((result) => current && setListing(result))
      .catch(
        (e: unknown) =>
          current &&
          setError(e instanceof Error ? e.message : "Could not load exports."),
      );
    return () => {
      current = false;
    };
  }, [organizationId]);
  // While an export is being prepared, check back now and then.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [active, load]);

  const start = async () => {
    setPending(true);
    setError("");
    try {
      await callCapability("requestOrganizationExport", {
        organizationId,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export did not start.");
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsSection
      id="export"
      icon={<PackageOpen />}
      title="Data export"
      description="A complete copy of this organization: projects, work items, every specification revision, reviews and approvals with the revision they apply to, discussions, suggestions, decisions, relations, iterations, members and attachments. Prepared in the background; you can leave this page."
      action={
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || active}
          onClick={() => void start()}
        >
          {active ? "Export in progress" : "Export data"}
        </Button>
      }
      footer={`The archive is a .tar.gz of JSON Lines files (one per kind of record), a work item CSV and attachment files, described by its manifest.json. Archives can be downloaded for ${listing?.retentionDays ?? 7} days. Starting and downloading exports is recorded in the audit log.`}
    >
      {error && (
        <SettingsBody className="py-2">
          <InlineError>{error}</InlineError>
        </SettingsBody>
      )}
      {listing === null ? (
        !error && (
          <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">
            Loading…
          </p>
        )
      ) : (
        <SettingsList
          isEmpty={listing.exports.length === 0}
          empty="No exports yet."
        >
          {listing.exports.map((e) => (
            <div
              key={e.id}
              data-testid="organization-export"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{date(e.createdAt)}</span>
                  <Badge tone={e.status === "failed" ? "danger" : undefined}>
                    {statusLabel[e.status]}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  Requested by {e.requestedBy.name ?? "a former member"}
                  {e.size !== null && e.status === "ready"
                    ? ` · ${bytes(e.size)}`
                    : ""}
                  {e.expiresAt && e.status === "ready"
                    ? ` · Available until ${date(e.expiresAt)}`
                    : ""}
                  {e.error ? ` · ${e.error}` : ""}
                </p>
              </div>
              {e.status === "ready" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    window.location.assign(
                      `/api/organizations/${encodeURIComponent(organizationId)}/exports/${encodeURIComponent(e.id)}/archive`,
                    )
                  }
                >
                  <Download className="size-3.5" /> Download
                </Button>
              )}
            </div>
          ))}
        </SettingsList>
      )}
    </SettingsSection>
  );
}
