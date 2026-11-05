import { useState } from "react";
import { Link } from "@lictory/platform/lib/navigation";
import { Check, GitPullRequestArrow, Sparkles, Truck } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import type { Project } from "@lictory/core/lib/work-items";
import type { DeliveryMode } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import { ProjectHandoffTarget } from "@lictory/platform/components/delivery/delivery-settings";
import {
  projectDeliveryTool,
  type DeliveryTool,
} from "@lictory/platform/components/delivery/provider-name";
import {
  Choice,
  useCommand,
} from "@lictory/platform/components/settings/project-shared";

// The external mode names the tool the project hands off to (see
// provider-name.ts), so the choice never promises a vendor it isn't using.
const modesFor = (
  tool: DeliveryTool,
): {
  value: DeliveryMode;
  title: string;
  summary: string;
  points: string[];
}[] => [
  {
    value: "native",
    title: "Deliver in Lictory",
    summary: "Refine and deliver in one place.",
    points: [
      "Board, backlog, sprints or cycles and estimates",
      "Readiness can gate starting spec-backed work",
      "Nothing is exported",
    ],
  },
  {
    value: "external",
    title: `Hand off to ${tool.name}`,
    summary: `Refine and approve here; ${tool.name} runs delivery.`,
    points: [
      `Ready work is exported to one project in ${tool.name}`,
      `Status and assignee are read back from ${tool.name}`,
      `Iterations and estimates are planned in ${tool.name}`,
    ],
  },
];

export function ProjectDelivery({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  return (
    <>
      <DeliveryModeSection project={project} canEdit={canEdit} />
      {project.deliveryMode === "external" && (
        <ProjectHandoffTarget project={project} canEdit={canEdit} />
      )}
      <PullRequestActions project={project} canEdit={canEdit} />
      <ReviewActions project={project} canEdit={canEdit} />
    </>
  );
}

function DeliveryModeSection({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { directory, organization } = useWorkspace();
  const tool = projectDeliveryTool(directory, project.id);
  const modes = modesFor(tool);
  const { run, error } = useCommand();
  const [confirming, setConfirming] = useState<DeliveryMode>();
  const activeIteration = directory.iterations.find(
    (i) => i.projectId === project.id && i.state === "active",
  );
  const switchTo = async (deliveryMode: DeliveryMode) => {
    const ok = await run({
      type: "updateProject",
      projectId: project.id,
      deliveryMode,
    });
    if (ok) setConfirming(undefined);
  };
  return (
    <SettingsSection
      id="delivery-mode"
      icon={<Truck />}
      title="Where work is delivered"
      description="One system owns delivery for all of this project's work. Refinement, reviews and approvals work the same either way."
    >
      <SettingsBody className="space-y-3">
        <div
          role="radiogroup"
          aria-label="Delivery mode"
          className="grid gap-3 sm:grid-cols-2"
        >
          {modes.map((m) => {
            const selected = project.deliveryMode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!canEdit}
                onClick={() =>
                  !selected &&
                  (m.value === "external"
                    ? setConfirming("external")
                    : void switchTo("native"))
                }
                className={cn(
                  "rounded-xl p-4 text-left shadow-(--shadow-border) disabled:cursor-default",
                  selected
                    ? "bg-primary/6 ring-1 ring-primary/40"
                    : "enabled:hover:bg-muted/60",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {m.title}
                  {selected && (
                    <span className="ml-auto grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  {m.summary}
                </span>
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {m.points.map((p) => (
                    <li key={p} className="flex gap-1.5">
                      <span aria-hidden>·</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
        {confirming === "external" && (
          <div className="space-y-2 rounded-lg bg-muted px-4 py-3 text-[13px]">
            {activeIteration ? (
              <>
                <p>
                  Complete the active iteration before handing delivery off to{" "}
                  {tool.name}, so its report is frozen and unfinished work has a
                  home.
                </p>
                <div className="flex gap-2">
                  <Link
                    href={paths.iteration(
                      organization.slug,
                      project.key,
                      activeIteration.id,
                    )}
                    className="contents"
                  >
                    <Button size="sm" variant="secondary">
                      Open active iteration
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(undefined)}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Iterations and estimates will be turned off for this project;{" "}
                  {tool.name} plans them from now on. Boards and backlogs are
                  replaced by the hand-off view. Existing items, specifications
                  and history are kept, and you can switch back later.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void switchTo("external")}>
                    Hand off to {tool.name}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(undefined)}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}

// Deterministic Lictory Actions on pull requests; they work without AI.
function PullRequestActions({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { run, error } = useCommand();
  return (
    <SettingsSection
      id="pull-request-actions"
      icon={<GitPullRequestArrow />}
      title="Pull request actions"
      description="What Lictory does on its own when a specification pull request changes. Actions only notify; people still review and merge."
    >
      <SettingsBody>
        <Choice
          label="Ready to merge notice"
          columns={2}
          value={project.mergeReadyNotice ? "on" : "off"}
          disabled={!canEdit}
          onChange={(value) =>
            void run({
              type: "updateProject",
              projectId: project.id,
              mergeReadyNotice: value === "on",
            })
          }
          options={[
            {
              value: "on",
              label: "Notify when ready to merge",
              description:
                "The author and branch collaborators hear when the last merge requirement is met.",
            },
            {
              value: "off",
              label: "Off",
              description: "People check the merge box themselves.",
            },
          ]}
        />
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}

function ReviewActions({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { directory, isAdmin, organization } = useWorkspace();
  const { run, error } = useCommand();
  return (
    <SettingsSection
      id="review-actions"
      icon={<Sparkles />}
      title="Lictory Intelligence on pull requests"
      description="Whether Lictory Intelligence reviews each commit of a pull request against the specification it implements."
      footer={
        directory.ai.enabled ? undefined : (
          <>
            Lictory Intelligence is turned off for this organization, so this
            policy has no effect.
            {isAdmin && (
              <>
                {" "}
                <Link
                  href={paths.settings(organization.slug, "intelligence")}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Intelligence settings
                </Link>
              </>
            )}
          </>
        )
      }
    >
      <SettingsBody>
        <Choice
          label="Review action policy"
          value={project.aiActionPolicy}
          disabled={!canEdit}
          onChange={(aiActionPolicy) =>
            void run({
              type: "updateProject",
              projectId: project.id,
              aiActionPolicy,
            })
          }
          options={[
            {
              value: "off",
              label: "Off",
              description: "Runs only when someone asks.",
            },
            {
              value: "advisory",
              label: "Advisory",
              description: "Reviews every commit; findings inform.",
            },
            {
              value: "required",
              label: "Required",
              description:
                "Merge waits for a review of the latest commit; blockers open blocking discussions.",
            },
          ]}
        />
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}
