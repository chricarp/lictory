import { Link } from "@lictory/platform/lib/navigation";
import { Plus, Users } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import type { Project } from "@lictory/core/lib/work-items";
import type { ProjectRole } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Popover } from "@lictory/ui/popover";
import { PeoplePicker } from "@lictory/platform/components/ui/people-picker";
import { Avatar, Badge } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import {
  SectionError,
  plural,
  useCommand,
} from "@lictory/platform/components/settings/project-shared";

export function ProjectMembers({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { directory, userId, organization } = useWorkspace();
  const { run, error } = useCommand();
  const roles = new Map(
    directory.projectMembers
      .filter((m) => m.projectId === project.id)
      .map((m) => [m.userId, m.role]),
  );
  const disciplines = directory.disciplines.filter(
    (d) => d.projectId === project.id && !d.archivedAt,
  );
  const people = directory.members
    .filter((m) => roles.has(m.id) || m.role === "admin")
    .sort(
      (a, b) =>
        Number(roles.has(b.id)) - Number(roles.has(a.id)) ||
        a.name.localeCompare(b.name),
    );
  const setRole = (memberId: string, role: ProjectRole | null) =>
    void run({
      type: "setProjectMember",
      projectId: project.id,
      userId: memberId,
      role,
    });
  return (
    <SettingsSection
      id="members"
      icon={<Users />}
      title="Members"
      description={
        <>
          Project admins configure this project. Disciplines decide what people
          can do with work items.{" "}
          <Link
            href={paths.projectSettings(
              organization.slug,
              project.key,
              "disciplines",
            )}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Edit disciplines
          </Link>
        </>
      }
      action={
        canEdit ? (
          <Popover
            width={280}
            align="end"
            trigger={(props) => (
              <Button {...props} size="sm" variant="secondary">
                <Plus className="size-3.5" /> Add people
              </Button>
            )}
          >
            <PeoplePicker
              title="Add to project"
              excludeIds={[...roles.keys()]}
              onSelect={(id) => setRole(id, "member")}
            />
          </Popover>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {plural(roles.size, "member")}
          </span>
        )
      }
      footer="Organization administrators manage every project without being listed as members. Removing someone from the project also removes their disciplines and team memberships here."
    >
      <SettingsList isEmpty={people.length === 0} empty="No members yet.">
        {people.map((m) => {
          const role = roles.get(m.id);
          return (
            <div
              key={m.id}
              className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 text-[13px]"
            >
              <Avatar image={m.image} name={m.name} size="md" />
              <div className="min-w-0 flex-1 basis-40">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {m.name}
                    {m.id === userId && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        (you)
                      </span>
                    )}
                  </span>
                  {m.role === "admin" && (
                    <Badge tone="info">Organization admin</Badge>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {m.email}
                </div>
              </div>
              {role ? (
                <>
                  <div
                    role="group"
                    className="flex flex-wrap gap-1"
                    aria-label={`Disciplines of ${m.name}`}
                  >
                    {disciplines.map((d) => {
                      const held = d.userIds.includes(m.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          aria-pressed={held}
                          disabled={!canEdit}
                          title={
                            canEdit
                              ? `${held ? "Remove from" : "Add to"} ${d.name}`
                              : undefined
                          }
                          onClick={() =>
                            void run({
                              type: "setDisciplineMember",
                              projectId: project.id,
                              disciplineId: d.id,
                              userId: m.id,
                              member: !held,
                            })
                          }
                          className={cn(
                            "h-6 rounded-full px-2 text-xs transition-colors disabled:cursor-default",
                            held
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground shadow-(--shadow-border) enabled:hover:bg-muted",
                            !canEdit && !held && "hidden",
                          )}
                        >
                          {d.name}
                        </button>
                      );
                    })}
                    {!canEdit &&
                      !disciplines.some((d) => d.userIds.includes(m.id)) && (
                        <span className="text-xs text-muted-foreground">
                          No discipline
                        </span>
                      )}
                  </div>
                  <DropdownSelect
                    size="sm"
                    className="w-28"
                    aria-label={`Project role of ${m.name}`}
                    disabled={!canEdit}
                    value={role}
                    onValueChange={(value) =>
                      setRole(m.id, value as ProjectRole)
                    }
                  >
                    <DropdownSelectOption value="admin">
                      Admin
                    </DropdownSelectOption>
                    <DropdownSelectOption value="member">
                      Member
                    </DropdownSelectOption>
                  </DropdownSelect>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Remove ${m.name} from ${project.name}`}
                      onClick={() => setRole(m.id, null)}
                    >
                      Remove
                    </Button>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Manages every project
                  {canEdit && (
                    <button
                      type="button"
                      className="ml-2 underline underline-offset-2 hover:text-foreground"
                      onClick={() => setRole(m.id, "member")}
                    >
                      Add as member
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </SettingsList>
      <SectionError error={error} />
    </SettingsSection>
  );
}
