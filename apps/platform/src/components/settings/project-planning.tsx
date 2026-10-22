"use client";
import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import type { Project } from "@lictory/core/lib/work-items";
import type { EstimateScale } from "@lictory/core/contracts/protocol";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import {
  Choice,
  Field,
  useCommand,
  type UpdateProject,
} from "@lictory/platform/components/settings/project-shared";

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function ProjectPlanning({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { organization } = useWorkspace();
  const { run, error } = useCommand();
  const external = project.deliveryMode === "external";
  const editable = canEdit && !external;
  const update = (patch: UpdateProject) =>
    void run({ type: "updateProject", projectId: project.id, ...patch });
  return (
    <SettingsSection
      id="planning"
      icon={<CalendarRange />}
      title="Planning"
      description="How this project plans and sizes work. Sprints are planned and started by hand; cycles start and complete on a schedule and roll unfinished work forward."
    >
      <SettingsBody className="space-y-5">
        {external && (
          <p className="rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            This project hands work off to Jira, so iterations and estimates are
            planned there.{" "}
            <Link
              href={paths.projectSettings(
                organization.slug,
                project.key,
                "delivery",
              )}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Delivery settings
            </Link>
          </p>
        )}
        <Field label="Iterations">
          <Choice
            label="Iterations"
            value={project.iterationMode}
            disabled={!editable}
            onChange={(iterationMode) => update({ iterationMode })}
            options={[
              { value: "off", label: "None", description: "A ranked backlog." },
              {
                value: "manual",
                label: "Sprints",
                description: "Plan, start and complete by hand.",
              },
              {
                value: "automatic",
                label: "Cycles",
                description: "Scheduled, with automatic rollover.",
              },
            ]}
          />
        </Field>
        {project.iterationMode !== "off" && (
          <div className="flex flex-wrap gap-4">
            <label className="text-[13px]">
              <span className="font-medium">Length</span>
              <DropdownSelect
                disabled={!editable}
                className="mt-1 w-full"
                aria-label="Iteration length"
                value={project.iterationWeeks}
                onValueChange={(value) =>
                  update({ iterationWeeks: Number(value) })
                }
              >
                {[1, 2, 3, 4, 6, 8].map((w) => (
                  <DropdownSelectOption key={w} value={w}>
                    {w} week{w > 1 ? "s" : ""}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
            </label>
            {project.iterationMode === "automatic" && (
              <>
                <label className="text-[13px]">
                  <span className="font-medium">Starts on</span>
                  <DropdownSelect
                    disabled={!editable}
                    className="mt-1 w-full"
                    aria-label="Cycle start day"
                    value={project.iterationStartDay}
                    onValueChange={(value) =>
                      update({ iterationStartDay: Number(value) })
                    }
                  >
                    {weekdays.map((d, i) => (
                      <DropdownSelectOption key={d} value={i}>
                        {d}
                      </DropdownSelectOption>
                    ))}
                  </DropdownSelect>
                </label>
                <label className="text-[13px]">
                  <span className="font-medium">Upcoming cycles</span>
                  <DropdownSelect
                    disabled={!editable}
                    className="mt-1 w-full"
                    aria-label="Upcoming cycles"
                    value={project.upcomingIterations}
                    onValueChange={(value) =>
                      update({ upcomingIterations: Number(value) })
                    }
                  >
                    {[0, 1, 2, 3, 4, 6].map((n) => (
                      <DropdownSelectOption key={n} value={n}>
                        {n}
                      </DropdownSelectOption>
                    ))}
                  </DropdownSelect>
                </label>
              </>
            )}
          </div>
        )}
        <Field label="Estimates">
          <DropdownSelect
            disabled={!editable}
            className="w-full"
            aria-label="Estimate scale"
            value={project.estimateScale}
            onValueChange={(value) =>
              update({ estimateScale: value as EstimateScale })
            }
          >
            <DropdownSelectOption value="none">
              No estimates
            </DropdownSelectOption>
            <DropdownSelectOption value="fibonacci">
              Points (0, 1, 2, 3, 5, 8, 13, 21)
            </DropdownSelectOption>
            <DropdownSelectOption value="linear">
              Points (0–8)
            </DropdownSelectOption>
            <DropdownSelectOption value="tshirt">
              T-shirt sizes (XS–XL)
            </DropdownSelectOption>
          </DropdownSelect>
        </Field>
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}
