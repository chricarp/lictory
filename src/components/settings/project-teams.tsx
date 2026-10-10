"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Plus,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import { projectTeams, type Project } from "~/lib/work-items";
import type { Team } from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover } from "~/components/ui/popover";
import { PeoplePicker } from "~/components/ui/people-picker";
import { Avatar, Badge } from "~/components/ui/primitives";
import { Tooltip } from "~/components/ui/tooltip";
import { useWorkspace } from "~/components/workspace/provider";
import {
  SettingsList,
  SettingsSection,
} from "~/components/workspace/settings-section";
import { SectionError, plural, useCommand } from "./project-shared";

export function ProjectTeams({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { delivery } = useWorkspace();
  const { run, error } = useCommand();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const all = projectTeams(delivery, project.id).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const archived = all.filter((t) => t.archivedAt);
  const shown = all.filter((t) => showArchived || !t.archivedAt);
  return (
    <SettingsSection
      id="teams"
      icon={<UsersRound />}
      title="Teams"
      description="Teams are groups of people working on one vertical of this project, such as Checkout or Platform. Every team follows the project's workflow and planning; boards and backlogs can be narrowed to a team. Items don't need a team."
      action={
        canEdit && !creating ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-3.5" /> Add team
          </Button>
        ) : undefined
      }
      footer="Archiving a team keeps its items and history; they simply show no active team until it is restored."
    >
      {creating && (
        <NewTeam
          onCancel={() => setCreating(false)}
          onCreate={async (draft) => {
            const ok = await run({
              type: "createTeam",
              projectId: project.id,
              teamId: crypto.randomUUID(),
              ...draft,
            });
            if (ok) setCreating(false);
          }}
        />
      )}
      <SettingsList
        isEmpty={shown.length === 0}
        empty={
          canEdit
            ? "No teams yet. Add one when several groups work in this project."
            : "No teams yet."
        }
      >
        {shown.map((t) => (
          <TeamRow
            key={t.id}
            team={t}
            project={project}
            canEdit={canEdit}
            run={run}
          />
        ))}
      </SettingsList>
      {archived.length > 0 && (
        <div className="border-t px-5 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </Button>
        </div>
      )}
      <SectionError error={error} />
    </SettingsSection>
  );
}

function TeamRow({
  team: t,
  project,
  canEdit,
  run,
}: {
  team: Team;
  project: Project;
  canEdit: boolean;
  run: ReturnType<typeof useCommand>["run"];
}) {
  const { organization, memberName, items } = useWorkspace();
  const editable = canEdit && !t.archivedAt;
  const count = items.filter((i) => i.teamId === t.id && !i.archivedAt).length;
  const update = (patch: {
    name?: string;
    description?: string | null;
    archived?: boolean;
  }) =>
    void run({
      type: "updateTeam",
      projectId: project.id,
      teamId: t.id,
      ...patch,
    });
  const linkClass =
    "inline-flex items-center gap-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline";
  return (
    <div className={cn("space-y-2 px-5 py-3", t.archivedAt && "opacity-70")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input
              key={t.name}
              defaultValue={t.name}
              disabled={!editable}
              maxLength={60}
              aria-label={`Team name ${t.name}`}
              className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 text-[13px] font-semibold outline-none focus:bg-muted enabled:hover:bg-muted"
              onBlur={(e) => {
                const name = e.currentTarget.value.trim();
                if (name && name !== t.name) update({ name });
                else e.currentTarget.value = t.name;
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            {t.archivedAt && <Badge>Archived</Badge>}
          </div>
          <input
            key={t.description ?? ""}
            defaultValue={t.description ?? ""}
            disabled={!editable}
            maxLength={500}
            placeholder={
              editable ? "What this team works on" : "No description"
            }
            aria-label={`Description of ${t.name}`}
            className="h-7 w-full rounded-md bg-transparent px-1 text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-muted enabled:hover:bg-muted"
            onBlur={(e) => {
              const description = e.currentTarget.value.trim() || null;
              if (description !== (t.description ?? null))
                update({ description });
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
        {canEdit && (
          <Tooltip label={t.archivedAt ? "Restore" : "Archive"}>
            <Button
              size="icon"
              variant="ghost"
              aria-label={
                t.archivedAt
                  ? `Restore team ${t.name}`
                  : `Archive team ${t.name}`
              }
              onClick={() => update({ archived: !t.archivedAt })}
            >
              {t.archivedAt ? (
                <ArchiveRestore className="size-3.5" />
              ) : (
                <Archive className="size-3.5" />
              )}
            </Button>
          </Tooltip>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-1">
        <div className="flex items-center gap-1.5">
          <div className="flex -space-x-1">
            {t.memberIds.slice(0, 8).map((id) => (
              <Avatar
                key={id}
                name={memberName(id)}
                size="md"
                className="ring-2 ring-card"
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {t.memberIds.length
              ? plural(t.memberIds.length, "member")
              : "No members"}
          </span>
          {editable && (
            <Popover
              width={260}
              trigger={(props) => (
                <Button
                  {...props}
                  size="sm"
                  variant="ghost"
                  aria-label={`Manage members of ${t.name}`}
                >
                  <UserPlus className="size-3.5" /> Members
                </Button>
              )}
            >
              <PeoplePicker
                multiple
                title={`${t.name} members`}
                value={t.memberIds}
                onSelect={(userId) =>
                  void run({
                    type: "setTeamMembership",
                    projectId: project.id,
                    teamId: t.id,
                    userId,
                    member: !t.memberIds.includes(userId),
                  })
                }
              />
            </Popover>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {project.deliveryMode === "native" && (
            <>
              <Link
                href={paths.board(organization.slug, project.key, t.id)}
                className={linkClass}
              >
                Board <ArrowUpRight className="size-3" />
              </Link>
              <Link
                href={paths.backlog(organization.slug, project.key, t.id)}
                className={linkClass}
              >
                Backlog <ArrowUpRight className="size-3" />
              </Link>
            </>
          )}
          <Link
            href={paths.list(
              organization.slug,
              project.key,
              "stories",
              new URLSearchParams({ team: t.id }),
            )}
            className={linkClass}
          >
            {plural(count, "item")} <ArrowUpRight className="size-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function NewTeam({
  onCreate,
  onCancel,
}: {
  onCreate: (draft: { name: string; description?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void onCreate({
          name: name.trim(),
          description: description.trim() || undefined,
        });
      }}
    >
      <Input
        autoFocus
        className="h-8 w-44 text-sm"
        placeholder="Team name, e.g. Checkout"
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Team name"
      />
      <Input
        className="h-8 min-w-0 flex-1 text-sm"
        placeholder="What it works on (optional)"
        maxLength={500}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        aria-label="Team description"
      />
      <Button size="sm" type="submit" disabled={!name.trim()}>
        Create
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
