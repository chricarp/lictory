import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Copy, Loader2, MessagesSquare } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Switch } from "@lictory/ui/switch";
import { Badge } from "@lictory/ui/primitives";
import { toast } from "@lictory/ui/toast";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useRouter, useSearchParams } from "@lictory/platform/lib/navigation";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

// Organization settings → Integrations → Slack. Each organization installs
// its own Slack app (an internal app of its workspace) created from the
// manifest below, saves the app's credentials once (stored encrypted, never
// shown again) and installs it through Slack's OAuth page. Linking channels
// happens in each channel's menu. See docs/operations/slack.md.

type Connection = {
  status: "none" | "pending" | "connected" | "invalid" | "disconnected";
  appId: string | null;
  teamName: string | null;
  teamUrl: string | null;
  installedAt: string | null;
  lastError: string | null;
  lastEventAt: string | null;
  linkedChannels: number;
  intelligenceReads: boolean;
};
type Reading = {
  connection: Connection;
  manifest: unknown;
  urls: { events: string; interactivity: string; redirect: string } | null;
};

const message = (e: unknown) =>
  e instanceof Error ? e.message : "The request failed. Try again.";

function Status({ connection }: { connection: Connection }) {
  switch (connection.status) {
    case "connected":
      return <Badge tone="good">Connected</Badge>;
    case "invalid":
      return <Badge tone="danger">Needs attention</Badge>;
    case "pending":
      return <Badge tone="info">Not installed yet</Badge>;
    default:
      return <Badge>Not connected</Badge>;
  }
}

export function SlackConnection() {
  const { organization, isAdmin } = useWorkspace();
  const search = useSearchParams();
  const router = useRouter();
  const [reading, setReading] = useState<Reading>();
  // Slack's OAuth redirect comes back here with the outcome.
  const outcome = search.get("slack");
  const [error, setError] = useState<string | undefined>(() =>
    outcome === "error"
      ? (search.get("message") ?? "Slack was not connected.")
      : undefined,
  );
  const [busy, setBusy] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(
    () =>
      callCapability<Reading>("getSlackConnection", {
        organizationId: organization.id,
      })
        .then(setReading)
        .catch((e: unknown) => setError(message(e))),
    [organization.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!outcome) return;
    if (outcome === "connected")
      toast({ title: "Slack connected", type: "success", duration: 5000 });
    const params = new URLSearchParams(search);
    params.delete("slack");
    params.delete("message");
    const query = params.toString();
    router.replace(`${location.pathname}${query ? `?${query}` : ""}`, {
      scroll: false,
    });
  }, [outcome, search, router]);

  const act = async (name: string, run: () => Promise<unknown>) => {
    setBusy(name);
    setError(undefined);
    try {
      await run();
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  };
  const install = () =>
    act("install", async () => {
      const { url } = await callCapability<{ url: string }>(
        "startSlackInstall",
        { organizationId: organization.id },
      );
      window.location.assign(url);
    });

  const connection = reading?.connection;
  const status = connection?.status ?? "none";
  const showSetup =
    isAdmin && (editing || status === "none" || status === "disconnected");
  return (
    <SettingsSection
      id="slack"
      icon={<MessagesSquare />}
      title="Slack"
      description="Link Lictory channels to Slack channels so both sides see one conversation. Each message stays owned by the side it was written on."
      footer="Lictory reads and writes messages and reactions only in Slack channels its app was invited to, maps people by their confirmed email, and never imports a channel's history unless someone linking it asks for a bounded number of recent messages."
    >
      <SettingsBody className="space-y-3 text-[13px]">
        {!connection ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Status connection={connection} />
            {connection.teamName && (
              <span>
                {connection.teamUrl ? (
                  <a
                    href={connection.teamUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                  >
                    {connection.teamName} <ArrowUpRight className="size-3" />
                  </a>
                ) : (
                  <span className="font-medium">{connection.teamName}</span>
                )}
              </span>
            )}
            {status === "connected" && (
              <span className="text-muted-foreground">
                {connection.linkedChannels}{" "}
                {connection.linkedChannels === 1
                  ? "linked channel"
                  : "linked channels"}
              </span>
            )}
            {isAdmin && status !== "none" && !showSetup && (
              <span className="ml-auto flex gap-1">
                {confirming ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirming(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy !== undefined}
                      onClick={() =>
                        void act("disconnect", async () => {
                          await callCapability("disconnectSlack", {
                            organizationId: organization.id,
                          });
                          setConfirming(false);
                        })
                      }
                    >
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant={status === "connected" ? "secondary" : "primary"}
                      disabled={busy !== undefined}
                      onClick={() => void install()}
                    >
                      {busy === "install" && (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}
                      {status === "connected"
                        ? "Reinstall"
                        : "Install in Slack"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(true)}
                    >
                      Replace app
                    </Button>
                    {status !== "disconnected" && status !== "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirming(true)}
                      >
                        Disconnect…
                      </Button>
                    )}
                  </>
                )}
              </span>
            )}
          </div>
        )}
        {confirming && (
          <p className="text-xs text-muted-foreground">
            Lictory&apos;s token is revoked and every channel is unlinked.
            Messages stay on both sides; installing again later needs no new
            app.
          </p>
        )}
        {connection?.lastError && (
          <p className="text-xs text-destructive">{connection.lastError}</p>
        )}
        {status === "connected" && isAdmin && connection && (
          <label className="flex items-start gap-3 rounded-lg bg-muted/40 px-3 py-2">
            <Switch
              checked={connection.intelligenceReads}
              disabled={busy !== undefined}
              onCheckedChange={(allowed) =>
                void act("intelligence", () =>
                  callCapability("setSlackIntelligenceReads", {
                    organizationId: organization.id,
                    allowed,
                  }),
                )
              }
              aria-label="Let Lictory Intelligence read Slack messages"
            />
            <span>
              <span className="block font-medium">
                Let Lictory Intelligence read Slack messages
              </span>
              <span className="text-xs text-muted-foreground">
                Off: messages written in Slack are withheld from Litto and other
                AI features, so Slack content never reaches the AI provider.
                Takes effect only while Lictory Intelligence is on.
              </span>
            </span>
          </label>
        )}
        {status === "connected" && (
          <p className="text-xs text-muted-foreground">
            Link a channel from its menu (⋯ → Link to Slack channel) after
            inviting the Lictory app to the Slack channel with /invite @Lictory.
          </p>
        )}
        <InlineError>{error}</InlineError>
      </SettingsBody>
      {showSetup && reading?.manifest !== null && reading && (
        <AppSetup
          reading={reading}
          busy={busy}
          onCancel={
            status === "none" || status === "disconnected"
              ? undefined
              : () => setEditing(false)
          }
          onSave={(fields) =>
            act("save", async () => {
              await callCapability("saveSlackApp", {
                organizationId: organization.id,
                ...fields,
              });
              setEditing(false);
            })
          }
        />
      )}
      {!isAdmin && status !== "connected" && (
        <SettingsBody className="text-xs text-muted-foreground">
          Organization administrators connect Slack.
        </SettingsBody>
      )}
    </SettingsSection>
  );
}

function AppSetup({
  reading,
  busy,
  onSave,
  onCancel,
}: {
  reading: Reading;
  busy: string | undefined;
  onSave: (fields: {
    appId: string;
    clientId: string;
    clientSecret: string;
    signingSecret: string;
  }) => void;
  onCancel?: () => void;
}) {
  const manifest = JSON.stringify(reading.manifest, null, 2);
  const [appId, setAppId] = useState(reading.connection.appId ?? "");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  return (
    <SettingsBody className="space-y-4 border-t bg-muted/40 text-[13px]">
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Open{" "}
          <a
            href="https://api.slack.com/apps?new_app=1"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            api.slack.com/apps
          </a>
          , choose <em>From a manifest</em>, pick your workspace and paste this
          manifest.
        </li>
        <li>
          Copy the App ID, Client ID, Client Secret and Signing Secret from the
          new app&apos;s <em>Basic Information</em> page below, and save.
        </li>
        <li>
          Install the app. If Slack says the events URL is not verified, open{" "}
          <em>Event Subscriptions</em> and choose Retry: Slack can verify it
          once the signing secret is saved.
        </li>
      </ol>
      <div className="relative">
        <pre
          aria-label="Slack app manifest"
          className="max-h-64 overflow-auto rounded-lg border bg-card p-3 font-mono text-[11.5px] leading-5"
        >
          {manifest}
        </pre>
        <Button
          size="sm"
          variant="secondary"
          className="absolute top-2 right-2"
          onClick={() =>
            void navigator.clipboard
              .writeText(manifest)
              .then(() => toast({ title: "Manifest copied", duration: 2500 }))
          }
        >
          <Copy className="size-3.5" /> Copy
        </Button>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ appId, clientId, clientSecret, signingSecret });
          setClientSecret("");
          setSigningSecret("");
        }}
      >
        <label className="grid gap-1">
          App ID
          <Input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="A0123ABCDEF"
            className="h-9 text-[13px]"
            required
          />
        </label>
        <label className="grid gap-1">
          Client ID
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="1234567890.1234567890"
            className="h-9 text-[13px]"
            required
          />
        </label>
        <label className="grid gap-1">
          Client Secret
          <Input
            type="password"
            autoComplete="off"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            className="h-9 text-[13px]"
            required
          />
        </label>
        <label className="grid gap-1">
          Signing Secret
          <Input
            type="password"
            autoComplete="off"
            value={signingSecret}
            onChange={(e) => setSigningSecret(e.target.value)}
            className="h-9 text-[13px]"
            required
          />
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy !== undefined}>
            {busy === "save" && <Loader2 className="size-3.5 animate-spin" />}
            Save app
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </SettingsBody>
  );
}
