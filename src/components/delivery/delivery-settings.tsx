"use client";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "~/components/ui/dropdown-select";
import { useState } from "react";
import { ArrowUpRight, Loader2, PlugZap } from "lucide-react";
import type { DeliveryConnectionSummary } from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
  SettingsSubheading,
} from "~/components/workspace/settings-section";
import { deliveryRequest } from "./export";

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

// Jira connection and where exported work lands. The API token is sent once
// to the server, verified against Jira, stored encrypted, and never returned.
export function JiraSection() {
  const { directory, isAdmin } = useWorkspace();
  const connection = directory.delivery.connections[0];
  const [replacing, setReplacing] = useState(false);
  return (
    <SettingsSection
      id="jira"
      icon={<PlugZap />}
      title="Jira"
      description="Export ready Epics and Stories to Jira Cloud, and keep exported issues up to date on each export."
      footer="Lictory writes the summary, description (latest revision with acceptance criteria) and labels. Status, assignee, sprint and comments stay owned by Jira."
    >
      {connection && !replacing ? (
        <>
          <ConnectionRow
            connection={connection}
            onReplace={() => setReplacing(true)}
          />
          <TargetEditor connection={connection} />
        </>
      ) : isAdmin ? (
        <ConnectForm
          initialUrl={connection?.baseUrl}
          onDone={() => setReplacing(false)}
          onCancel={connection ? () => setReplacing(false) : undefined}
        />
      ) : (
        <SettingsBody>
          <p className="text-[13px] text-muted-foreground">
            Jira is not connected. Ask an administrator to connect it.
          </p>
        </SettingsBody>
      )}
    </SettingsSection>
  );
}

function ConnectionRow({
  connection,
  onReplace,
}: {
  connection: DeliveryConnectionSummary;
  onReplace: () => void;
}) {
  const { organization, isAdmin } = useWorkspace();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <SettingsBody className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <a
          href={connection.baseUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
        >
          {connection.name} <ArrowUpRight className="size-3" />
        </a>
        {connection.status === "active" ? (
          <Badge tone="good">Connected</Badge>
        ) : (
          <Badge tone="danger">Needs attention</Badge>
        )}
        <span className="text-muted-foreground">
          as {connection.accountLabel}
        </span>
        {isAdmin && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="secondary" onClick={onReplace}>
              Replace token
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title="Existing links are kept; reconnecting the same site restores them."
              onClick={async () => {
                setBusy(true);
                try {
                  await deliveryRequest({
                    action: "disconnect",
                    organizationId: organization.id,
                    connectionId: connection.id,
                  });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Disconnect
            </Button>
          </span>
        )}
      </div>
      {connection.lastError && (
        <p className="text-xs text-destructive">{connection.lastError}</p>
      )}
      <InlineError>{error}</InlineError>
    </SettingsBody>
  );
}

function ConnectForm({
  initialUrl,
  onDone,
  onCancel,
}: {
  initialUrl?: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { organization } = useWorkspace();
  const [baseUrl, setBaseUrl] = useState(initialUrl ?? "");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <SettingsBody>
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            await deliveryRequest({
              action: "connect",
              organizationId: organization.id,
              baseUrl,
              email,
              apiToken,
            });
            setApiToken("");
            onDone();
          } catch (err) {
            setError((err as Error).message);
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
            required
          />
        </label>
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
            Verify and connect
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </SettingsBody>
  );
}

// Organization default target: Jira project and type mapping.
function TargetEditor({
  connection,
}: {
  connection: DeliveryConnectionSummary;
}) {
  const { organization, directory, isAdmin } = useWorkspace();
  const target = directory.delivery.targets.find(
    (t) => t.teamId === null && t.connectionId === connection.id,
  );
  const [projects, setProjects] =
    useState<{ id: string; key: string; name: string }[]>();
  const [project, setProject] = useState<ExternalProject>();
  const [mapping, setMapping] = useState<Record<string, string>>(
    target?.typeMapping ?? {},
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const types = directory.types.filter((t) => !t.archivedAt);
  const load = async <T,>(body: Record<string, unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      return await deliveryRequest<T>({
        organizationId: organization.id,
        connectionId: connection.id,
        ...body,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choose = async (key: string) => {
    const described = await load<ExternalProject>({
      action: "describeProject",
      projectKey: key,
    });
    if (!described) return;
    setProject(described);
    // Suggest the obvious mapping by name and hierarchy.
    const suggested: Record<string, string> = {};
    for (const t of types) {
      const byName = described.types.find(
        (x) => x.name.toLowerCase() === t.name.toLowerCase(),
      );
      const byLevel = described.types.find(
        (x) => x.hierarchyLevel === (t.level >= 2 ? 1 : t.level === 0 ? -1 : 0),
      );
      const pick = byName ?? byLevel;
      if (pick) suggested[t.id] = pick.id;
    }
    setMapping(
      target?.externalProjectKey === described.key
        ? { ...suggested, ...target.typeMapping }
        : suggested,
    );
  };
  if (!isAdmin)
    return (
      <SettingsBody className="text-[13px] text-muted-foreground">
        {target
          ? `Exports go to Jira project ${target.externalProjectKey}.`
          : "No Jira project chosen yet."}
      </SettingsBody>
    );
  return (
    <>
      <SettingsSubheading
        action={
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={async () =>
              setProjects(
                await load<{ id: string; key: string; name: string }[]>({
                  action: "listProjects",
                }),
              )
            }
          >
            {target || project ? "Change project" : "Choose project"}
          </Button>
        }
      >
        Default project{" "}
        <span className="font-normal text-muted-foreground">
          {project
            ? `${project.key} · ${project.name}`
            : (target?.externalProjectKey ?? "none")}
        </span>
      </SettingsSubheading>
      <SettingsBody className="space-y-3 pt-0">
        {projects && !project && (
          <DropdownSelect
            placeholder={
              projects.length
                ? "Select a Jira project…"
                : "No projects visible to this account"
            }
            aria-label="Jira project"
            className="w-full"
            defaultValue=""
            onValueChange={(value) => void choose(value)}
          >
            {projects.map((p) => (
              <DropdownSelectOption key={p.id} value={p.key}>
                {p.key} · {p.name}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
        )}
        {!project && target && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void choose(target.externalProjectKey)}
          >
            Edit type mapping
          </Button>
        )}
        {project && (
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const saved = await load({
                action: "setTarget",
                teamId: null,
                projectKey: project.key,
                typeMapping: Object.fromEntries(
                  Object.entries(mapping).filter(([, v]) => v),
                ),
              });
              if (saved) {
                setProject(undefined);
                setProjects(undefined);
              }
            }}
          >
            {types.map((t) => {
              const chosen = project.types.find((x) => x.id === mapping[t.id]);
              return (
                <div key={t.id} className="grid gap-1">
                  <label className="flex items-center gap-2 text-[13px]">
                    <span className="w-24 shrink-0">{t.name}</span>
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
                      {project.types.map((x) => (
                        <DropdownSelectOption key={x.id} value={x.id}>
                          {x.name}
                        </DropdownSelectOption>
                      ))}
                    </DropdownSelect>
                  </label>
                  {chosen?.unsupportedRequiredFields.length ? (
                    <p className="pl-26 text-xs text-destructive">
                      Jira requires{" "}
                      {chosen.unsupportedRequiredFields
                        .map((f) => f.name)
                        .join(", ")}{" "}
                      on {chosen.name}. Give it a default in Jira or pick
                      another type.
                    </p>
                  ) : null}
                </div>
              );
            })}
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" disabled={busy}>
                Save mapping
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setProject(undefined);
                  setProjects(undefined);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </>
  );
}
