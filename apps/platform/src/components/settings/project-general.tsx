"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, FolderKanban } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import type { Project } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import { useCommand } from "@lictory/platform/components/settings/project-shared";

export function ProjectGeneral({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { run, error } = useCommand();
  return (
    <>
      <SettingsSection
        id="general"
        icon={<FolderKanban />}
        title="General"
        description="How this project is named across Lictory."
      >
        <SettingsBody className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="font-medium">Name</span>
            <Input
              key={project.name}
              aria-label="Project name"
              className="h-9 text-[13px]"
              defaultValue={project.name}
              disabled={!canEdit}
              maxLength={120}
              onBlur={(e) => {
                const name = e.currentTarget.value.trim();
                if (name && name !== project.name)
                  void run({
                    type: "updateProject",
                    projectId: project.id,
                    name,
                  });
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="font-medium">Description</span>
            <textarea
              key={project.description ?? ""}
              aria-label="Project description"
              rows={3}
              maxLength={2000}
              defaultValue={project.description ?? ""}
              disabled={!canEdit}
              placeholder="What this product area covers, e.g. checkout, payments and refunds."
              className="w-full resize-y rounded-xl border border-input bg-card px-3.5 py-2 text-[13px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-3 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              onBlur={(e) => {
                const description = e.currentTarget.value.trim() || null;
                if (description !== (project.description ?? null))
                  void run({
                    type: "updateProject",
                    projectId: project.id,
                    description,
                  });
              }}
            />
          </label>
          <div className="flex flex-col gap-1 text-[13px]">
            <span className="font-medium">Key</span>
            <span className="flex items-center gap-2">
              <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs font-semibold">
                {project.key}
              </span>
              <span className="text-xs text-muted-foreground">
                Items are numbered {project.key}-1, {project.key}-2… The key
                never changes, so links and references stay valid.
              </span>
            </span>
          </div>
          <InlineError>{error}</InlineError>
        </SettingsBody>
      </SettingsSection>
      <ArchiveProject project={project} />
    </>
  );
}

function ArchiveProject({ project }: { project: Project }) {
  const { isAdmin, organization } = useWorkspace();
  const router = useRouter();
  const { run, error } = useCommand();
  const [confirming, setConfirming] = useState(false);
  const archived = !!project.archivedAt;
  return (
    <SettingsSection
      id="archive"
      icon={archived ? <ArchiveRestore /> : <Archive />}
      title={archived ? "Restore project" : "Archive project"}
      description={
        archived
          ? "This project is archived. Restoring it brings back its board, backlog and work items for everyone."
          : "Archiving removes the project from everyone's navigation and stops new work in it. Items, specifications, reviews and history are kept, and an organization administrator can restore it later."
      }
      action={
        !isAdmin ? undefined : archived ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void run({
                type: "archiveProject",
                projectId: project.id,
                archived: false,
              })
            }
          >
            <ArchiveRestore className="size-3.5" /> Restore
          </Button>
        ) : confirming ? (
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                const ok = await run({
                  type: "archiveProject",
                  projectId: project.id,
                  archived: true,
                });
                if (ok)
                  router.push(paths.settings(organization.slug, "projects"));
              }}
            >
              Archive {project.key}
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setConfirming(true)}
          >
            <Archive className="size-3.5" /> Archive…
          </Button>
        )
      }
      footer={
        isAdmin
          ? undefined
          : "Only organization administrators can archive or restore projects."
      }
    >
      {error ? (
        <SettingsBody>
          <InlineError>{error}</InlineError>
        </SettingsBody>
      ) : null}
    </SettingsSection>
  );
}
