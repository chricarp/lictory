import { useState } from "react";
import { IntelligenceMark, useAfterglow } from "@lictory/ui/intelligence-mark";
import { cn } from "@lictory/core/lib/utils";
import type { AiProviderKind } from "@lictory/core/contracts/ai-provider";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import { IntelligenceContextSection } from "@lictory/platform/components/intelligence/context-settings";

// Where content goes, in the organization's terms. The endpoint itself is
// not shown to members; for an OpenAI-compatible endpoint only the operator
// knows where it runs (it may be on premises or a hosted service).
const destinations: Record<AiProviderKind, string> = {
  openai: "OpenAI, which is asked not to store requests.",
  anthropic: "Anthropic.",
  azure:
    "Azure OpenAI in the Azure resource this installation's operator configured, which is asked not to store requests.",
  "openai-compatible":
    "A model endpoint chosen by this installation's operator (OpenAI-compatible). Ask them where it runs.",
};

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
  const { enabled, available, provider, model, dictation } = directory.ai;
  const destination = provider ? destinations[provider] : null;
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
      description="Litto and AI reviews of work items and pull requests. Findings and changes are proposals; people decide."
      action={
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Allow Lictory Intelligence"
          disabled={!isAdmin || (!available && !enabled)}
          onClick={async () => {
            setError("");
            try {
              await mutate({ type: "setAiPolicy", enabled: !enabled });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Not saved.");
            }
          }}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40",
            enabled ? "bg-foreground" : "bg-muted-foreground/25",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out",
              enabled ? "translate-x-4.5" : "translate-x-0.5",
            )}
          />
        </button>
      }
      footer={
        available
          ? "This installation's operator chooses the AI provider and model on the server. Each project chooses how the review action treats its pull requests."
          : "This server has no AI provider connected. Its operator can connect OpenAI, Anthropic, Azure OpenAI or a self-hosted model (LICTORY_AI_PROVIDER)."
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
          <dt className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase sm:pt-0.5">
            Who can use it
          </dt>
          <dd>Members who can request reviews in a project.</dd>
          <dt className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase sm:pt-0.5">
            Data sent
          </dt>
          <dd>
            Reviewed items (specifications, open discussions, pull request
            changes) and the context that applies to them.
          </dd>
          {destination && (
            <>
              <dt className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase sm:pt-0.5">
                Sent to
              </dt>
              <dd>
                {destination}
                {model && (
                  <>
                    {" "}
                    Model <span className="font-mono text-xs">{model}</span>.
                  </>
                )}
              </dd>
              <dt className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase sm:pt-0.5">
                Voice input
              </dt>
              <dd>
                {dictation
                  ? "Audio goes from the browser straight to OpenAI and is not stored by Lictory."
                  : "Not offered on this server."}
              </dd>
            </>
          )}
          <dt className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase sm:pt-0.5">
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
