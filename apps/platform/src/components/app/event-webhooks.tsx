import {
  BellRing,
  CircleAlert,
  CircleCheck,
  CirclePause,
  Clock,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { SubscriptionView } from "@lictory/core/agent-events/subscriptions";
import {
  agentEventTypeList,
  agentEventTypes,
  type AgentEventType,
} from "@lictory/core/agent-events/catalog";
import { callCapability } from "@lictory/core/capabilities/client";
import { Button } from "@lictory/ui/button";
import { Checkbox } from "@lictory/ui/checkbox";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Input } from "@lictory/ui/input";
import { StatusChip, type StatusTone } from "@lictory/ui/status-chip";
import { Switch } from "@lictory/ui/switch";
import {
  InlineError,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

type Organization = { id: string; name: string };
type TestOutcome =
  | { ok: true; status: number }
  | { ok: false; status: number | null; reason: string; detail: string };

const ALL = "all";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

const statusTone: Record<SubscriptionView["status"], StatusTone> = {
  active: "success",
  paused: "neutral",
  suspended: "danger",
  expired: "attention",
};

const statusIcon: Record<SubscriptionView["status"], ReactNode> = {
  active: <CircleCheck />,
  paused: <CirclePause />,
  suspended: <CircleAlert />,
  expired: <Clock />,
};

const statusLabel: Record<SubscriptionView["status"], string> = {
  active: "Active",
  paused: "Paused",
  suspended: "Suspended",
  expired: "Expired",
};

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// Account settings → AI agents → Event webhooks. Agents that cannot hold a
// connection open are woken by a webhook when something waits on you: a
// URL and a bearer secret (Grok, Claude routines, OpenClaw hooks), or an MCP
// Events subscription an MCP client created itself (listed here too, so you
// see and can stop what receives your events). Creating one stays in the
// browser: it holds a credential.
export function EventWebhooksSection() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionView[] | null>(
    null,
  );
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [organizationId, setOrganizationId] = useState(ALL);
  const [allTypes, setAllTypes] = useState(true);
  const [types, setTypes] = useState<AgentEventType[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await callCapability<{
        subscriptions: SubscriptionView[];
      }>("listEventSubscriptions");
      setSubscriptions(result.subscriptions);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    callCapability<{ subscriptions: SubscriptionView[] }>(
      "listEventSubscriptions",
    ).then(
      (result) => setSubscriptions(result.subscriptions),
      (e: Error) => setError(e.message),
    );
    callCapability<{ organizations: Organization[] }>("listOrganizations").then(
      (result) => setOrganizations(result.organizations),
      () => undefined,
    );
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!allTypes && !types.length) {
      setError("Choose at least one event type, or send every type.");
      return;
    }
    setPending("create");
    setError(null);
    try {
      await callCapability("createEventWebhook", {
        name,
        url,
        secret,
        organizationId: organizationId === ALL ? null : organizationId,
        eventTypes: allTypes ? [] : types,
      });
      setCreating(false);
      setName("");
      setUrl("");
      setSecret("");
      setTypes([]);
      setAllTypes(true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function act(
    subscription: SubscriptionView,
    action: "test" | "pause" | "resume" | "remove",
  ) {
    setPending(`${action}:${subscription.id}`);
    setError(null);
    setNotice(null);
    try {
      if (action === "test") {
        const outcome = await callCapability<TestOutcome>("testEventWebhook", {
          subscriptionId: subscription.id,
        });
        setNotice({
          id: subscription.id,
          text: outcome.ok
            ? `The receiver accepted the test event (${outcome.status}).`
            : `The test event was not accepted: ${outcome.detail}`,
        });
      } else if (action === "remove")
        await callCapability("deleteEventSubscription", {
          subscriptionId: subscription.id,
        });
      else
        await callCapability("setEventSubscriptionState", {
          subscriptionId: subscription.id,
          step: action,
        });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  const organizationName = (id: string | null) =>
    id
      ? (organizations.find((o) => o.id === id)?.name ?? "One organization")
      : "All your organizations";

  return (
    <SettingsSection
      id="webhooks"
      icon={<BellRing />}
      title="Event webhooks"
      description={
        <>
          Wake an agent when something waits on you: a mention, a review
          request, a stale approval, an answered question, a decided pull
          request. Lictory posts the event (identifiers and a short title, never
          the content) to the agent&apos;s URL with its bearer secret. MCP
          clients that support MCP Events subscribe on their own and appear here
          too.
        </>
      }
      action={
        !creating ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setCreating(true);
              setError(null);
            }}
          >
            New webhook
          </Button>
        ) : undefined
      }
      footer="An event says what happened, never what to do; the agent reads the details with your permissions. Delivery retries a failing receiver with backoff and stops after five failures until you resume it."
    >
      {creating && (
        <SettingsBody>
          <form
            onSubmit={create}
            className="space-y-3"
            aria-label="New webhook"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[13px] font-medium">
                Name
                <Input
                  autoFocus
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Grok routine"
                  className="mt-1.5 h-8 rounded-md text-sm"
                />
              </label>
              <div className="text-[13px] font-medium">
                <span id="webhook-organization-label">Events from</span>
                <DropdownSelect
                  aria-labelledby="webhook-organization-label"
                  className="mt-1.5 w-full"
                  value={organizationId}
                  onValueChange={setOrganizationId}
                >
                  <DropdownSelectOption value={ALL}>
                    All your organizations
                  </DropdownSelectOption>
                  {organizations.map((o) => (
                    <DropdownSelectOption key={o.id} value={o.id}>
                      {o.name}
                    </DropdownSelectOption>
                  ))}
                </DropdownSelect>
              </div>
            </div>
            <label className="block text-[13px] font-medium">
              URL
              <Input
                required
                type="url"
                inputMode="url"
                maxLength={2048}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.example.com/agent"
                className="mt-1.5 h-8 rounded-md font-mono text-xs"
              />
            </label>
            <label className="block text-[13px] font-medium">
              Bearer secret
              <Input
                required
                type="password"
                autoComplete="off"
                maxLength={4096}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Sent as Authorization: Bearer …"
                className="mt-1.5 h-8 rounded-md font-mono text-xs"
              />
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[13px] font-medium">
                <Switch checked={allTypes} onCheckedChange={setAllTypes} />
                Every event type
              </label>
              {!allTypes && (
                <fieldset className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  <legend className="sr-only">Event types</legend>
                  {agentEventTypeList.map((type) => (
                    <label
                      key={type}
                      className="flex items-center gap-2 text-[13px]"
                      title={agentEventTypes[type].description}
                    >
                      <Checkbox
                        checked={types.includes(type)}
                        onCheckedChange={(checked) =>
                          setTypes((current) =>
                            checked
                              ? [...current, type]
                              : current.filter((t) => t !== type),
                          )
                        }
                      />
                      {agentEventTypes[type].label}
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending === "create"}>
                {pending === "create" ? "Adding…" : "Add webhook"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </SettingsBody>
      )}
      {error && (
        <SettingsBody>
          <InlineError>{error}</InlineError>
        </SettingsBody>
      )}
      <SettingsList
        isEmpty={subscriptions !== null && subscriptions.length === 0}
        empty="No webhooks yet."
      >
        {subscriptions?.map((subscription) => {
          const busy = pending?.endsWith(`:${subscription.id}`) ?? false;
          const typesText = subscription.eventTypes.length
            ? subscription.eventTypes
                .map((t) => agentEventTypes[t]?.label ?? t)
                .join(", ")
            : "Every event type";
          return (
            <div
              key={subscription.id}
              data-testid="event-webhook"
              className="space-y-1.5 px-5 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-[13px]">
                  <span className="truncate font-medium">
                    {subscription.name}
                  </span>
                  <StatusChip
                    tone={statusTone[subscription.status]}
                    icon={statusIcon[subscription.status]}
                  >
                    {statusLabel[subscription.status]}
                  </StatusChip>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {subscription.kind === "mcp" ? "MCP Events" : "Webhook"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {subscription.kind === "webhook" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void act(subscription, "test")}
                      aria-label={`Send a test event to ${subscription.name}`}
                    >
                      Test
                    </Button>
                  )}
                  {subscription.steps.includes("pause") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void act(subscription, "pause")}
                      aria-label={`Pause ${subscription.name}`}
                    >
                      Pause
                    </Button>
                  )}
                  {subscription.steps.includes("resume") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void act(subscription, "resume")}
                      aria-label={`Resume ${subscription.name}`}
                    >
                      Resume
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void act(subscription, "remove")}
                    aria-label={`Remove ${subscription.name}`}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <p className="text-xs break-words text-muted-foreground">
                <code className="font-mono break-all">
                  {hostOf(subscription.url)}
                </code>{" "}
                · {organizationName(subscription.organizationId)} · {typesText}
              </p>
              <p
                className="text-xs text-muted-foreground tabular-nums"
                data-testid="event-webhook-state"
              >
                {subscription.deliveredCount} delivered
                {subscription.lastSuccessAt
                  ? `, last ${when(subscription.lastSuccessAt)}`
                  : ""}
                {subscription.pending
                  ? ` · ${subscription.pending > 100 ? "100+" : subscription.pending} waiting`
                  : ""}
                {subscription.kind === "mcp" && subscription.refreshBefore
                  ? ` · renew before ${when(subscription.refreshBefore)}`
                  : ""}
              </p>
              {subscription.statusReason &&
                subscription.status !== "active" && (
                  <p className="text-xs text-muted-foreground">
                    {subscription.statusReason}
                  </p>
                )}
              {subscription.lastErrorDetail && (
                <p className="text-xs text-destructive" role="status">
                  Last problem
                  {subscription.lastAttemptAt
                    ? ` (${when(subscription.lastAttemptAt)})`
                    : ""}
                  : {subscription.lastErrorDetail}
                </p>
              )}
              {notice?.id === subscription.id && (
                <p
                  role="status"
                  data-testid="event-webhook-test"
                  className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-foreground"
                >
                  {notice.text}
                </p>
              )}
            </div>
          );
        })}
      </SettingsList>
    </SettingsSection>
  );
}
