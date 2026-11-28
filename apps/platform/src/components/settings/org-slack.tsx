import { useCallback, useEffect, useId, useState } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  Loader2,
  MessagesSquare,
  MoreHorizontal,
  TriangleAlert,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  slackCredentialProblems,
  type SlackCredentialField,
} from "@lictory/core/channels/slack/credentials";
import { Button } from "@lictory/ui/button";
import { CommandBlock, CopyButton } from "@lictory/ui/command-block";
import { Input } from "@lictory/ui/input";
import { Switch } from "@lictory/ui/switch";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@lictory/ui/menu";
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
  const mayDisconnect = status !== "disconnected" && status !== "pending";
  // Setting up is a few steps with a manifest: they open on request, so an
  // organization without Slack sees one sentence and one button.
  const showSetup = isAdmin && editing;
  const unconnected = status === "none" || status === "disconnected";
  return (
    <SettingsSection
      id="slack"
      icon={<MessagesSquare />}
      title="Slack"
      description="Link Lictory channels to Slack channels so both sides see one conversation."
      learnMore="slack"
      footer="Lictory works only in Slack channels its app was invited to, matches people by confirmed email and imports no history unless asked."
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
            {isAdmin && unconnected && !showSetup && (
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => setEditing(true)}
              >
                Set up Slack
              </Button>
            )}
            {isAdmin && !unconnected && !showSetup && (
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
                    {/* On phones the less frequent actions share one
                        labelled menu, so none is cut off. */}
                    <span className="contents max-sm:hidden">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(true)}
                      >
                        Replace app
                      </Button>
                      {mayDisconnect && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirming(true)}
                        >
                          Disconnect…
                        </Button>
                      )}
                    </span>
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="More Slack actions"
                            className="sm:hidden"
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </Button>
                        }
                      />
                      <MenuContent align="end">
                        <MenuItem onSelect={() => setEditing(true)}>
                          Replace app
                        </MenuItem>
                        {mayDisconnect && (
                          <MenuItem onSelect={() => setConfirming(true)}>
                            Disconnect…
                          </MenuItem>
                        )}
                      </MenuContent>
                    </Menu>
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
                Off: Slack messages never reach Litto or the AI provider.
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
          onCancel={() => setEditing(false)}
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
  onCancel: () => void;
}) {
  const manifest = JSON.stringify(reading.manifest, null, 2);
  const unreachable = reading.urls ? notPublicHttps(reading.urls.events) : null;
  const [appId, setAppId] = useState(reading.connection.appId ?? "");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [problems, setProblems] = useState<
    Partial<Record<SlackCredentialField, string>>
  >({});
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
          , choose <em>From a manifest</em>, pick your workspace and paste
          Lictory&apos;s manifest.{" "}
          <CopyButton
            text={manifest}
            label="Copy the manifest"
            className="ml-1 align-middle"
          />
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
      {unreachable && (
        <div
          role="note"
          aria-label="Slack cannot reach this server"
          className="flex gap-2 rounded-lg border border-warning/25 bg-warning/5 p-3"
        >
          <TriangleAlert
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          <div className="flex flex-col gap-1 text-xs leading-5">
            <p className="font-medium">Slack cannot reach {unreachable}</p>
            <p className="text-muted-foreground">
              Slack sends events and sign-ins only to a public HTTPS address,
              and this manifest uses the server&apos;s own address. Whoever runs
              this server sets a public HTTPS address for it first (on a laptop
              trial, Slack sync cannot work).
            </p>
          </div>
        </div>
      )}
      {/* The manifest is copied, not read: its JSON stays behind a
          disclosure for whoever wants to check it. */}
      <details className="group">
        <summary className="inline-flex cursor-pointer items-center gap-1 rounded text-xs font-medium text-muted-foreground focus-ring outline-none select-none hover:text-foreground">
          <ChevronRight
            aria-hidden
            className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          />
          Show the manifest
        </summary>
        <CommandBlock
          label="Slack app manifest"
          copyLabel="Copy the manifest from the block"
          maxHeight="md"
          className="mt-2"
        >
          {manifest}
        </CommandBlock>
      </details>
      <form
        className="grid gap-3 sm:grid-cols-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const fields = { appId, clientId, clientSecret, signingSecret };
          // A malformed field is named where it is, before anything is sent;
          // the server checks the same and asks Slack about the rest.
          const found = slackCredentialProblems(fields);
          setProblems(
            Object.fromEntries(found.map((p) => [p.field, p.message])),
          );
          if (found.length) {
            e.currentTarget
              .querySelector<HTMLInputElement>(`[name="${found[0]!.field}"]`)
              ?.focus();
            return;
          }
          onSave(fields);
          setClientSecret("");
          setSigningSecret("");
        }}
      >
        <CredentialField
          name="appId"
          label="App ID"
          value={appId}
          onChange={setAppId}
          placeholder="e.g. A0123ABCDEF"
          problem={problems.appId}
        />
        <CredentialField
          name="clientId"
          label="Client ID"
          value={clientId}
          onChange={setClientId}
          placeholder="e.g. 1234567890.1234567890"
          problem={problems.clientId}
        />
        <CredentialField
          name="clientSecret"
          label="Client Secret"
          secret
          value={clientSecret}
          onChange={setClientSecret}
          problem={problems.clientSecret}
        />
        <CredentialField
          name="signingSecret"
          label="Signing Secret"
          secret
          value={signingSecret}
          onChange={setSigningSecret}
          problem={problems.signingSecret}
        />
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy !== undefined}>
            {busy === "save" && <Loader2 className="size-3.5 animate-spin" />}
            Save app
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </SettingsBody>
  );
}

// One credential: its label, the input, and what is wrong with it right
// under it, tied to the input so a screen reader reads it with the field.
function CredentialField({
  name,
  label,
  value,
  onChange,
  placeholder,
  secret = false,
  problem,
}: {
  name: SlackCredentialField;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secret?: boolean;
  problem?: string;
}) {
  const id = useId();
  return (
    <div className="grid content-start gap-1">
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        name={name}
        type={secret ? "password" : "text"}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 text-[13px] aria-invalid:border-destructive/60"
        required
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
      />
      {problem && (
        <p id={`${id}-problem`} className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

// The origin Slack cannot deliver to, when the manifest's events URL is not
// a public HTTPS address (plain HTTP, localhost, a private or link-local
// address, a .local or .internal name); null when it may be reachable.
function notPublicHttps(address: string) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const local =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    /^(127|10)\./.test(host) ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return url.protocol !== "https:" || local ? url.origin : null;
}
