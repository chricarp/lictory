import { useCallback, useEffect, useState } from "react";
import { BellRing, KeyRound, Plug, Plus } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import type { AgentEntity } from "@lictory/core/factory/entities";
import type { AgentTokenSummary } from "@lictory/core/factory/agents";
import { Button } from "@lictory/ui/button";
import { CommandBlock, CopyValue } from "@lictory/ui/command-block";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Segmented, SegmentedItem } from "@lictory/ui/segmented";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Panel } from "@lictory/platform/components/shell/panel";
import {
  SubscriptionDetails,
  WebhookForm,
  useEventSubscriptions,
} from "@lictory/platform/components/app/event-webhooks";

// An agent's page holds everything that connects it (docs/internals/
// factory.md#agents): Connection, the MCP tokens an external client acts
// as the agent with, and Wake-ups, the webhooks and MCP Events
// subscriptions that wake it. Both are its owner's: the server lets only
// the owner mint, list and revoke its tokens, and lists, changes and
// removes only the person's own subscriptions.

// A token minted while creating an agent, handed to its page to show once.
// Kept in memory only: never in the address, history or storage.
const freshSecrets = new Map<string, string>();
export function handOverSecret(agentId: string, secret: string) {
  freshSecrets.set(agentId, secret);
}
export function hasHandedOverSecret(agentId: string) {
  return freshSecrets.has(agentId);
}

const expiries = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "7", label: "7 days" },
  { value: "never", label: "No expiry" },
];

const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const isActive = (token: AgentTokenSummary) =>
  !token.revokedAt &&
  (!token.expiresAt || new Date(token.expiresAt) > new Date());

const mcpEndpoint = () =>
  typeof window === "undefined"
    ? "/api/mcp"
    : `${window.location.origin}/api/mcp`;

type Client = "claude" | "codex" | "other";

function setupFor(client: Client, endpoint: string) {
  if (client === "claude")
    return `claude mcp add --transport http lictory ${endpoint} \\
  --header 'Authorization: Bearer \${LICTORY_TOKEN}'`;
  if (client === "codex")
    return `# ~/.codex/config.toml
[mcp_servers.lictory]
url = "${endpoint}"
bearer_token_env_var = "LICTORY_TOKEN"`;
  return `Transport  Streamable HTTP
URL        ${endpoint}
Header     Authorization: Bearer <token>`;
}

// How to point an MCP client at Lictory as this agent.
function SetupSnippet() {
  const [client, setClient] = useState<Client>("claude");
  const endpoint = mcpEndpoint();
  const text = setupFor(client, endpoint);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          MCP URL
        </span>
        <code
          data-testid="agent-mcp-url"
          className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
        >
          {endpoint}
        </code>
      </div>
      <Segmented
        value={client}
        onValueChange={setClient}
        aria-label="MCP client"
      >
        <SegmentedItem value="claude">Claude Code</SegmentedItem>
        <SegmentedItem value="codex">Codex</SegmentedItem>
        <SegmentedItem value="other">Other clients</SegmentedItem>
      </Segmented>
      <CommandBlock label="Setup" copyLabel="Copy the setup">
        {text}
      </CommandBlock>
      {client !== "other" && (
        <p className="text-xs text-muted-foreground">
          Set <code className="font-mono">LICTORY_TOKEN</code> to the token in
          the environment the client starts in. The setup stores the
          variable&apos;s name, never the token, so the token never lands in the
          client&apos;s configuration or a file you might commit.
        </p>
      )}
    </div>
  );
}

// Connection: the agent's MCP tokens. A new token is shown once, with the
// setup; rotating mints a new one and then revokes the old one.
export function AgentConnection({
  agent,
  optional = false,
}: {
  agent: AgentEntity;
  // A runner agent needs no token (each session gets its own); its panel
  // only appears while it has tokens someone made earlier.
  optional?: boolean;
}) {
  const { organization } = useWorkspace();
  const [tokens, setTokens] = useState<AgentTokenSummary[] | null>(null);
  const [secret, setSecret] = useState<string | null>(
    () => freshSecrets.get(agent.id) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expiry, setExpiry] = useState("90");
  const [pending, setPending] = useState<string | null>(null);
  // Shown once: leaving the page forgets it.
  useEffect(() => {
    freshSecrets.delete(agent.id);
  }, [agent.id]);
  const load = useCallback(
    () =>
      callCapability<{ tokens: AgentTokenSummary[] }>("listAgentTokens", {
        organizationId: organization.id,
        agentId: agent.id,
      }).then(
        (r) => setTokens(r.tokens),
        (e: Error) => setError(e.message),
      ),
    [organization.id, agent.id],
  );
  useEffect(() => void load(), [load]);

  const mint = async (expiresInDays: number | null) => {
    const result = await callCapability<{ secret: string }>(
      "createAgentToken",
      { organizationId: organization.id, agentId: agent.id, expiresInDays },
    );
    setSecret(result.secret);
  };
  const create = async () => {
    setPending("create");
    setError(null);
    try {
      await mint(expiry === "never" ? null : Number(expiry));
      setCreating(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  };
  const revoke = (token: AgentTokenSummary) =>
    callCapability("revokeAgentToken", {
      organizationId: organization.id,
      agentId: agent.id,
      tokenId: token.id,
    });
  const act = async (token: AgentTokenSummary, action: "rotate" | "revoke") => {
    setPending(`${action}:${token.id}`);
    setError(null);
    try {
      if (action === "rotate") {
        // The new token keeps the old one's lifetime where it can.
        const days = token.expiresAt
          ? Math.round(
              (new Date(token.expiresAt).getTime() -
                new Date(token.createdAt).getTime()) /
                86_400_000,
            )
          : null;
        const allowed = [7, 30, 90, 365];
        await mint(
          days === null
            ? null
            : allowed.reduce((a, b) =>
                Math.abs(b - days) < Math.abs(a - days) ? b : a,
              ),
        );
      }
      await revoke(token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
      await load();
    }
  };

  const active = tokens?.filter(isActive) ?? [];
  if (optional && tokens !== null && !active.length && !secret) return null;
  const archived = Boolean(agent.archivedAt);
  const tokenLimit = active.length >= 10;

  return (
    <div id="connection" className="scroll-mt-4">
      <Panel
        title="Connection"
        icon={<Plug />}
        // Panel reads a zero count as "no rows"; these always have a body.
        count={active.length || undefined}
        actions={
          !archived &&
          !creating && (
            <Button
              size="sm"
              variant="ghost"
              disabled={tokenLimit}
              onClick={() => {
                setCreating(true);
                setError(null);
              }}
            >
              <Plus className="size-3.5" aria-hidden /> New token
            </Button>
          )
        }
        empty={null}
      >
        <li className="space-y-3 px-3.5 py-3">
          <p className="text-[13px] leading-5 text-muted-foreground">
            {optional
              ? `Each session of ${agent.name} gets its own short-lived token. These extra tokens let an MCP client act as ${agent.name}.`
              : `An MCP client using one of these tokens acts as ${agent.name}: your permissions, narrowed to its scope, in ${organization.name} only.`}
          </p>
          {archived && (
            <p className="text-[13px]">
              {agent.name} is archived: its tokens do not work. Restore it to
              connect it again.
            </p>
          )}
          {secret && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <p className="text-[13px] font-medium">
                Copy this token now. It will not be shown again.
              </p>
              <CopyValue
                label="Token"
                value={secret}
                testId="agent-token-secret"
              />
            </div>
          )}
          {!archived && (secret ?? !optional) && <SetupSnippet />}
          {creating && (
            <div className="flex flex-wrap items-center gap-2">
              <DropdownSelect
                value={expiry}
                onValueChange={setExpiry}
                aria-label="Expires after"
                className="w-36"
              >
                {expiries.map((e) => (
                  <DropdownSelectOption key={e.value} value={e.value}>
                    {e.label}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
              <Button
                size="sm"
                disabled={pending === "create"}
                onClick={() => void create()}
              >
                <KeyRound className="size-3.5" aria-hidden />
                {pending === "create" ? "Creating…" : "Create token"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
          )}
          {tokenLimit && !archived && (
            <p className="text-xs text-muted-foreground">
              An agent can have at most 10 active tokens. Revoke one to create
              another.
            </p>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
        </li>
        {tokens !== null && !active.length && !archived && (
          <li className="px-3.5 py-3 text-[13px] text-muted-foreground">
            No active token. Create one and give it to the MCP client.
          </li>
        )}
        {active.map((token) => {
          const busy = pending?.endsWith(`:${token.id}`) ?? false;
          return (
            <li
              key={token.id}
              data-testid="agent-token"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <code className="font-mono text-xs">{token.prefix}…</code>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  Created {date(token.createdAt)}
                  {token.lastUsedAt
                    ? ` · last used ${date(token.lastUsedAt)}`
                    : " · never used"}
                  {token.expiresAt
                    ? ` · expires ${date(token.expiresAt)}`
                    : " · no expiry"}
                </span>
              </span>
              <span className="flex gap-1">
                {!archived && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || tokenLimit}
                    aria-label={`Rotate token ${token.prefix}`}
                    onClick={() => void act(token, "rotate")}
                  >
                    Rotate
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Revoke token ${token.prefix}`}
                  onClick={() => void act(token, "revoke")}
                >
                  Revoke
                </Button>
              </span>
            </li>
          );
        })}
      </Panel>
    </div>
  );
}

// Wake-ups: what tells the agent that something waits on it or its owner,
// so its client need not poll. A webhook (a URL and a bearer secret, for
// clients that start from one), or an MCP Events subscription its client
// made with its token. Events are the owner's feed seen through the
// agent's scope.
export function AgentWakeUps({ agent }: { agent: AgentEntity }) {
  const { organization } = useWorkspace();
  const { subscriptions, error, setError, notice, pending, create, act } =
    useEventSubscriptions();
  const [creating, setCreating] = useState(false);
  const own = subscriptions?.filter((s) => s.agentId === agent.id) ?? null;
  const archived = Boolean(agent.archivedAt);
  return (
    <div id="wake-ups" className="scroll-mt-4">
      <Panel
        title="Wake-ups"
        icon={<BellRing />}
        count={own && own.length > 0 ? own.length : undefined}
        actions={
          !archived &&
          !creating && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreating(true);
                setError(null);
              }}
            >
              <Plus className="size-3.5" aria-hidden /> New webhook
            </Button>
          )
        }
        empty={null}
      >
        <li className="space-y-3 px-3.5 py-3">
          <p className="text-[13px] leading-5 text-muted-foreground">
            Lictory calls a URL you choose as soon as something waits on{" "}
            {agent.name} or on you: a mention, a review request, a stale
            approval, an answered question, a decided pull request. Each call
            says what happened and where, with a short title; {agent.name} reads
            the details with its own tools. A client that keeps a connection
            open can call{" "}
            <code className="font-mono text-xs">waitForEvents</code> instead.
          </p>
          {creating && (
            <WebhookForm
              placeholder={`${agent.name}'s routine`}
              pending={pending === "create"}
              onSubmit={async (input) => {
                const added = await create({
                  ...input,
                  organizationId: organization.id,
                  agentId: agent.id,
                });
                if (added) setCreating(false);
                return added;
              }}
              onCancel={() => setCreating(false)}
              onInvalid={setError}
            />
          )}
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
        </li>
        {own !== null && !own.length && (
          <li className="px-3.5 py-3 text-[13px] text-muted-foreground">
            Nothing wakes {agent.name} yet. Add a webhook for a client that
            starts from a URL (Claude routines, Grok, OpenClaw hooks); clients
            that support MCP Events subscribe with its token and appear here.
          </li>
        )}
        {own?.map((subscription) => (
          <li key={subscription.id} className="px-3.5 py-3">
            <SubscriptionDetails
              subscription={subscription}
              busy={pending?.endsWith(`:${subscription.id}`) ?? false}
              notice={notice?.id === subscription.id ? notice.text : null}
              onAct={(action) => void act(subscription, action)}
            />
          </li>
        ))}
      </Panel>
    </div>
  );
}
