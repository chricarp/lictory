import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  FolderGit2,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import { callCapability } from "@lictory/core/capabilities/client";
import type {
  CodeConnectionEntity,
  CodeRepositoryEntity,
} from "@lictory/core/code/entities";
import { relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { CommandBlock, CopyValue } from "@lictory/ui/command-block";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Input } from "@lictory/ui/input";
import { Badge } from "@lictory/ui/primitives";
import { Heading } from "@lictory/ui/heading";
import { StatusChip } from "@lictory/ui/status-chip";
import { Segmented, SegmentedItem } from "@lictory/ui/segmented";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  ReadOnlyNotice,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import { useCodeHosts } from "@lictory/platform/components/code/store";
import {
  message,
  providerLabels,
  webhookRefusal,
} from "@lictory/platform/components/code/parts";

// Organization settings → Code hosts. Administrators connect GitHub, GitLab
// or Bitbucket; credentials go to the server once, are verified there,
// stored encrypted and never shown again. Project administrators choose
// which repositories serve their projects.

type Provider = keyof typeof providerLabels;
type AuthKind = "github_app" | "token" | "oauth_consumer";

type Connected = {
  connectionId: string;
  accountLabel: string;
  webhookUrl: string;
  webhookSecret?: string;
};

export function CodeHostSettings() {
  const { isAdmin, projects, canManage } = useWorkspace();
  const { connections, repositories } = useCodeHosts();
  const [connecting, setConnecting] = useState<{
    replace?: CodeConnectionEntity;
  } | null>(null);
  const [webhook, setWebhook] = useState<Connected | null>(null);
  const linkable = projects.filter((p) => !p.archivedAt && canManage(p.id));
  return (
    <>
      <p className="px-1 text-[13px] leading-5 text-muted-foreground">
        Pull requests, checks and commits that name a work item’s key (PAY-142)
        link to that item. The host owns the code; Lictory owns the links.
      </p>
      <SettingsSection
        id="code-hosts"
        icon={<FolderGit2 />}
        title="Code hosts"
        description="GitHub (github.com or Enterprise Server), GitLab (gitlab.com or self-managed) and Bitbucket Cloud."
        action={
          isAdmin && !connecting ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConnecting({})}
            >
              <Plus className="size-3.5" /> Connect a host
            </Button>
          ) : undefined
        }
        footer="Webhooks keep Lictory current within seconds; without them, Lictory still reads every linked repository again every ten minutes."
      >
        {connecting && (
          <ConnectForm
            replace={connecting.replace}
            onDone={(result) => {
              setConnecting(null);
              if (result?.webhookSecret) setWebhook(result);
            }}
          />
        )}
        {webhook && (
          <WebhookDetails result={webhook} onClose={() => setWebhook(null)} />
        )}
        <SettingsList
          isEmpty={connections.length === 0}
          empty={
            isAdmin
              ? "No code host is connected yet."
              : "No code host is connected yet. Organization administrators can connect one."
          }
        >
          {connections.map((c) => (
            <ConnectionRow
              key={c.id}
              connection={c}
              repositories={repositories.filter((r) => r.connectionId === c.id)}
              canEdit={isAdmin}
              linkable={linkable}
              onReplace={() => setConnecting({ replace: c })}
              onWebhook={setWebhook}
            />
          ))}
        </SettingsList>
      </SettingsSection>
      {!isAdmin && (
        <ReadOnlyNotice>
          Only organization administrators connect code hosts. Project
          administrators link repositories to their projects here.
        </ReadOnlyNotice>
      )}
    </>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 text-[13px]">
      <span className="text-xs text-muted-foreground">{label}</span>
      <CopyValue label={label} value={value} />
    </div>
  );
}

function WebhookDetails({
  result,
  onClose,
}: {
  result: Connected;
  onClose: () => void;
}) {
  const { connections } = useCodeHosts();
  const connection = connections.find((c) => c.id === result.connectionId);
  return (
    <SettingsBody className="space-y-3 border-b bg-muted/40">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[13px] font-medium">
          Add this webhook on the host now: the secret is shown only once.
        </p>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <Copyable label="Webhook URL" value={result.webhookUrl} />
      {result.webhookSecret && (
        <Copyable label="Webhook secret" value={result.webhookSecret} />
      )}
      {connection ? (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            {webhookWhere(connection.provider, connection.authKind)}
          </p>
          <WebhookSettings provider={connection.provider} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Content type JSON. Events: pull requests and their reviews, pushes,
          issues, comments, checks and statuses (or pipelines on GitLab).
        </p>
      )}
    </SettingsBody>
  );
}

function ConnectionRow({
  connection,
  repositories,
  canEdit,
  linkable,
  onReplace,
  onWebhook,
}: {
  connection: CodeConnectionEntity;
  repositories: CodeRepositoryEntity[];
  canEdit: boolean;
  linkable: { id: string; name: string }[];
  onReplace: () => void;
  onWebhook: (result: Connected) => void;
}) {
  const { organization } = useWorkspace();
  const refusal = webhookRefusal(connection);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [linking, setLinking] = useState(false);
  const run = async (name: string, input: Record<string, unknown>) => {
    setError(undefined);
    try {
      return await callCapability<Connected>(name, {
        organizationId: organization.id,
        connectionId: connection.id,
        ...input,
      });
    } catch (e) {
      setError(message(e));
      return undefined;
    }
  };
  return (
    <div className="space-y-3 px-5 py-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {/* The default name is the host and the account; say each once. */}
        <span className="font-medium">
          {connection.name ===
          `${providerLabels[connection.provider]} ${connection.accountLabel}`
            ? providerLabels[connection.provider]
            : connection.name}
        </span>
        <span className="text-muted-foreground">
          as {connection.accountLabel}
        </span>
        {connection.status === "active" ? (
          <StatusChip tone="success" icon={<CircleCheck />}>
            Connected
          </StatusChip>
        ) : (
          <StatusChip tone="danger" icon={<CircleAlert />}>
            Needs attention
          </StatusChip>
        )}
        {canEdit && (
          <span className="ml-auto flex flex-wrap gap-1">
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
                  onClick={async () => {
                    await run("disconnectCodeHost", {});
                    setConfirming(false);
                  }}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const result = await run("rotateCodeHostWebhookSecret", {});
                    if (result) onWebhook(result);
                  }}
                >
                  New webhook secret
                </Button>
                <Button size="sm" variant="secondary" onClick={onReplace}>
                  Replace credential
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
        <span className="font-mono">{connection.baseUrl}</span>
        {" · "}
        {connection.lastWebhookAt
          ? `last webhook ${relativeTime(connection.lastWebhookAt)}`
          : "no webhook received yet"}
      </p>
      {refusal && (
        <p className="text-xs text-destructive">
          Webhook delivery refused {relativeTime(refusal.at)}: {refusal.text}
        </p>
      )}
      {connection.longLivedCredential && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            Uses a stored token, which agent sessions receive as is. Prefer an
            app or a short-lived credential where the host offers one.
          </span>
        </p>
      )}
      {confirming && (
        <p className="text-xs text-muted-foreground">
          Its repositories, pull requests and links stay as history and return
          when you connect the same host and account again. Changes Lictory has
          not sent yet are canceled.
        </p>
      )}
      {connection.lastError && (
        <p className="text-xs text-destructive">{connection.lastError}</p>
      )}
      {canEdit && (
        <>
          <Copyable
            label="Webhook URL"
            value={`${window.location.origin}${connection.webhookPath}`}
          />
          {!connection.lastWebhookAt && (
            <Collapsible>
              <CollapsibleTrigger className="rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground">
                How to add the webhook
              </CollapsibleTrigger>
              <CollapsiblePanel className="mt-1.5 space-y-2">
                <p className="text-xs leading-5 text-muted-foreground">
                  {webhookWhere(connection.provider, connection.authKind)} The
                  secret was shown once when you connected; if you no longer
                  have it, choose New webhook secret.
                </p>
                <WebhookSettings provider={connection.provider} />
              </CollapsiblePanel>
            </Collapsible>
          )}
        </>
      )}
      <MyLogin connection={connection} />
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Heading className="text-xs font-medium text-muted-foreground">
            Repositories
          </Heading>
          {linkable.length > 0 && !linking && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setLinking(true)}
            >
              <Plus className="size-3.5" /> Link a repository
            </Button>
          )}
        </div>
        {linking && (
          <LinkRepository
            connection={connection}
            projects={linkable}
            onDone={() => setLinking(false)}
          />
        )}
        {repositories.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No repository serves a project yet.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {repositories.map((r) => (
              <RepositoryRow
                key={r.id}
                repository={r}
                shared={repositories
                  .filter((other) => other.id !== r.id)
                  .flatMap((other) => other.projectIds)}
              />
            ))}
          </ul>
        )}
      </div>
      <InlineError>{error}</InlineError>
    </div>
  );
}

// `shared`: projects another repository serves too, where a project
// administrator chooses which one agent sessions work in.
function RepositoryRow({
  repository,
  shared,
}: {
  repository: CodeRepositoryEntity;
  shared: string[];
}) {
  const { organization, projects, canManage } = useWorkspace();
  const [error, setError] = useState<string>();
  const call = async (name: string, input: Record<string, unknown>) => {
    setError(undefined);
    try {
      await callCapability(name, {
        organizationId: organization.id,
        repositoryId: repository.id,
        ...input,
      });
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <a
          href={repository.webUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
        >
          {repository.fullName} <ArrowUpRight className="size-3" />
        </a>
        {repository.projectIds.map((id) => {
          const project = projects.find((p) => p.id === id);
          return (
            <Badge key={id} tone="info">
              {project?.name ?? "Archived project"}
              {project && canManage(project.id) && (
                <button
                  type="button"
                  aria-label={`Stop using ${repository.fullName} in ${project.name}`}
                  className="-mr-1 rounded-full p-0.5 hover:bg-foreground/10"
                  onClick={() =>
                    call("unlinkCodeRepository", { projectId: id })
                  }
                >
                  <X className="size-2.5" />
                </button>
              )}
            </Badge>
          );
        })}
        {repository.projectIds.map((id) => {
          const project = projects.find((p) => p.id === id);
          if (!project) return null;
          const isDefault = repository.defaultForProjectIds.includes(id);
          if (isDefault)
            return (
              <Badge key={`default-${id}`} tone="good">
                Agents work here in {project.name}
              </Badge>
            );
          if (!shared.includes(id) || !canManage(project.id)) return null;
          return (
            <Button
              key={`default-${id}`}
              size="sm"
              variant="ghost"
              onClick={() =>
                call("setDefaultCodeRepository", {
                  projectId: id,
                  repositoryId: repository.id,
                })
              }
            >
              Make {project.name}&apos;s default for agents
            </Button>
          );
        })}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-label={`Refresh ${repository.fullName} now`}
          onClick={() => call("syncCodeRepository", {})}
        >
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {repository.lastSyncedAt
          ? `Read ${relativeTime(repository.lastSyncedAt)}`
          : "Reading its history…"}
        {" · default branch "}
        {repository.defaultBranch}
      </p>
      {repository.lastSyncError && (
        <p className="text-xs text-destructive">{repository.lastSyncError}</p>
      )}
      <InlineError>{error}</InlineError>
    </li>
  );
}

function MyLogin({ connection }: { connection: CodeConnectionEntity }) {
  const { organization, userId } = useWorkspace();
  const { identities } = useCodeHosts();
  const mine = identities.find(
    (i) => i.connectionId === connection.id && i.userId === userId,
  );
  const [login, setLogin] = useState(mine?.login ?? "");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        try {
          await callCapability("setCodeHostLogin", {
            organizationId: organization.id,
            connectionId: connection.id,
            login: login.trim() || null,
          });
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        } catch (err) {
          setError(message(err));
        }
      }}
    >
      <label className="grid min-w-48 flex-1 gap-1 text-xs text-muted-foreground">
        Your {providerLabels[connection.provider]} login (for “Mine” and “Review
        requested”)
        <Input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="octocat"
          className="h-8 text-[13px]"
          maxLength={100}
        />
      </label>
      <Button size="sm" variant="secondary" type="submit">
        {saved ? "Saved" : "Save"}
      </Button>
      <InlineError>{error}</InlineError>
    </form>
  );
}

type HostRepository = {
  externalId: string;
  fullName: string;
  defaultBranch: string;
  visibility: string;
  archived: boolean;
  projectIds: string[];
};

function LinkRepository({
  connection,
  projects,
  onDone,
}: {
  connection: CodeConnectionEntity;
  projects: { id: string; name: string }[];
  onDone: () => void;
}) {
  const { organization } = useWorkspace();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<HostRepository[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setFound(
        await callCapability<HostRepository[]>("listCodeHostRepositories", {
          organizationId: organization.id,
          connectionId: connection.id,
          query: query.trim() || undefined,
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Input
          aria-label="Find a repository"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a repository, or type owner/name"
          className="h-8 flex-1 text-[13px]"
        />
        <Button size="sm" variant="secondary" type="submit" disabled={busy}>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Search className="size-3.5" />
          )}
          Search
        </Button>
      </form>
      {found && (
        <ul
          aria-label="Repositories on the host"
          className="max-h-56 overflow-y-auto rounded-md border bg-card"
        >
          {found.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              The connection sees no repository with that name.
            </li>
          )}
          {found.map((r) => (
            <li key={r.externalId}>
              <label className="flex cursor-default items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-muted">
                <input
                  type="radio"
                  name={`repository-${connection.id}`}
                  checked={chosen === r.fullName}
                  onChange={() => setChosen(r.fullName)}
                />
                <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
                <span className="text-xs text-muted-foreground">
                  {r.visibility}
                  {r.archived && " · archived"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <DropdownSelect
          aria-label="Project"
          value={projectId}
          onValueChange={setProjectId}
          size="sm"
        >
          {projects.map((p) => (
            <DropdownSelectOption key={p.id} value={p.id}>
              {p.name}
            </DropdownSelectOption>
          ))}
        </DropdownSelect>
        <Button
          size="sm"
          disabled={!(chosen || query.includes("/")) || !projectId}
          onClick={async () => {
            setError(undefined);
            try {
              await callCapability("linkCodeRepository", {
                organizationId: organization.id,
                connectionId: connection.id,
                repository: chosen || query.trim(),
                projectId,
              });
              onDone();
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          Link to project
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <InlineError>{error}</InlineError>
    </div>
  );
}

const authChoices: Record<Provider, { value: AuthKind; label: string }[]> = {
  github: [
    { value: "github_app", label: "GitHub App" },
    { value: "token", label: "Fine-grained token" },
  ],
  gitlab: [{ value: "token", label: "Access token" }],
  bitbucket: [
    { value: "token", label: "Access or API token" },
    { value: "oauth_consumer", label: "OAuth consumer" },
  ],
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1 text-[13px]">
      {label}
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function ConnectForm({
  replace,
  onDone,
}: {
  replace?: CodeConnectionEntity;
  onDone: (result?: Connected) => void;
}) {
  const { organization } = useWorkspace();
  const [provider, setProvider] = useState<Provider>(
    replace?.provider ?? "github",
  );
  const [authKind, setAuthKind] = useState<AuthKind>(
    replace?.authKind ?? "github_app",
  );
  const [baseUrl, setBaseUrl] = useState(replace?.baseUrl ?? "");
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const field = (key: string) => ({
    value: fields[key] ?? "",
    onChange: (e: { target: { value: string } }) =>
      setFields((f) => ({ ...f, [key]: e.target.value })),
  });
  // Another host or sign-in method starts a fresh form: the previous host's
  // address and its error say nothing about this one.
  const chooseProvider = (next: Provider) => {
    setProvider(next);
    setAuthKind(authChoices[next][0]!.value);
    setBaseUrl("");
    setFields({});
    setError(undefined);
  };
  const cloud = {
    github: "https://github.com, or your GitHub Enterprise Server",
    gitlab: "https://gitlab.com, or your self-managed GitLab",
    bitbucket: "https://bitbucket.org",
  }[provider];
  return (
    <SettingsBody className="border-b bg-muted/40">
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            const result = await callCapability<Connected>("connectCodeHost", {
              organizationId: organization.id,
              provider,
              authKind,
              baseUrl,
              name: name || undefined,
              connectionId: replace?.id,
              credential: fields,
            });
            setFields({});
            onDone(result);
          } catch (err) {
            setError(message(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {!replace && (
          <Segmented
            aria-label="Code host"
            value={provider}
            onValueChange={chooseProvider}
            className="w-fit"
          >
            {(Object.keys(providerLabels) as Provider[]).map((p) => (
              <SegmentedItem key={p} value={p}>
                {providerLabels[p]}
              </SegmentedItem>
            ))}
          </Segmented>
        )}
        {authChoices[provider].length > 1 && (
          <Segmented
            aria-label="Authentication"
            value={authKind}
            onValueChange={(v) => {
              setAuthKind(v);
              setFields({});
              setError(undefined);
            }}
            className="w-fit"
          >
            {authChoices[provider].map((c) => (
              <SegmentedItem key={c.value} value={c.value}>
                {c.label}
              </SegmentedItem>
            ))}
          </Segmented>
        )}
        <SetupInstructions provider={provider} authKind={authKind} />
        {!replace && (
          <>
            <Field
              label="Host address"
              hint={`Leave empty for the cloud host: ${cloud}.`}
            >
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  provider === "bitbucket"
                    ? "https://bitbucket.org"
                    : "https://"
                }
                className="h-9 text-[13px]"
              />
            </Field>
            <Field label="Name (optional)">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Defaults to the host and account"
                className="h-9 text-[13px]"
                maxLength={120}
              />
            </Field>
          </>
        )}
        {provider === "github" && authKind === "github_app" ? (
          <>
            <Field label="App ID">
              <Input
                {...field("appId")}
                required
                className="h-9 text-[13px]"
                inputMode="numeric"
              />
            </Field>
            <Field
              label="Installation ID"
              hint="The number at the end of the installation's settings address (…/installations/12345678)."
            >
              <Input
                {...field("installationId")}
                required
                className="h-9 text-[13px]"
                inputMode="numeric"
              />
            </Field>
            <Field
              label="Private key"
              hint="Paste the whole .pem file GitHub generated for the app."
            >
              <textarea
                {...field("privateKey")}
                required
                rows={4}
                spellCheck={false}
                className="rounded-md border bg-background px-3 py-2 font-mono text-xs"
                placeholder="-----BEGIN RSA PRIVATE KEY-----"
              />
            </Field>
          </>
        ) : provider === "bitbucket" && authKind === "oauth_consumer" ? (
          <>
            <Field label="Consumer key">
              <Input {...field("key")} required className="h-9 text-[13px]" />
            </Field>
            <Field label="Consumer secret">
              <Input
                {...field("secret")}
                required
                type="password"
                autoComplete="off"
                className="h-9 text-[13px]"
              />
            </Field>
          </>
        ) : (
          <>
            {provider === "bitbucket" && (
              <Field
                label="Atlassian account email (API tokens only)"
                hint="Leave empty for a repository, project or workspace access token."
              >
                <Input
                  {...field("email")}
                  type="email"
                  className="h-9 text-[13px]"
                />
              </Field>
            )}
            <Field label="Token">
              <Input
                {...(provider === "bitbucket" && fields.email
                  ? field("apiToken")
                  : field("token"))}
                required
                type="password"
                autoComplete="off"
                className="h-9 text-[13px]"
              />
            </Field>
          </>
        )}
        <InlineError>{error}</InlineError>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {replace ? "Verify and replace" : "Verify and connect"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onDone()}>
            Cancel
          </Button>
        </div>
      </form>
    </SettingsBody>
  );
}

// The webhook settings each host's form asks for, in its own words and
// order, one per line: a person ticks them off (or copies them) instead of
// picking ten events out of a sentence.
const webhookSettings: Record<Provider, string> = {
  github: [
    "Content type: application/json",
    "SSL verification: Enable",
    "Which events: Let me select individual events",
    "  Check runs",
    "  Check suites",
    "  Issue comments",
    "  Issues",
    "  Pull request review threads",
    "  Pull request reviews",
    "  Pull requests",
    "  Pushes",
    "  Repository",
    "  Statuses",
  ].join("\n"),
  gitlab: [
    "Trigger:",
    "  Push events (all branches)",
    "  Comments",
    "  Issues events",
    "  Merge request events",
    "  Job events",
    "  Pipeline events",
    "Enable SSL verification",
  ].join("\n"),
  bitbucket: [
    "Status: Active",
    "Triggers: Choose from a full list of triggers",
    "  Repository: Push",
    "  Repository: Build status created (repo:commit_status_created)",
    "  Repository: Build status updated (repo:commit_status_updated)",
    "  Pull Request: every trigger",
    "  Issue: every trigger",
  ].join("\n"),
};

function webhookWhere(provider: Provider, authKind: AuthKind) {
  if (provider === "github" && authKind === "github_app")
    return "On the GitHub App (Settings → Developer settings → GitHub Apps → Edit): under General → Webhook, tick Active and set this URL and secret; under Permissions & events, subscribe to the events below.";
  if (provider === "github")
    return "Organization settings → Webhooks → Add webhook, where one webhook covers every repository (an organization owner adds it); on a personal account, each repository’s Settings → Webhooks. Payload URL and secret as shown.";
  if (provider === "gitlab")
    return "Group or Project → Settings → Webhooks → Add new webhook, with this URL and the secret as its Secret token.";
  return "In each repository: Repository settings → Webhooks → Add webhook, with this URL and secret.";
}

// The webhook's settings as one block to copy or tick off.
function WebhookSettings({ provider }: { provider: Provider }) {
  return (
    <CommandBlock
      label={`${providerLabels[provider]} webhook settings`}
      caption={`Webhook settings to choose on ${providerLabels[provider]}`}
      copyLabel={`Copy the ${providerLabels[provider]} webhook settings`}
    >
      {webhookSettings[provider]}
    </CommandBlock>
  );
}

// Exactly what to create on each host, so an administrator does not have to
// guess scopes.
function SetupInstructions({
  provider,
  authKind,
}: {
  provider: Provider;
  authKind: AuthKind;
}) {
  let steps: ReactNode[];
  if (provider === "github" && authKind === "github_app")
    steps = [
      "In GitHub, open your organization's Settings → Developer settings → GitHub Apps → New GitHub App (for a personal account: your Settings → Developer settings).",
      "Homepage URL: this Lictory address. Leave the webhook inactive for now; after connecting, Lictory shows the webhook URL and secret to set on the app.",
      "Repository permissions: Contents read and write, Pull requests read and write, Issues read and write, Checks read, Commit statuses read, Metadata read.",
      "Subscribe to the events in the webhook settings below.",
      "Create the app, note its App ID, generate a private key (.pem), then Install App on the repositories Lictory should see. The installation ID is the number in the installation's address.",
    ];
  else if (provider === "github")
    steps = [
      "In GitHub, open Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.",
      "Resource owner: your organization. Repository access: the repositories Lictory should see.",
      "Permissions: Contents read and write, Pull requests read and write, Issues read and write, Commit statuses read, Checks read (when offered), Metadata read.",
      "After connecting, add the webhook Lictory shows once, with the settings below, to your GitHub organization (Organization settings → Webhooks → Add webhook), where one webhook covers every repository; on a personal account, to each repository (Settings → Webhooks). Adding an organization webhook needs an organization owner; the token itself is not used for it.",
      "A token is long-lived and is handed to agent sessions as is. A GitHub App gives each session a token for one repository that expires within an hour.",
    ];
  else if (provider === "gitlab")
    steps = [
      "Create a group access token (Group → Settings → Access tokens), a project access token, or a personal access token of a bot account.",
      "Scope: api (read_api is enough for a read-only mirror, but creating branches, opening, commenting on and merging merge requests needs api). Role: Developer, or Maintainer to merge into protected branches.",
      "After connecting, add the webhook (Group or Project → Settings → Webhooks): the URL and secret token Lictory shows, with the settings below.",
      "Self-managed GitLab on a private network: an operator must list its host name in CODE_HOST_PRIVATE_HOSTS first.",
    ];
  else if (authKind === "oauth_consumer")
    steps = [
      "In Bitbucket, open Workspace settings → OAuth consumers → Add consumer and tick “This is a private consumer”. A callback URL is required by the form; use this Lictory address.",
      "Permissions: Account read, Repositories write, Pull requests write, Issues write, Pipelines read.",
      "After connecting, add the webhook in each repository (Repository settings → Webhooks → Add webhook): the URL and secret Lictory shows, with the settings below.",
    ];
  else
    steps = [
      "Create a repository, project or workspace access token (its settings → Access tokens), or an Atlassian API token with Bitbucket scopes (Atlassian account → Security → API tokens) and enter your account email with it.",
      "Scopes: repository write, pull request write, issue write, pipeline read (read:repository, write:repository, read:pullrequest, write:pullrequest, read:issue, write:issue, read:pipeline for API tokens).",
      "After connecting, add the webhook in each repository (Repository settings → Webhooks → Add webhook): the URL and secret Lictory shows, with the settings below.",
    ];
  return (
    <Collapsible className="rounded-lg border bg-card">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium hover:bg-muted data-panel-open:rounded-b-none">
        How to set up {providerLabels[provider]}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ol className="list-decimal space-y-1.5 px-3 pt-1 pb-3 pl-7 text-xs leading-5 text-muted-foreground">
          {steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
        <div className="px-3 pb-3">
          <WebhookSettings provider={provider} />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
