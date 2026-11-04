import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ExportSummaryView } from "@lictory/core/export/types";
import { callCapability } from "@lictory/core/capabilities/client";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Link } from "@lictory/platform/lib/navigation";
import { useOrganizationDeletionGraceDays } from "@lictory/platform/lib/session";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  ReadOnlyNotice,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

export const isOwner = (role: string) => role.split(",").includes("owner");

type Listing = { exports: ExportSummaryView[]; retentionDays: number };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

// What deletion removes, said the same way wherever it is offered.
export function deletionConsequences(graceDays: number) {
  return `Scheduling the deletion locks the organization at once: nobody can open its projects or change anything in it. After ${graceDays} days its projects, work items, specifications and their revisions, reviews, approvals, discussions, decisions, attachments, Jira connections with their credentials, and its audit log are permanently deleted. Until then an owner can cancel. Members are told by email. Accounts are not deleted: people keep their accounts and their other organizations.`;
}

// Organization settings → Delete organization. Owners only; the server
// checks again. Offers the data export first, then asks for the handle.
export function OrganizationDeletion() {
  const { organization } = useWorkspace();
  const graceDays = useOrganizationDeletionGraceDays();
  const owner = isOwner(organization.role);
  const [latest, setLatest] = useState<ExportSummaryView | null>();
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!owner) return;
    let current = true;
    callCapability<Listing>("listOrganizationExports", {
      organizationId: organization.id,
    })
      .then(
        (listing) =>
          current &&
          setLatest(
            listing.exports.find((e) =>
              ["queued", "running", "ready"].includes(e.status),
            ) ?? null,
          ),
      )
      .catch(() => current && setLatest(null));
    return () => {
      current = false;
    };
  }, [owner, organization.id]);

  if (!owner)
    return (
      <ReadOnlyNotice>
        Only an owner of the organization can delete it.
      </ReadOnlyNotice>
    );

  const confirmed =
    confirmation.trim().toLowerCase() === organization.slug.toLowerCase();

  const schedule = async () => {
    setPending(true);
    setError("");
    try {
      await callCapability("scheduleOrganizationDeletion", {
        organizationId: organization.id,
        confirmation,
      });
      // The organization's profile now carries the deletion; the layout
      // switches to the locked page as soon as it arrives.
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The deletion was not scheduled.",
      );
      setPending(false);
    }
  };

  const exportsHref = paths.settings(organization.slug, "export");
  return (
    <SettingsSection
      id="delete-organization"
      icon={<Trash2 className="text-destructive" />}
      title="Delete organization"
      description={deletionConsequences(graceDays)}
      className="ring-1 ring-destructive/30"
    >
      <SettingsBody className="space-y-4">
        <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-[13px]">
          <p className="font-medium">Export the data first</p>
          <p className="mt-0.5 text-muted-foreground">
            {latest === undefined
              ? "Checking for an export…"
              : latest === null
                ? "There is no recent export. An export is a complete copy of the organization you can keep or import elsewhere."
                : latest.status === "ready"
                  ? `An export from ${day(latest.createdAt)} is ready to download${latest.expiresAt ? ` until ${day(latest.expiresAt)}` : ""}.`
                  : "An export is being prepared."}{" "}
            Owners can still download exports while the organization is locked.{" "}
            <Link
              href={exportsHref}
              className="font-medium text-primary hover:underline"
            >
              Go to Data export
            </Link>
          </p>
        </div>
        <form
          className="max-w-sm space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmed) void schedule();
          }}
        >
          <label
            htmlFor="delete-organization-confirmation"
            className="block text-[13px] font-medium"
          >
            Type <span className="font-mono">{organization.slug}</span> to
            confirm
            <Input
              id="delete-organization-confirmation"
              autoComplete="off"
              spellCheck={false}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className="mt-1.5 h-8 rounded-md text-sm"
            />
          </label>
          <InlineError>{error || undefined}</InlineError>
          <Button
            type="submit"
            variant="danger"
            disabled={!confirmed || pending}
          >
            {pending ? "Scheduling…" : "Schedule deletion"}
          </Button>
        </form>
      </SettingsBody>
    </SettingsSection>
  );
}

// Shown instead of the workspace while the organization is scheduled for
// deletion. Owners can export its data and cancel; everyone else is told
// who to ask.
export function DeletionScheduledNotice({
  organization,
  exports,
}: {
  organization: {
    id: string;
    name: string;
    role: string;
    deletion: { deleteAfter: string; requestedBy: string | null };
  };
  exports: React.ReactNode;
}) {
  const owner = isOwner(organization.role);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const cancel = async () => {
    setPending(true);
    setError("");
    try {
      await callCapability("cancelOrganizationDeletion", {
        organizationId: organization.id,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The deletion was not cancelled.",
      );
      setPending(false);
    }
  };
  const when = day(organization.deletion.deleteAfter);
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10">
      <section
        aria-labelledby="deletion-scheduled-title"
        className="rounded-xl bg-card px-5 py-4 shadow-(--shadow-border) ring-1 ring-destructive/30"
      >
        <h1
          id="deletion-scheduled-title"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <Trash2 className="size-4 text-destructive" aria-hidden />
          {organization.name} is scheduled for deletion on {when}
        </h1>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
          {organization.deletion.requestedBy
            ? `${organization.deletion.requestedBy} scheduled it. `
            : ""}
          The organization is locked until then: nobody can open its projects or
          change anything in it. On {when} its projects, work items,
          specifications, reviews, discussions, attachments and Jira connections
          are permanently deleted. Accounts are not deleted.
        </p>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
          {owner
            ? "As an owner you can still export its data below, or cancel the deletion to open the organization again."
            : "If this is a mistake, ask an owner to cancel the deletion."}
        </p>
        {owner && (
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => void cancel()}
            >
              {pending ? "Cancelling…" : "Cancel deletion"}
            </Button>
            <InlineError>{error || undefined}</InlineError>
          </div>
        )}
      </section>
      {owner && exports}
    </div>
  );
}
