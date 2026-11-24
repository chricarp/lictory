import { useEffect, useState } from "react";
import { Webhook } from "lucide-react";
import type { AgentEventPolicy } from "@lictory/core/agent-events/subscriptions";
import { callCapability } from "@lictory/core/capabilities/client";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Switch } from "@lictory/ui/switch";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

// Organization settings → Security → Agent event webhooks: whether the
// organization's events (identifiers and short titles) may be sent to
// webhook destinations its members register for their agents, and to which
// hosts. The delivery worker applies it to every event, so a change takes
// effect for existing destinations too.
export function OrganizationWebhookPolicy() {
  const { organization } = useWorkspace();
  const [policy, setPolicy] = useState<AgentEventPolicy>();
  const [allowed, setAllowed] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [hosts, setHosts] = useState("");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const show = (next: AgentEventPolicy) => {
    setPolicy(next);
    setAllowed(next.webhooksAllowed);
    setRestricted(next.allowedHosts !== null);
    setHosts(next.allowedHosts?.join(", ") ?? "");
  };
  useEffect(() => {
    callCapability<AgentEventPolicy>("getAgentEventPolicy", {
      organizationId: organization.id,
    }).then(show, (e: Error) => setError(e.message));
  }, [organization.id]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setSaved(false);
    try {
      show(
        await callCapability<AgentEventPolicy>("setAgentEventPolicy", {
          organizationId: organization.id,
          webhooksAllowed: allowed,
          allowedHosts: restricted
            ? hosts
                .split(/[\s,]+/)
                .map((h) => h.trim())
                .filter(Boolean)
            : null,
          expectedVersion: policy?.version,
        }),
      );
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsSection
      id="webhooks"
      icon={<Webhook />}
      title="Agent event webhooks"
      description="Members can wake their agents with webhooks when something waits on them. Events carry identifiers and short titles (an item's key and title, a channel's name), never specification text or messages. Decide whether they may leave Lictory, and to which hosts."
      footer="Changes are recorded in the organization's configuration history. Destinations that no longer qualify stop receiving this organization's events at once; agents can still read events over MCP."
    >
      <SettingsBody>
        <form
          onSubmit={save}
          className="space-y-3 text-[13px]"
          aria-label="Webhook policy"
        >
          <label className="flex items-center gap-2 font-medium">
            <Switch
              checked={allowed}
              disabled={!policy}
              onCheckedChange={setAllowed}
            />
            Allow webhook destinations
          </label>
          {allowed && (
            <>
              <label className="flex items-center gap-2 font-medium">
                <Switch
                  checked={restricted}
                  disabled={!policy}
                  onCheckedChange={setRestricted}
                />
                Only to these hosts
              </label>
              {restricted && (
                <label className="block font-medium">
                  Hosts
                  <Input
                    value={hosts}
                    onChange={(e) => setHosts(e.target.value)}
                    placeholder="hooks.example.com, *.agents.example.com"
                    className="mt-1.5 h-8 rounded-md font-mono text-xs"
                  />
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Exact names, or *.example.com for every subdomain.
                  </span>
                </label>
              )}
            </>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={!policy || pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {saved && (
              <span role="status" className="text-xs text-success">
                Saved.
              </span>
            )}
          </div>
          <InlineError>{error}</InlineError>
        </form>
      </SettingsBody>
    </SettingsSection>
  );
}
