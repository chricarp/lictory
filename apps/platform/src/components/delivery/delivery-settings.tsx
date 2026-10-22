"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Loader2, PlugZap, Plus } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { paths } from "@lictory/core/lib/paths";
import { enabledTypes, type Project } from "@lictory/core/lib/work-items";
import type {
  DeliveryConnectionSummary,
  DeliveryTargetSummary,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Input } from "@lictory/ui/input";
import { Badge } from "@lictory/ui/primitives";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

type ExternalType = {
  id: string;
  name: string;
  hierarchyLevel: number;
  unsupportedRequiredFields: { id: string; name: string }[];
};
type ExternalProject = {
  id: string;
  key: string;
  name: string;
  types: ExternalType[];
};
type ExternalProjectSummary = Omit<ExternalProject, "types">;

const message = (e: unknown) =>
  e instanceof Error ? e.message : "The request failed. Try again.";

function ConnectionStatus({
  connection,
}: {
  connection: DeliveryConnectionSummary;
}) {
  return connection.status === "active" ? (
    <Badge tone="good">Connected</Badge>
  ) : (
    <Badge tone="danger">Needs attention</Badge>
  );
}

// Organization settings: Jira sites Lictory can hand work off to. The API token
// is sent once to the server, verified against Jira, stored encrypted, and
// never returned.
export function JiraConnections() {
  const { directory, isAdmin, projects } = useWorkspace();
  const connections = directory.delivery.connections;
  const [connecting, setConnecting] = useState<{ baseUrl?: string } | null>(
    null,
  );
  return (
    <SettingsSection
      id="jira"
      icon={<PlugZap />}
      title="Jira"
      description="Connect a Jira Cloud site once; each project that hands work off to Jira then picks one of its Jira projects in its own delivery settings."
      action={
        isAdmin && !connecting ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setConnecting({})}
          >
            <Plus className="size-3.5" /> Connect Jira
          </Button>
        ) : undefined
      }
      footer="Lictory writes the summary, description (latest revision with acceptance criteria) and labels of handed-off issues. Status, assignee, sprint and comments stay owned by Jira."
    >
      {connecting && (
        <ConnectForm
          initialUrl={connecting.baseUrl}
          onDone={() => setConnecting(null)}
        />
      )}
      <SettingsList
        isEmpty={connections.length === 0}
        empty={
          isAdmin
            ? "Jira is not connected. Connect a site to let projects hand work off to it."
            : "Jira is not connected. Organization administrators can connect it."
        }
      >
        {connections.map((c) => (
          <ConnectionRow
            key={c.id}
            connection={c}
            canEdit={isAdmin}
            usedBy={directory.delivery.targets
              .filter((t) => t.connectionId === c.id)
              .map(
                (t) =>
                  projects.find((p) => p.id === t.projectId)?.name ??
                  "Archived project",
              )}
            onReplace={() => setConnecting({ baseUrl: c.baseUrl })}
          />
        ))}
      </SettingsList>
    </SettingsSection>
  );
}

function ConnectionRow({
  connection,
  canEdit,
  usedBy,
  onReplace,
}: {
  connection: DeliveryConnectionSummary;
  canEdit: boolean;
  usedBy: string[];
  onReplace: () => void;
}) {
  const { organization, engine } = useWorkspace();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-1.5 px-5 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={connection.baseUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
        >
          {connection.name} <ArrowUpRight className="size-3" />
        </a>
        <ConnectionStatus connection={connection} />
        <span className="text-muted-foreground">
          as {connection.accountLabel}
        </span>
        {canEdit && (
          <span className="ml-auto flex gap-1">
            {confirming ? (
              <>
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
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(undefined);
                    try {
                      await callCapability("disconnectDelivery", {
                        organizationId: organization.id,
                        connectionId: connection.id,
                      });
                      await engine.sync();
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setBusy(false);
                      setConfirming(false);
                    }
                  }}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={onReplace}>
                  Replace token
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirming(true)}
                >
                  Disconnect…
                </Button>
              </>
            )}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {usedBy.length
          ? `Used by ${usedBy.join(", ")}.`
          : "No project hands work off here yet."}
      </p>
      {confirming && (
        <p className="text-xs text-muted-foreground">
          {usedBy.length
            ? `${usedBy.join(", ")} will stop handing work off until a project administrator chooses another Jira project. `
            : ""}
          Existing links keep their history; reconnecting the same site restores
          them.
        </p>
      )}
      {connection.lastError && (
        <p className="text-xs text-destructive">{connection.lastError}</p>
      )}
      <InlineError>{error}</InlineError>
    </div>
  );
}

function ConnectForm({
  initialUrl,
  onDone,
}: {
  initialUrl?: string;
  onDone: () => void;
}) {
  const { organization, engine } = useWorkspace();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialUrl ?? "");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <SettingsBody className="border-b bg-muted/40">
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            await callCapability("connectDelivery", {
              organizationId: organization.id,
              name,
              baseUrl,
              email,
              apiToken,
            });
            setApiToken("");
            await engine.sync();
            onDone();
          } catch (err) {
            setError(message(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="grid gap-1 text-[13px]">
          Jira site
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-company.atlassian.net"
            className="h-9 text-[13px]"
            readOnly={!!initialUrl}
            required
          />
        </label>
        {!initialUrl && (
          <label className="grid gap-1 text-[13px]">
            Name (optional)
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Defaults to the site's host name"
              className="h-9 text-[13px]"
              maxLength={120}
            />
          </label>
        )}
        <label className="grid gap-1 text-[13px]">
          Account email
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="The Atlassian account Lictory acts as"
            className="h-9 text-[13px]"
            required
          />
        </label>
        <label className="grid gap-1 text-[13px]">
          API token
          <Input
            type="password"
            autoComplete="off"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            className="h-9 text-[13px]"
            required
          />
          <span className="text-xs text-muted-foreground">
            Create one at{" "}
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              id.atlassian.com
            </a>
            . Issues are created as this account.
          </span>
        </label>
        <InlineError>{error}</InlineError>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {initialUrl ? "Verify and replace token" : "Verify and connect"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </SettingsBody>
  );
}

// Project delivery settings: the Jira project this project hands work off to,
// on one of the organization's connections, and how its types map.
export function ProjectHandoffTarget({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { directory, isAdmin, organization } = useWorkspace();
  const connections = directory.delivery.connections;
  const target = directory.delivery.targets.find(
    (t) => t.projectId === project.id,
  );
  const connection = connections.find((c) => c.id === target?.connectionId);
  const [editing, setEditing] = useState(false);
  return (
    <SettingsSection
      id="handoff"
      icon={<PlugZap />}
      title="Jira hand-off"
      description="The Jira project ready work from this project is exported to, and which Jira issue type each work item type becomes."
      footer="Lictory writes the summary, description and labels. Status, assignee, sprint and comments stay owned by Jira and are read back on the hand-off view."
    >
      {connections.length === 0 ? (
        <SettingsBody>
          <p className="text-[13px] text-muted-foreground">
            Jira is not connected to this organization yet.{" "}
            {isAdmin ? (
              <Link
                href={paths.settings(organization.slug, "integrations")}
                className="font-medium text-foreground underline underline-offset-2"
              >
                Connect Jira in organization settings
              </Link>
            ) : (
              "Ask an organization administrator to connect Jira."
            )}
          </p>
        </SettingsBody>
      ) : editing ? (
        <TargetEditor
          project={project}
          target={target}
          onDone={() => setEditing(false)}
        />
      ) : (
        <TargetSummary
          project={project}
          target={target}
          connection={connection}
          canEdit={canEdit}
          onEdit={() => setEditing(true)}
        />
      )}
    </SettingsSection>
  );
}

function TargetSummary({
  project,
  target,
  connection,
  canEdit,
  onEdit,
}: {
  project: Project;
  target?: DeliveryTargetSummary;
  connection?: DeliveryConnectionSummary;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { organization, delivery, engine } = useWorkspace();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const types = enabledTypes(delivery, project.id);
  if (!target)
    return (
      <SettingsBody className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-[13px] text-muted-foreground">
          No Jira project chosen yet. Nothing can be handed off until one is.
        </p>
        {canEdit && (
          <Button size="sm" onClick={onEdit}>
            Choose Jira project
          </Button>
        )}
      </SettingsBody>
    );
  const unmapped = types.filter((t) => !target.typeMapping[t.id]);
  return (
    <SettingsBody className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span>
          Hands off to{" "}
          <span className="font-semibold">{target.externalProjectKey}</span>
          {connection && (
            <span className="text-muted-foreground"> on {connection.name}</span>
          )}
        </span>
        {connection && <ConnectionStatus connection={connection} />}
        {canEdit && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="secondary" onClick={onEdit}>
              Change
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title="Existing links keep their history."
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                try {
                  await callCapability("removeDeliveryTarget", {
                    organizationId: organization.id,
                    projectId: project.id,
                  });
                  await engine.sync();
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove
            </Button>
          </span>
        )}
      </div>
      {connection?.lastError && (
        <p className="text-xs text-destructive">{connection.lastError}</p>
      )}
      <ul className="space-y-1 text-[13px]">
        {types.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <TypeIcon type={t} />
            <span className="w-28 truncate">{t.name}</span>
            <span className="text-muted-foreground">
              {target.typeMapping[t.id] ? "Mapped" : "Not exported"}
            </span>
          </li>
        ))}
      </ul>
      {unmapped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {unmapped.map((t) => t.name).join(", ")}{" "}
          {unmapped.length === 1 ? "is" : "are"} not exported. Map{" "}
          {unmapped.length === 1 ? "it" : "them"} to a Jira issue type to hand
          {unmapped.length === 1 ? " it" : " them"} off.
        </p>
      )}
      <InlineError>{error}</InlineError>
    </SettingsBody>
  );
}

function suggestMapping(
  types: ReturnType<typeof enabledTypes>,
  external: ExternalType[],
) {
  const suggested: Record<string, string> = {};
  for (const t of types) {
    const byName = external.find(
      (x) => x.name.toLowerCase() === t.name.toLowerCase(),
    );
    const level = t.level >= 2 ? 1 : t.level === 0 ? -1 : 0;
    const byLevel = external.find((x) => x.hierarchyLevel === level);
    const pick = byName ?? byLevel;
    if (pick && !pick.unsupportedRequiredFields.length)
      suggested[t.id] = pick.id;
  }
  return suggested;
}

function TargetEditor({
  project,
  target,
  onDone,
}: {
  project: Project;
  target?: DeliveryTargetSummary;
  onDone: () => void;
}) {
  const { organization, directory, delivery, engine } = useWorkspace();
  const connections = directory.delivery.connections;
  const [connectionId, setConnectionId] = useState(
    target?.connectionId ?? connections[0]?.id ?? "",
  );
  const [projects, setProjects] = useState<ExternalProjectSummary[]>();
  const [external, setExternal] = useState<ExternalProject>();
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const types = enabledTypes(delivery, project.id);
  const request = async <T,>(
    name: string,
    input: Record<string, unknown>,
  ): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await callCapability<T>(name, {
        organizationId: organization.id,
        connectionId,
        projectId: project.id,
        ...input,
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const listProjects = async (id = connectionId) => {
    setExternal(undefined);
    const list = await request<ExternalProjectSummary[]>(
      "listDeliveryProjects",
      { connectionId: id },
    );
    if (list) setProjects(list);
  };
  const choose = async (key: string) => {
    const described = await request<ExternalProject>(
      "describeDeliveryProject",
      { projectKey: key },
    );
    if (!described) return;
    setExternal(described);
    const suggested = suggestMapping(types, described.types);
    setMapping(
      target?.connectionId === connectionId &&
        target.externalProjectKey === described.key
        ? { ...suggested, ...target.typeMapping }
        : suggested,
    );
  };
  return (
    <SettingsBody className="space-y-4">
      {connections.length > 1 && (
        <label className="grid gap-1 text-[13px]">
          <span className="font-medium">Jira site</span>
          <DropdownSelect
            aria-label="Jira connection"
            className="w-full"
            value={connectionId}
            onValueChange={(id) => {
              setConnectionId(id);
              setProjects(undefined);
              setExternal(undefined);
            }}
          >
            {connections.map((c) => (
              <DropdownSelectOption key={c.id} value={c.id}>
                {c.name} · {c.accountLabel}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
        </label>
      )}
      <div className="grid gap-1 text-[13px]">
        <span className="font-medium">Jira project</span>
        {projects ? (
          <DropdownSelect
            placeholder={
              projects.length
                ? "Select a Jira project…"
                : "No projects visible to this Jira account"
            }
            aria-label="Jira project"
            className="w-full"
            value={external?.key ?? ""}
            disabled={busy || !projects.length}
            onValueChange={(key) => void choose(key)}
          >
            {projects.map((p) => (
              <DropdownSelectOption key={p.id} value={p.key}>
                {p.key} · {p.name}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {target && (
              <span className="text-muted-foreground">
                Currently {target.externalProjectKey}
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !connectionId}
              onClick={() => void listProjects()}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Load Jira projects
            </Button>
            {target?.connectionId === connectionId && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void choose(target.externalProjectKey)}
              >
                Edit type mapping
              </Button>
            )}
          </div>
        )}
      </div>
      {external && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const saved = await request("setDeliveryTarget", {
              projectKey: external.key,
              typeMapping: Object.fromEntries(
                Object.entries(mapping).filter(
                  ([typeId, v]) => v && types.some((t) => t.id === typeId),
                ),
              ),
            });
            if (saved) {
              await engine.sync();
              onDone();
            }
          }}
        >
          <p className="text-[13px] font-medium">
            Issue types in {external.key}
          </p>
          {types.map((t) => {
            const chosen = external.types.find((x) => x.id === mapping[t.id]);
            return (
              <div key={t.id} className="grid gap-1">
                <label className="flex items-center gap-2 text-[13px]">
                  <TypeIcon type={t} />
                  <span className="w-28 shrink-0 truncate">{t.name}</span>
                  <DropdownSelect
                    className="min-w-0 flex-1"
                    aria-label={`${t.name} Jira issue type`}
                    value={mapping[t.id] ?? ""}
                    onValueChange={(value) =>
                      setMapping((m) => ({ ...m, [t.id]: value }))
                    }
                  >
                    <DropdownSelectOption value="">
                      Not exported
                    </DropdownSelectOption>
                    {external.types.map((x) => (
                      <DropdownSelectOption key={x.id} value={x.id}>
                        {x.name}
                      </DropdownSelectOption>
                    ))}
                  </DropdownSelect>
                </label>
                {chosen?.unsupportedRequiredFields.length ? (
                  <p className="pl-36 text-xs text-destructive">
                    Jira requires{" "}
                    {chosen.unsupportedRequiredFields
                      .map((f) => f.name)
                      .join(", ")}{" "}
                    on {chosen.name}, which Lictory cannot fill. Give it a
                    default in Jira or pick another type.
                  </p>
                ) : null}
              </div>
            );
          })}
          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Save hand-off target
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!external && (
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      )}
      <InlineError>{error}</InlineError>
    </SettingsBody>
  );
}
