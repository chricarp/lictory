import { useEffect, useId, useState } from "react";
import { ArrowUpRight, Loader2, Lock, Hash, RotateCw } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { Tooltip } from "@lictory/ui/tooltip";
import { toast } from "@lictory/ui/toast";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Dialog, Field } from "@lictory/platform/components/spaces/dialog";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useChannelLink } from "@lictory/platform/components/channels/store";
import { SlackMark } from "@lictory/platform/components/identity/slack-mark";
import { StatusChip } from "@lictory/ui/status-chip";
import type { Channel } from "@lictory/platform/components/channels/data";

// Lictory Channels ↔ Slack in the browser (docs/internals/channels.md#slack):
// the mark on messages written in Slack, the "Synced with #x in Slack"
// status in the channel header, the link dialog and the retry line on
// messages that could not reach Slack. Ownership is the server's: these
// only show it.

// The Slack mark is identity's (people from Slack wear it too).
export { SlackMark };

/** "Slack" beside the author of a message written there. */
export function FromSlack() {
  return (
    <Tooltip label="Written in Slack: it can only be edited or deleted there.">
      <span className="inline-flex">
        <StatusChip tone="neutral" icon={<SlackMark />}>
          Slack
        </StatusChip>
      </span>
    </Tooltip>
  );
}

/** Header status of a linked channel: where it syncs and whether it works. */
export function SlackSyncStatus({ channel }: { channel: Channel }) {
  const link = useChannelLink(channel.id, channel.externalSource === "slack");
  if (!link) return null;
  const failing = link.health === "failing";
  const label = `Synced with #${link.externalName} in Slack`;
  // A chip in the header: the Slack channel it syncs with, or that the
  // sync fails (a person must act).
  const content = (
    <StatusChip
      tone={failing ? "danger" : "neutral"}
      icon={<SlackMark />}
      className="max-w-48"
    >
      <span className="max-sm:sr-only">
        {failing ? "Slack sync failing" : `#${link.externalName}`}
      </span>
      {link.externalUrl && (
        <ArrowUpRight
          className="ml-0.5 inline size-3 max-sm:hidden"
          aria-hidden
        />
      )}
    </StatusChip>
  );
  const tooltip = failing
    ? `${label}. ${link.lastError ?? "Messages are not reaching Slack."}`
    : label;
  return (
    <Tooltip label={tooltip}>
      {link.externalUrl ? (
        <a
          href={link.externalUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={tooltip}
          data-testid="slack-sync-status"
          className="rounded-md focus-ring outline-none"
        >
          {content}
        </a>
      ) : (
        <span aria-label={tooltip} data-testid="slack-sync-status">
          {content}
        </span>
      )}
    </Tooltip>
  );
}

/** Under a Lictory message Slack never received. */
export function SlackSendFailure({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <p
      role="status"
      className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-destructive"
    >
      <SlackMark />
      Not sent to Slack: {error}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded px-1 font-medium underline-offset-2 focus-ring outline-none hover:underline"
        >
          <RotateCw className="size-3" aria-hidden /> Retry
        </button>
      )}
    </p>
  );
}

type SlackChannelOption = {
  id: string;
  name: string;
  isPrivate: boolean;
  linked: boolean;
};

const BACKFILL_CHOICES = [0, 25, 50, 100, 200];

/** Link a Lictory channel to a Slack channel the Lictory app is in. */
export function LinkSlackDialog({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}) {
  const { organization, isAdmin } = useWorkspace();
  const ids = { channel: useId(), backfill: useId() };
  const [options, setOptions] = useState<SlackChannelOption[]>();
  const [teamName, setTeamName] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [backfill, setBackfill] = useState(0);
  const [error, setError] = useState<string>();
  const [unavailable, setUnavailable] = useState<string>();
  const [busy, setBusy] = useState(false);
  const isPrivate = channel.kind === "private";
  useEffect(() => {
    let active = true;
    callCapability<{ teamName: string | null; channels: SlackChannelOption[] }>(
      "listSlackChannels",
      { organizationId: organization.id },
    )
      .then((result) => {
        if (!active) return;
        setTeamName(result.teamName);
        setOptions(result.channels);
      })
      .catch((e: unknown) => {
        if (active)
          setUnavailable(
            e instanceof Error
              ? e.message
              : "Slack channels could not be read.",
          );
      });
    return () => {
      active = false;
    };
  }, [organization.id]);
  // Same privacy on both sides, never already linked.
  const eligible = (options ?? []).filter(
    (o) => o.isPrivate === isPrivate && !o.linked,
  );
  const link = async () => {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    try {
      await callCapability("linkSlackChannel", {
        organizationId: organization.id,
        channelId: channel.id,
        slackChannelId: selected,
        backfill,
      });
      toast({
        title: "Channel linked to Slack",
        description:
          backfill > 0
            ? `Importing up to ${backfill} recent Slack messages.`
            : undefined,
        type: "success",
        duration: 5000,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not linked.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Link to a Slack channel"
      description={`Messages written in either place appear in both. Each message stays owned by the side it was written on: edits and deletions come only from there.${
        teamName ? ` Workspace: ${teamName}.` : ""
      }`}
      onClose={onClose}
      onSubmit={() => void link()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!selected || busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Link channel
          </Button>
        </>
      }
    >
      {unavailable ? (
        <div className="space-y-2 text-[13px]">
          <p role="alert" className="text-destructive">
            {unavailable}
          </p>
          {isAdmin && (
            <Link
              href={paths.settings(organization.slug, "integrations")}
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              Open Slack settings <ArrowUpRight className="size-3" />
            </Link>
          )}
        </div>
      ) : !options ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Reading Slack channels…
        </p>
      ) : (
        <div className="space-y-4">
          <Field
            label="Slack channel"
            htmlFor={ids.channel}
            hint={
              eligible.length
                ? `Only ${isPrivate ? "private" : "public"} Slack channels the Lictory app is in are listed, so linking never widens who can read the conversation.`
                : `No ${isPrivate ? "private" : "public"} Slack channel is available. Invite the app in Slack with /invite @Lictory, then open this again.`
            }
          >
            <DropdownSelect
              id={ids.channel}
              value={selected}
              onValueChange={setSelected}
              placeholder="Choose a channel"
              aria-label="Slack channel"
            >
              {eligible.map((o) => (
                <DropdownSelectOption key={o.id} value={o.id} label={o.name}>
                  <span className="flex items-center gap-1.5">
                    {o.isPrivate ? (
                      <Lock className="size-3.5" aria-hidden />
                    ) : (
                      <Hash className="size-3.5" aria-hidden />
                    )}
                    {o.name}
                  </span>
                </DropdownSelectOption>
              ))}
            </DropdownSelect>
          </Field>
          <Field
            label="Import recent Slack messages"
            htmlFor={ids.backfill}
            hint="Once, when linking. Lictory never copies a channel's whole history."
          >
            <DropdownSelect
              id={ids.backfill}
              value={backfill}
              onValueChange={(v) => setBackfill(Number(v))}
              aria-label="Import recent Slack messages"
            >
              {BACKFILL_CHOICES.map((n) => (
                <DropdownSelectOption
                  key={n}
                  value={n}
                  label={n ? `The last ${n} messages` : "None"}
                />
              ))}
            </DropdownSelect>
          </Field>
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
