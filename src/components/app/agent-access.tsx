"use client";

import { Bot, Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AccessTokenSummary } from "~/capabilities/access-tokens";
import { callCapability } from "~/capabilities/client";
import { Button } from "~/components/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "~/components/ui/dropdown-select";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/primitives";
import {
  InlineError,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "~/components/workspace/settings-section";

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

function stateOf(token: AccessTokenSummary) {
  if (token.revokedAt) return "Revoked";
  if (token.expiresAt && new Date(token.expiresAt) <= new Date())
    return "Expired";
  return null;
}

// Personal access tokens let an external AI agent (an MCP client such as
// Claude, Cursor or Codex) work in Lictory as you, with your permissions.
export function AgentAccessSection() {
  const [tokens, setTokens] = useState<AccessTokenSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"read" | "write">("write");
  const [expiry, setExpiry] = useState("90");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const endpoint =
    typeof window === "undefined"
      ? "/api/mcp"
      : `${window.location.origin}/api/mcp`;

  const load = useCallback(async () => {
    try {
      const result = await callCapability<{ tokens: AccessTokenSummary[] }>(
        "listAccessTokens",
      );
      setTokens(result.tokens);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    callCapability<{ tokens: AccessTokenSummary[] }>("listAccessTokens").then(
      (result) => setTokens(result.tokens),
      (e: Error) => setError(e.message),
    );
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await callCapability<{ secret: string }>(
        "createAccessToken",
        {
          name,
          access,
          expiresInDays: expiry === "never" ? null : Number(expiry),
        },
      );
      setSecret(result.secret);
      setCopied(false);
      setCreating(false);
      setName("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function revoke(token: AccessTokenSummary) {
    setError(null);
    try {
      await callCapability("revokeAccessToken", { tokenId: token.id });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = tokens?.filter((t) => !stateOf(t)) ?? [];
  const inactive = tokens?.filter((t) => stateOf(t)) ?? [];

  return (
    <SettingsSection
      id="agents"
      icon={<Bot />}
      title="AI agents (MCP)"
      description={
        <>
          Connect an AI agent that supports the Model Context Protocol. It acts
          as you, with exactly your permissions in each organization, and its
          actions are recorded. Endpoint:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {endpoint}
          </code>
        </>
      }
      action={
        !creating ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setCreating(true);
              setSecret(null);
            }}
          >
            New token
          </Button>
        ) : undefined
      }
      footer="Agents never see your password and cannot create tokens, connect integrations or change your account. Revoke a token to disconnect its agent immediately."
    >
      {secret && (
        <SettingsBody className="space-y-2 bg-muted/40">
          <p className="text-[13px] font-medium">
            Copy this token now. It will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code
              data-testid="access-token-secret"
              className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1.5 font-mono text-xs shadow-(--shadow-border)"
            >
              {secret}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(secret);
                setCopied(true);
              }}
            >
              <Copy className="size-3.5" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Configure your agent to send it as{" "}
            <code>Authorization: Bearer &lt;token&gt;</code> to the endpoint
            above.
          </p>
        </SettingsBody>
      )}
      {creating && (
        <SettingsBody>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <label className="block min-w-48 flex-1 text-[13px] font-medium">
              Name
              <Input
                autoFocus
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Claude on my laptop"
                className="mt-1.5 h-8 rounded-md text-sm"
              />
            </label>
            <div className="text-[13px] font-medium">
              <span id="token-access-label">Access</span>
              <DropdownSelect
                aria-labelledby="token-access-label"
                className="mt-1.5 w-36"
                value={access}
                onValueChange={(v) => setAccess(v as "read" | "write")}
              >
                <DropdownSelectOption value="write">
                  Read & write
                </DropdownSelectOption>
                <DropdownSelectOption value="read">
                  Read only
                </DropdownSelectOption>
              </DropdownSelect>
            </div>
            <div className="text-[13px] font-medium">
              <span id="token-expiry-label">Expires</span>
              <DropdownSelect
                aria-labelledby="token-expiry-label"
                className="mt-1.5 w-32"
                value={expiry}
                onValueChange={setExpiry}
              >
                {expiries.map((e) => (
                  <DropdownSelectOption key={e.value} value={e.value}>
                    {e.label}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Creating…" : "Create token"}
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
        isEmpty={tokens !== null && tokens.length === 0}
        empty="No tokens yet."
      >
        {[...active, ...inactive].map((token) => {
          const state = stateOf(token);
          return (
            <div
              key={token.id}
              className="flex items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="truncate">{token.name}</span>
                  <Badge>
                    {token.access === "write" ? "Read & write" : "Read only"}
                  </Badge>
                  {state && <Badge>{state}</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  <code>{token.prefix}…</code> · Created {date(token.createdAt)}
                  {token.expiresAt && !state
                    ? ` · Expires ${date(token.expiresAt)}`
                    : ""}
                  {token.lastUsedAt
                    ? ` · Last used ${date(token.lastUsedAt)}`
                    : " · Never used"}
                </p>
              </div>
              {!state && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoke(token)}
                  aria-label={`Revoke ${token.name}`}
                >
                  Revoke
                </Button>
              )}
            </div>
          );
        })}
      </SettingsList>
    </SettingsSection>
  );
}
