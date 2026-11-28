import {
  ArrowRight,
  BellRing,
  CircleAlert,
  CircleCheck,
  CirclePause,
  Clock,
  RotateCcw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { SubscriptionView } from "@lictory/core/agent-events/subscriptions";
import {
  agentEventTypeList,
  agentEventTypes,
  type AgentEventType,
} from "@lictory/core/agent-events/catalog";
import { callCapability } from "@lictory/core/capabilities/client";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Checkbox } from "@lictory/ui/checkbox";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Input } from "@lictory/ui/input";
import { StatusChip, type StatusTone } from "@lictory/ui/status-chip";
import { Switch } from "@lictory/ui/switch";
import { Link } from "@lictory/platform/lib/navigation";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  InlineError,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

// Event webhooks wake an agent that cannot hold a connection open when
// something waits on its person: a URL and a bearer secret (Grok, Claude
// routines, OpenClaw hooks), or an MCP Events subscription an MCP client
// created itself. A webhook bound to a Factory agent lives on that agent's
// page (Wake-ups); Account settings keeps the person's own, for tools using a
// personal access token. Creating one stays in the browser: it holds a
// credential. The parts below serve both places.

export type Organization = { id: string; name: string; slug: string };
type TestOutcome =
  | { ok: true; status: number }
  | { ok: false; status: number | null; reason: string; detail: string };
type Action = "test" | "pause" | "resume" | "remove";

const ALL = "all";

const when = (iso: string | null) => (iso ? absoluteTime(iso) : null);

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

// The person's webhooks and MCP event subscriptions, and what they can do
// with them. Everything is the person's own: the server lists and changes
// only subscriptions they created (or their agents' clients did).
export function useEventSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionView[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [pending, setPending] = useState<string | null>(null);

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
  }, []);

  // Adds a webhook; true when it was added.
  const create = async (input: {
    name: string;
    url: string;
    secret: string;
    organizationId: string | null;
    agentId?: string | null;
    eventTypes: AgentEventType[];
  }) => {
    setPending("create");
    setError(null);
    try {
      await callCapability("createEventWebhook", input);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setPending(null);
    }
  };

  const act = async (subscription: SubscriptionView, action: Action) => {
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
  };

  return {
    subscriptions,
    error,
    setError,
    notice,
    pending,
    create,
    act,
  };
}

// The form for a new webhook. With `organizations` the person chooses where
// events come from; an agent's webhook takes its agent's organization.
export function WebhookForm({
  organizations,
  placeholder = "Grok routine",
  pending,
  onSubmit,
  onCancel,
  onInvalid,
}: {
  organizations?: Organization[];
  placeholder?: string;
  pending: boolean;
  onSubmit: (input: {
    name: string;
    url: string;
    secret: string;
    organizationId: string | null;
    eventTypes: AgentEventType[];
  }) => Promise<boolean>;
  onCancel: () => void;
  onInvalid: (message: string) => void;
}) {
  const organizationLabel = useId();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [organizationId, setOrganizationId] = useState(ALL);
  const [allTypes, setAllTypes] = useState(true);
  const [types, setTypes] = useState<AgentEventType[]>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!allTypes && !types.length) {
      onInvalid("Choose at least one event type, or send every type.");
      return;
    }
    const added = await onSubmit({
      name,
      url,
      secret,
      organizationId: organizationId === ALL ? null : organizationId,
      eventTypes: allTypes ? [] : types,
    });
    if (added) {
      setName("");
      setUrl("");
      setSecret("");
      setTypes([]);
      setAllTypes(true);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="space-y-3"
      aria-label="New webhook"
    >
      <div className={organizations ? "grid gap-3 sm:grid-cols-2" : undefined}>
        <label className="block text-[13px] font-medium">
          Name
          <Input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            className="mt-1.5 h-8 rounded-md text-sm"
          />
        </label>
        {organizations && (
          <div className="text-[13px] font-medium">
            <span id={organizationLabel}>Events from</span>
            <DropdownSelect
              aria-labelledby={organizationLabel}
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
        )}
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
          placeholder="e.g. https://hooks.example.com/agent"
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
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add webhook"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// One webhook or MCP subscription: its state, where it sends, what it
// delivered, the last problem and its actions. `where` names the
// organization it covers (Account settings); an agent's page omits it.
export function SubscriptionDetails({
  subscription,
  where,
  busy,
  notice,
  onAct,
}: {
  subscription: SubscriptionView;
  where?: string;
  busy: boolean;
  notice: string | null;
  onAct: (action: Action) => void;
}) {
  const typesText = subscription.eventTypes.length
    ? subscription.eventTypes
        .map((t) => agentEventTypes[t]?.label ?? t)
        .join(", ")
    : "Every event type";
  return (
    <div data-testid="event-webhook" className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="truncate font-medium">{subscription.name}</span>
          {/* Active but failing: the receiver refused the last attempts and
              Lictory tries again. Not a green "Active" above a red problem
              line: the chip says what the line below explains. */}
          {subscription.status === "active" && subscription.retry ? (
            <StatusChip tone="attention" icon={<RotateCcw />}>
              Retrying
            </StatusChip>
          ) : (
            <StatusChip
              tone={statusTone[subscription.status]}
              icon={statusIcon[subscription.status]}
            >
              {statusLabel[subscription.status]}
            </StatusChip>
          )}
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
              onClick={() => onAct("test")}
              aria-label={`Send a test event to ${subscription.name}`}
            >
              Test
            </Button>
          )}
          {/* A suspended one is already stopped: its next step is Resume,
              once the receiver works again. */}
          {subscription.steps.includes("pause") &&
            subscription.status !== "suspended" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onAct("pause")}
                aria-label={`Pause ${subscription.name}`}
              >
                Pause
              </Button>
            )}
          {subscription.steps.includes("resume") && (
            <Button
              size="sm"
              variant={
                subscription.status === "suspended" ? "secondary" : "ghost"
              }
              disabled={busy}
              onClick={() => onAct("resume")}
              aria-label={`Resume ${subscription.name}`}
            >
              Resume
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onAct("remove")}
            aria-label={`Remove ${subscription.name}`}
          >
            Remove
          </Button>
        </div>
      </div>
      <p className="text-xs break-words text-muted-foreground">
        <code className="font-mono break-all">{hostOf(subscription.url)}</code>
        {where ? ` · ${where}` : ""} · {typesText}
      </p>
      <p
        className="text-xs text-muted-foreground tabular-nums"
        data-testid="event-webhook-state"
      >
        {/* Events delivered, and when the receiver last accepted anything
            (a test event counts there, not as delivered). */}
        {subscription.deliveredCount === 0
          ? "No events delivered yet"
          : `${subscription.deliveredCount} ${subscription.deliveredCount === 1 ? "event" : "events"} delivered`}
        {/* Past times read as everywhere else ("5m ago"); times to come
            (the next try, the renewal) stay dates. */}
        {subscription.lastSuccessAt
          ? ` · receiver last accepted ${relativeTime(subscription.lastSuccessAt)}`
          : ""}
        {subscription.pending
          ? ` · ${subscription.pending > 100 ? "100+" : subscription.pending} waiting`
          : ""}
        {subscription.kind === "mcp" && subscription.refreshBefore
          ? ` · renew before ${when(subscription.refreshBefore)}`
          : ""}
      </p>
      {/* Why the chip is not green: the sentence the person acts on. */}
      {subscription.statusReason && subscription.status !== "active" && (
        <p className="text-xs font-medium text-foreground">
          {subscription.statusReason}
        </p>
      )}
      {subscription.lastErrorDetail &&
        !(
          subscription.status !== "active" &&
          subscription.statusReason?.includes(subscription.lastErrorDetail)
        ) && (
          <p className="text-xs text-destructive" role="status">
            Last problem
            {subscription.lastAttemptAt
              ? ` (${relativeTime(subscription.lastAttemptAt)})`
              : ""}
            : {subscription.lastErrorDetail}
            {subscription.retry
              ? ` ${subscription.retry.failedAttempts} failed ${subscription.retry.failedAttempts === 1 ? "attempt" : "attempts"}; trying again ${when(subscription.retry.nextAttemptAt)}.`
              : ""}
          </p>
        )}
      {notice && (
        <p
          role="status"
          data-testid="event-webhook-test"
          className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-foreground"
        >
          {notice}
        </p>
      )}
    </div>
  );
}

// Account settings → Event webhooks: the person's own webhooks, which wake a
// script or tool using a personal access token, and the MCP Events
// subscriptions such tools created. A Factory agent's webhooks and
// subscriptions are on the agent's page; they are only pointed to here, so
// nothing is listed twice.
export function EventWebhooksSection() {
  const { subscriptions, error, setError, notice, pending, create, act } =
    useEventSubscriptions();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    callCapability<{ organizations: Organization[] }>("listOrganizations").then(
      (result) => setOrganizations(result.organizations),
      () => undefined,
    );
  }, []);

  const organizationName = (id: string | null) =>
    id
      ? (organizations.find((o) => o.id === id)?.name ?? "One organization")
      : "All your organizations";
  const own = subscriptions?.filter((s) => !s.agentId) ?? null;
  // Agents with wake-ups, each once, linking to its page.
  const agents = [
    ...new Map(
      (subscriptions ?? [])
        .filter((s) => s.agentId)
        .map((s) => [
          s.agentId!,
          {
            id: s.agentId!,
            name: s.agent?.name ?? "An agent",
            organization: organizations.find(
              (o) => o.id === (s.agent?.organizationId ?? s.organizationId),
            ),
            count: subscriptions!.filter((t) => t.agentId === s.agentId).length,
          },
        ]),
    ).values(),
  ];

  return (
    <SettingsSection
      id="webhooks"
      icon={<BellRing />}
      title="Event webhooks"
      description={
        <>
          Wake a script or tool that uses one of your access tokens when
          something waits on you. To wake a Factory agent, add the webhook on
          the agent&apos;s page.
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
      footer="Events are mentions, review requests, stale approvals, answered questions and decided pull requests. Lictory posts identifiers and a short title (never the content) to the URL with its bearer secret; the tool reads the details with your permissions. MCP clients that support MCP Events subscribe on their own and appear here too. A failing receiver is retried with backoff and stops after five failures until you resume it."
    >
      {creating && (
        <SettingsBody>
          <WebhookForm
            organizations={organizations}
            pending={pending === "create"}
            onSubmit={async (input) => {
              const added = await create(input);
              if (added) setCreating(false);
              return added;
            }}
            onCancel={() => setCreating(false)}
            onInvalid={setError}
          />
        </SettingsBody>
      )}
      {error && (
        <SettingsBody>
          <InlineError>{error}</InlineError>
        </SettingsBody>
      )}
      <SettingsList
        isEmpty={own !== null && own.length === 0}
        empty="No webhooks yet."
      >
        {own?.map((subscription) => (
          <div key={subscription.id} className="px-5 py-3">
            <SubscriptionDetails
              subscription={subscription}
              where={organizationName(subscription.organizationId)}
              busy={pending?.endsWith(`:${subscription.id}`) ?? false}
              notice={notice?.id === subscription.id ? notice.text : null}
              onAct={(action) => void act(subscription, action)}
            />
          </div>
        ))}
      </SettingsList>
      {agents.length > 0 && (
        <SettingsBody className="space-y-1.5 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Your agents&apos; wake-ups are on their pages:
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {agents.map((agent) => (
              <li key={agent.id}>
                {agent.organization ? (
                  <Link
                    href={factoryPaths.agent(
                      agent.organization.slug,
                      agent.id,
                      "wake-ups",
                    )}
                    className="inline-flex items-center gap-1 rounded-sm text-[13px] font-medium focus-ring outline-none hover:underline"
                  >
                    {agent.name}
                    <span className="font-normal text-muted-foreground">
                      {agent.count === 1
                        ? "1 wake-up"
                        : `${agent.count} wake-ups`}
                    </span>
                    <ArrowRight aria-hidden className="size-3" />
                  </Link>
                ) : (
                  <span className="text-[13px]">{agent.name}</span>
                )}
              </li>
            ))}
          </ul>
        </SettingsBody>
      )}
    </SettingsSection>
  );
}
