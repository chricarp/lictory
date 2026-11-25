import { useEffect, useState } from "react";
import { Bot, CircleAlert, History } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  autonomyLevelMeta,
  autopilotRequirementLabels,
  autopilotRequirements,
  maxConcurrentSessionsLimit,
  type AutonomyLevel,
  type AutonomyPolicyInput,
  type AutopilotRequirement,
} from "@lictory/core/claims/contracts";
import { relativeTime, type Project } from "@lictory/core/lib/work-items";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { Checkbox } from "@lictory/ui/checkbox";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { LoadingState } from "@lictory/ui/spinner";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useChannels } from "@lictory/platform/components/channels/store";
import { useCodeHosts } from "@lictory/platform/components/code/store";
import { AgentActor } from "@lictory/platform/components/identity/actor";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import {
  Choice,
  Field,
  plural,
} from "@lictory/platform/components/settings/project-shared";

type Agent = {
  id: string;
  name: string;
  ownerId: string;
  dispatchable: boolean;
  projectIds: string[] | null;
};
type Loaded = {
  policy: AutonomyPolicyInput;
  version: number;
  updatedById: string | null;
  updatedAt: string | null;
  agents: Agent[];
  claimsInFlight: number;
  waiting: number;
  history: {
    at: string;
    actorId: string;
    level: AutonomyLevel | null;
    previousLevel: AutonomyLevel | null;
    previous: (AutonomyPolicyInput & { version?: number }) | null;
  }[];
};

const order: AutonomyLevel[] = ["assist", "build", "autopilot"];

// How much the factory does by itself in this project. A governance
// decision: drafted here, saved explicitly, audited, and reversible from its
// history. Lowering it releases nothing.
export function ProjectAutonomy({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { organization, memberName } = useWorkspace();
  const channels = useChannels();
  // Channels people in the project can follow: public ones, and private
  // ones I am in (the server checks the same).
  const reportable = channels.list.filter(
    (c) =>
      c.kind !== "direct" &&
      !c.archivedAt &&
      (c.kind === "public" || Boolean(c.member)),
  );
  const [loaded, setLoaded] = useState<Loaded>();
  const [draft, setDraft] = useState<AutonomyPolicyInput>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    callCapability<Loaded>("getAutonomyPolicy", {
      organizationId: organization.id,
      projectId: project.id,
    })
      .then((result) => {
        if (!current) return;
        setLoaded(result);
        setDraft(result.policy);
      })
      .catch(
        (e: unknown) =>
          current &&
          setError(e instanceof Error ? e.message : "The policy did not load."),
      );
    return () => {
      current = false;
    };
  }, [organization.id, project.id, version]);
  if (!loaded || !draft)
    return error ? (
      <InlineError>{error}</InlineError>
    ) : (
      <LoadingState label="Loading the autonomy policy" />
    );
  const external = project.deliveryMode !== "native";
  const editable = canEdit && !external;
  const eligible = loaded.agents.filter(
    (a) => !a.projectIds || a.projectIds.includes(project.id),
  );
  const runners = eligible.filter((a) => a.dispatchable);
  const changed = JSON.stringify(draft) !== JSON.stringify(loaded.policy);
  const lowering =
    order.indexOf(draft.level) < order.indexOf(loaded.policy.level);
  const set = (patch: Partial<AutonomyPolicyInput>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));
  const save = async (policy = draft) => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await callCapability<{
        level: AutonomyLevel;
        claimsInFlight: number;
      }>("setAutonomyPolicy", {
        organizationId: organization.id,
        projectId: project.id,
        policy,
        expectedVersion: loaded.version,
      });
      setNotice(
        `Saved: ${autonomyLevelMeta[result.level].label}.${
          result.claimsInFlight && lowering
            ? ` ${plural(result.claimsInFlight, "claim")} in flight continue; release them from the Factory queue if they should stop.`
            : ""
        }`,
      );
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The policy was not saved.");
    } finally {
      setSaving(false);
    }
  };
  const agentName = (id: string | null) =>
    loaded.agents.find((a) => a.id === id)?.name ?? "an agent";
  return (
    <div className="space-y-4">
      <SettingsSection
        id="autonomy"
        icon={<Bot />}
        title="Autonomy"
        description="How much the factory does by itself in this project. Agents always act for an accountable person; specification decisions stay with people at every level."
        footer={
          loaded.updatedAt && loaded.updatedById
            ? `Version ${loaded.version}, set by ${memberName(loaded.updatedById)} ${relativeTime(loaded.updatedAt)}. Every change is recorded in the audit log.`
            : "Never changed: Assist is the default. Every change is recorded in the audit log."
        }
      >
        <SettingsBody className="space-y-5">
          {external && (
            <p className="rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
              This project hands work off to an external tool, which owns
              execution. Build and Autopilot need native delivery.
            </p>
          )}
          <Field label="Level">
            <Choice
              label="Autonomy level"
              value={draft.level}
              disabled={!editable}
              onChange={(level) => set({ level })}
              options={order.map((level) => ({
                value: level,
                label: autonomyLevelMeta[level].label,
                description: autonomyLevelMeta[level].summary,
              }))}
            />
          </Field>
          <Field
            label="Implementer agents"
            hint="The dispatcher starts sessions for these runner agents, in rank order. Each acts with its person's permissions in this project."
          >
            {runners.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No runner agents are available to this project.{" "}
                <Link
                  href={`/${organization.slug}/factory`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Add one under Factory
                </Link>{" "}
                before choosing Build or Autopilot.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {runners.map((agent) => (
                  <li key={agent.id}>
                    <label className="flex min-h-6 items-center gap-2 text-[13px]">
                      <Checkbox
                        disabled={!editable}
                        checked={draft.implementerAgentIds.includes(agent.id)}
                        onCheckedChange={(checked) =>
                          set({
                            implementerAgentIds: checked
                              ? [...draft.implementerAgentIds, agent.id]
                              : draft.implementerAgentIds.filter(
                                  (id) => id !== agent.id,
                                ),
                          })
                        }
                      />
                      <AgentActor
                        agent={agent}
                        ownerId={agent.ownerId}
                        avatar={false}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Field>
          {/* Labels sit above their fields, so a long name never runs into
              its select. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid content-start gap-1.5 text-[13px]">
              <span className="font-medium">Reviewer agent</span>
              <DropdownSelect
                disabled={!editable}
                className="w-full"
                aria-label="Reviewer agent"
                value={draft.reviewerAgentId ?? ""}
                placeholder="None"
                onValueChange={(value) =>
                  set({ reviewerAgentId: value ? value : null })
                }
              >
                <DropdownSelectOption value="">None</DropdownSelectOption>
                {eligible.map((agent) => (
                  <DropdownSelectOption key={agent.id} value={agent.id}>
                    {agent.name}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
              <span className="text-xs text-muted-foreground">
                Reviews the implementers’ pull requests.
              </span>
            </label>
            <label className="grid content-start gap-1.5 text-[13px]">
              <span className="font-medium">Concurrent sessions</span>
              <DropdownSelect
                disabled={!editable}
                className="w-full"
                aria-label="Concurrent sessions"
                value={draft.maxConcurrentSessions}
                onValueChange={(value) =>
                  set({ maxConcurrentSessions: Number(value) })
                }
              >
                {Array.from(
                  { length: maxConcurrentSessionsLimit },
                  (_, i) => i + 1,
                ).map((n) => (
                  <DropdownSelectOption key={n} value={n}>
                    {plural(n, "session")}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
              <span className="text-xs text-muted-foreground">
                At most this many agents work in the project at once.
              </span>
            </label>
            <label className="grid content-start gap-1.5 text-[13px] sm:col-span-2 sm:max-w-[calc(50%-0.5rem)]">
              <span className="font-medium">Report to channel</span>
              <DropdownSelect
                disabled={!editable}
                className="w-full"
                aria-label="Report to channel"
                value={draft.reportingChannelId ?? ""}
                placeholder="None"
                onValueChange={(value) =>
                  set({ reportingChannelId: value ? value : null })
                }
              >
                <DropdownSelectOption value="">None</DropdownSelectOption>
                {reportable.map((channel) => (
                  <DropdownSelectOption key={channel.id} value={channel.id}>
                    #{channel.name}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
              <span className="text-xs text-muted-foreground">
                Dispatched sessions post their live card there; agents’
                questions are announced there.
              </span>
            </label>
          </div>
          {draft.level === "autopilot" && (
            <Field
              label="Before an automatic merge"
              hint="Lictory asks the code host to merge an agent's pull request only when these pass on its head commit. The merge is attributed to this policy and you."
            >
              <ul className="space-y-1.5">
                {autopilotRequirements.map((requirement) => (
                  <li key={requirement}>
                    <label className="flex items-center gap-2 text-[13px]">
                      <Checkbox
                        disabled={!editable || requirement === "checks_passed"}
                        checked={draft.autopilotRequires.includes(requirement)}
                        onCheckedChange={(checked) =>
                          set({
                            autopilotRequires: checked
                              ? [...draft.autopilotRequires, requirement]
                              : draft.autopilotRequires.filter(
                                  (r): r is AutopilotRequirement =>
                                    r !== requirement,
                                ),
                          })
                        }
                      />
                      {autopilotRequirementLabels[requirement]}
                      {requirement === "checks_passed" && (
                        <span className="text-xs text-muted-foreground">
                          always; a commit with no reported checks waits
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
              <SilentRepositories projectId={project.id} />
            </Field>
          )}
          {loaded.claimsInFlight > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {plural(loaded.claimsInFlight, "claim")} in flight
              {loaded.waiting ? ` (${loaded.waiting} waiting on people)` : ""}.
              Changing the level never releases them;{" "}
              <Link
                href={paths.factoryQueue(organization.slug, project.key)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                the Factory queue
              </Link>{" "}
              lets people release them.
            </p>
          )}
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!changed || saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save policy"}
              </Button>
              {changed && (
                <Button variant="ghost" onClick={() => setDraft(loaded.policy)}>
                  Discard changes
                </Button>
              )}
              {notice && (
                <p role="status" className="text-[13px] text-muted-foreground">
                  {notice}
                </p>
              )}
            </div>
          )}
          <InlineError>{error}</InlineError>
        </SettingsBody>
      </SettingsSection>
      {loaded.history.length > 0 && (
        <SettingsSection
          id="autonomy-history"
          icon={<History />}
          title="History"
          description="Who changed the policy and what it was before. Restoring saves the earlier policy as a new version."
        >
          <ul className="divide-y">
            {loaded.history.map((entry) => (
              <li
                key={entry.at}
                className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {memberName(entry.actorId)}
                  </span>{" "}
                  set{" "}
                  {entry.level ? autonomyLevelMeta[entry.level].label : "it"}
                  {entry.previousLevel && (
                    <span className="text-muted-foreground">
                      {" "}
                      (was {autonomyLevelMeta[entry.previousLevel].label})
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {" "}
                    · {relativeTime(entry.at)}
                  </span>
                </span>
                {editable && entry.previous && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      const { version, ...previous } = entry.previous!;
                      void version;
                      void save(previous);
                    }}
                  >
                    Restore {autonomyLevelMeta[entry.previous.level].label}
                    {entry.previous.reviewerAgentId
                      ? ` with ${agentName(entry.previous.reviewerAgentId)}`
                      : ""}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}
    </div>
  );
}

// Autopilot merges only after the code host reports passing checks, so a
// linked repository that never reported a check means it will never merge
// there. Said before the administrator relies on it.
function SilentRepositories({ projectId }: { projectId: string }) {
  const { repositories } = useCodeHosts();
  const linked = repositories.filter((r) => r.projectIds.includes(projectId));
  const silent = linked.filter((r) => r.reportsChecks === false);
  if (linked.length > 0 && silent.length === 0) return null;
  return (
    <p
      role="note"
      className="mt-2 flex items-start gap-1.5 text-xs text-foreground"
    >
      <CircleAlert
        aria-hidden
        className="mt-px size-3.5 shrink-0 text-warning"
      />
      <span>
        {linked.length === 0
          ? "No repository is linked to this project, so there is nothing for Autopilot to merge yet."
          : `${silent.map((r) => r.fullName).join(", ")} ${silent.length === 1 ? "has" : "have"} never reported a CI check. Autopilot waits for passing checks on the head commit, so it will not merge there until CI reports.`}
      </span>
    </p>
  );
}
