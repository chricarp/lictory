import { useState } from "react";
import { IntelligenceMark, useAfterglow } from "@lictory/ui/intelligence-mark";
import { cn } from "@lictory/core/lib/utils";
import { Switch } from "@lictory/ui/switch";
import {
  textProviders,
  transcriptionProviderOf,
  type AiProviderKind,
} from "@lictory/core/contracts/ai-provider";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import { IntelligenceContextSection } from "@lictory/platform/components/intelligence/context-settings";

// Where content goes, in the organization's terms. The endpoint itself is
// not shown to members. A self-hosted server or a gateway is described as
// such: only the operator knows where it runs.
function destination(
  provider: AiProviderKind,
  customEndpoint: boolean,
): string {
  const spec = textProviders[provider];
  if (spec.hosting === "self-hosted")
    return `A model server run by this installation's operator (${spec.label}).`;
  if (customEndpoint)
    return `${spec.label} models through the operator's gateway or proxy.`;
  return `${spec.label}${spec.noStorageRequest ? ", which is asked not to store requests" : ""}.`;
}

function dictationDestination(
  provider: string | null,
  mode: string | null,
  customEndpoint: boolean,
) {
  if (!provider) return "Not offered on this server.";
  const spec = transcriptionProviderOf(provider);
  if (!spec) return "Offered on this server.";
  if (customEndpoint && spec.hosting === "cloud")
    return `Short clips via this server to ${spec.label}, through the operator's gateway. Not stored.`;
  if (mode === "realtime")
    return `Audio goes from the browser straight to ${spec.label.replace(/ \(live\)$/, "")}. Not stored.`;
  return spec.hosting === "self-hosted"
    ? `Short clips via this server to the operator's speech-to-text server (${spec.label}). Not stored.`
    : `Short clips via this server to ${spec.label}. Not stored.`;
}

export function OrganizationIntelligence() {
  return (
    <>
      <AiPolicySection />
      <IntelligenceContextSection pinned={{ scope: "organization" }} />
    </>
  );
}

// Organization content is sent to the AI provider only after an administrator
// opts in. Turning it off stops queued runs before anything is sent.
function AiPolicySection() {
  const { isAdmin, directory, mutate } = useWorkspace();
  const {
    enabled,
    available,
    provider,
    model,
    customEndpoint,
    dictationProvider,
    dictationMode,
    dictationCustomEndpoint,
  } = directory.ai;
  const sentTo = provider ? destination(provider, customEndpoint) : null;
  const [error, setError] = useState("");
  const woke = useAfterglow(!enabled);
  return (
    <SettingsSection
      id="ai"
      icon={
        <IntelligenceMark
          mood={!enabled ? "sleeping" : woke ? "happy" : undefined}
        />
      }
      title="Lictory Intelligence"
      description="Litto and AI reviews of work items and pull requests."
      action={
        <Switch
          aria-label="Allow Lictory Intelligence"
          checked={enabled}
          disabled={!isAdmin || (!available && !enabled)}
          onCheckedChange={async (next) => {
            setError("");
            try {
              await mutate({ type: "setAiPolicy", enabled: next });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Not saved.");
            }
          }}
          className="data-checked:bg-foreground"
        />
      }
      footer={
        available
          ? "Instance administrators choose the provider and model."
          : "No AI provider connected. An instance administrator can connect one in the admin console (/admin)."
      }
    >
      <SettingsBody className="space-y-3 text-[13px]">
        <p className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset",
              enabled
                ? "bg-success/8 text-success ring-success/20"
                : "bg-muted text-muted-foreground ring-foreground/8",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                enabled ? "bg-success" : "bg-muted-foreground/60",
              )}
            />
            {enabled ? "On" : "Off"}
          </span>
          {!enabled && "No content is sent to an AI provider."}
        </p>
        {/* The decisions, as rows instead of prose. */}
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
          <dt className="text-xs font-semibold text-muted-foreground sm:pt-0.5">
            Who can use it
          </dt>
          <dd>Members who can request reviews in a project.</dd>
          <dt className="text-xs font-semibold text-muted-foreground sm:pt-0.5">
            Data sent
          </dt>
          <dd>
            Reviewed items (specifications, open discussions, pull request
            changes) and the context that applies to them.
          </dd>
          {sentTo && (
            <>
              <dt className="text-xs font-semibold text-muted-foreground sm:pt-0.5">
                Sent to
              </dt>
              <dd>
                {sentTo}
                {model && (
                  <>
                    {" "}
                    Model <span className="font-mono text-xs">{model}</span>.
                  </>
                )}
              </dd>
              <dt className="text-xs font-semibold text-muted-foreground sm:pt-0.5">
                Voice input
              </dt>
              <dd>
                {dictationDestination(
                  dictationProvider,
                  dictationMode,
                  dictationCustomEndpoint,
                )}
              </dd>
            </>
          )}
          <dt className="text-xs font-semibold text-muted-foreground sm:pt-0.5">
            Who can change this
          </dt>
          <dd>
            Organization administrators
            {!isAdmin && " (not you)"}.
          </dd>
        </dl>
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}
