"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Avatar, SectionLabel } from "~/components/ui/primitives";
import { useWorkspace } from "./provider";
import { CreateProject } from "./onboarding";
import { LabelsAndMilestones } from "./labels-settings";

// Organization-level settings. Membership and invitations remain Better Auth
// operations; projects are organization-wide in this baseline.
export function Settings() {
  const { organization, projects, directory, isAdmin, mutate } = useWorkspace();
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-10 px-6 py-8">
        <header>
          <h1 className="text-lg font-semibold tracking-tight">
            Organization settings
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {organization.name} · projects, labels, people and access shared by
            everyone in the organization.
          </p>
        </header>
        <section className="space-y-3">
          <SectionLabel>Projects</SectionLabel>
          <div className="divide-y rounded-lg border">
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                id={p.id}
                name={p.name}
                keyName={p.key}
                canEdit={isAdmin}
                rename={(name) =>
                  mutate({ type: "updateProject", projectId: p.id, name })
                }
              />
            ))}
            {projects.length === 0 && (
              <p className="p-3 text-[13px] text-muted-foreground">
                No projects yet.
              </p>
            )}
          </div>
          {isAdmin &&
            (showCreate ? (
              <div className="rounded-lg border p-4">
                <CreateProject onDone={() => setShowCreate(false)} />
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setShowCreate(true)}>
                Add project
              </Button>
            ))}
        </section>
        <LabelsAndMilestones />
        <section className="space-y-3">
          <SectionLabel>People</SectionLabel>
          <div className="divide-y rounded-lg border">
            {directory.members.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 px-3 py-2 text-[13px]"
              >
                <Avatar name={m.name} size="md" />
                <span className="font-medium">{m.name}</span>
                <span className="text-muted-foreground">{m.email}</span>
              </div>
            ))}
          </div>
          {directory.groups.length > 0 && (
            <div className="text-[13px] text-muted-foreground">
              Groups:{" "}
              {directory.groups
                .map((g) => `${g.name} (${g.userIds.length})`)
                .join(", ")}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Every member can refine, discuss and suggest. Approving a review
            requires an explicit assignment.
          </p>
          {isAdmin && <Invite organizationId={organization.id} />}
        </section>
        {isAdmin && (
          <section className="space-y-3">
            <SectionLabel>Organization</SectionLabel>
            <RenameOrganization
              name={organization.name}
              onRename={async (name) => {
                const result = await authClient.organization.update({
                  organizationId: organization.id,
                  data: { name },
                });
                if (result.error) throw new Error(result.error.message);
                router.refresh();
              }}
            />
          </section>
        )}
      </div>
    </div>
  );
}

function ProjectRow({
  name,
  keyName,
  canEdit,
  rename,
}: {
  id: string;
  name: string;
  keyName: string;
  canEdit: boolean;
  rename: (name: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-[13px]">
      <span className="w-16 font-mono text-xs text-muted-foreground">
        {keyName}
      </span>
      {editing ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (value.trim() && value.trim() !== name)
              await rename(value.trim());
            setEditing(false);
          }}
        >
          <Input
            className="h-8 text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            aria-label="Project name"
          />
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <span className="flex-1 font-medium">{name}</span>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Rename
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function Invite({ organizationId }: { organizationId: string }) {
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <form
      className="space-y-2 rounded-lg border p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        const result = await authClient.organization.inviteMember({
          organizationId,
          email: email.trim(),
          role: "member",
        });
        if (result.error) return setError(result.error.message);
        setUrl(`${window.location.origin}/app/invitation?id=${result.data.id}`);
      }}
    >
      <label className="block text-[13px] font-medium">
        Invite a teammate
        <div className="mt-1.5 flex gap-2">
          <Input
            className="h-8 text-sm"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            required
            aria-label="Teammate email"
          />
          <Button type="submit" size="md">
            Create link
          </Button>
        </div>
      </label>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {url && (
        <label className="block text-xs text-muted-foreground">
          Invitation link — share it; they must sign in with this email.
          <input
            className="mt-1 w-full rounded-md border bg-card p-2 font-mono text-xs"
            readOnly
            value={url}
            aria-label="Invitation link"
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
    </form>
  );
}

function RenameOrganization({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string>();
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await onRename(value.trim());
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not rename.");
        }
      }}
    >
      <label className="block flex-1 text-[13px] font-medium">
        Organization name
        <Input
          className="mt-1.5 h-8 text-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
      </label>
      <Button
        type="submit"
        variant="secondary"
        disabled={value.trim() === name}
      >
        Rename
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
