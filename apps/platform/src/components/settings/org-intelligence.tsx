import { useState } from "react";
import { IntelligenceMark, useAfterglow } from "@lictory/ui/intelligence-mark";
import { cn } from "@lictory/core/lib/utils";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import { IntelligenceContextSection } from "@lictory/platform/components/intelligence/context-settings";

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
  const { enabled, available } = directory.ai;
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
      description="Chat, reviews of work items, and the Lictory Intelligence review action on pull requests. It proposes findings and changes; people decide what becomes part of a specification."
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
            enabled ? "bg-primary" : "bg-muted-foreground/25",
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
          ? "When enabled, the content of reviewed items (specifications, open discussions, pull request changes) and the Lictory Intelligence Context that applies to them is sent to OpenAI without being retained for training. Each project chooses how the Lictory Intelligence review action treats its pull requests in its project settings."
          : "This server has no AI provider configured. Set OPENAI_API_KEY to make Lictory Intelligence available."
      }
    >
      <SettingsBody className="space-y-1 text-[13px]">
        <p>
          {enabled
            ? "Enabled. Members who can request reviews in a project can ask for Lictory Intelligence reviews."
            : "Off. No content is sent to an AI provider."}
          {!isAdmin && " Only organization administrators can change this."}
        </p>
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}
