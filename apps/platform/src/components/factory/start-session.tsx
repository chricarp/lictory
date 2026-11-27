import { useId, useMemo, useState } from "react";
import {
  Check,
  CircleCheck,
  CircleDashed,
  FileText,
  TriangleAlert,
} from "lucide-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
} from "@ui-sdk/react/combobox";
import { Textarea } from "@ui-sdk/react/textarea";
import { callCapability } from "@lictory/core/capabilities/client";
import type {
  AgentEntity,
  SessionEntity,
} from "@lictory/core/factory/entities";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { refinementMeta } from "@lictory/core/lib/work-items";
import type { CodeRepositoryEntity } from "@lictory/core/code/entities";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { Dialog } from "@lictory/ui/dialog";
import { dropdownContentClass, dropdownItemClass } from "@lictory/ui/dropdown";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Input, inputClass } from "@lictory/ui/input";
import { popupContainer } from "@lictory/ui/popup";
import { useRouter } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { harnessLabel } from "@lictory/platform/components/factory/labels";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import { useFactory } from "@lictory/platform/components/factory/store";
import { useCodeHosts } from "@lictory/platform/components/code/store";
import { useClaimability } from "@lictory/platform/components/claims/claims";

// Start an agent session: which agent, what to do, and optionally the work
// item and the repository (one linked to the item's project, picked by
// name, or any address). The server checks who may start it.

const DEFAULT = "default";
const OTHER = "other";

// The agents this person may start: runner agents they own or that are
// shared, not archived (the server's `assertCanStart` decides).
export function startableAgents(
  agents: Iterable<AgentEntity>,
  userId: string,
): AgentEntity[] {
  return [...agents].filter(
    (a) =>
      a.kind === "runner" &&
      !a.archivedAt &&
      (a.ownerId === userId || a.shared),
  );
}

// The repositories offered: those serving the item's project when there is
// one (its default first), else every linked one; archived ones never.
export function repositoryChoices(
  repositories: readonly CodeRepositoryEntity[],
  projectId: string | null,
) {
  const live = repositories.filter((r) => !r.hostArchived);
  const serving = projectId
    ? live.filter((r) => r.projectIds.includes(projectId))
    : live;
  const fallback = projectId
    ? (serving.find((r) => r.defaultForProjectIds.includes(projectId)) ??
      serving[0] ??
      null)
    : null;
  return { repositories: serving, fallback };
}
export function StartSessionDialog({
  onClose,
  agentId: initialAgent,
  workItemId: initialItem,
}: {
  onClose: () => void;
  agentId?: string;
  workItemId?: string;
}) {
  const { organization, userId, items } = useWorkspace();
  const { agents } = useFactory();
  const router = useRouter();
  const startable = startableAgents(agents, userId);
  const [agentId, setAgentId] = useState(
    initialAgent ?? startable[0]?.id ?? "",
  );
  const [prompt, setPrompt] = useState("");
  const [workItemId, setWorkItemId] = useState<string | null>(
    initialItem ?? null,
  );
  const { repositories } = useCodeHosts();
  // A linked repository (by id), the project's default, or an address.
  const [repository, setRepository] = useState<string>(DEFAULT);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mutationId] = useState(() => crypto.randomUUID());
  const ids = {
    prompt: useId(),
    repository: useId(),
    base: useId(),
    agent: useId(),
  };

  const item = workItemId ? items.find((i) => i.id === workItemId) : undefined;
  const choices = useMemo(
    () => repositoryChoices(repositories, item?.projectId ?? null),
    [repositories, item?.projectId],
  );
  // A repository that does not serve the item's project falls back.
  const choice =
    repository === OTHER ||
    choices.repositories.some((r) => r.id === repository)
      ? repository
      : DEFAULT;
  const chosenUrl =
    choice === OTHER
      ? repositoryUrl.trim()
      : (choices.repositories.find((r) => r.id === choice)?.webUrl ?? "");

  // Nothing to clone: no linked repository chosen, no project default
  // and no address.
  const noRepository =
    !chosenUrl &&
    (choice === OTHER || !repositories.length || !choices.fallback);
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const { session } = await callCapability<{ session: SessionEntity }>(
        "startAgentSession",
        {
          organizationId: organization.id,
          agentId,
          prompt,
          workItemId,
          repositoryUrl: chosenUrl || null,
          baseBranch: baseBranch.trim() || null,
          mutationId,
        },
      );
      onClose();
      router.push(factoryPaths.session(organization.slug, session.id));
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  };

  return (
    <Dialog
      title="Start an agent session"
      description="The agent works on a runner in its own branch and asks you when it needs a decision."
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={pending || !agentId || !prompt.trim()}
          >
            {pending ? "Starting…" : "Start session"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={ids.agent} className="text-[13px] font-medium">
            Agent
          </label>
          {startable.length ? (
            <DropdownSelect
              id={ids.agent}
              value={agentId}
              onValueChange={setAgentId}
              size="lg"
              className="w-full"
            >
              {startable.map((agent) => (
                <DropdownSelectOption
                  key={agent.id}
                  value={agent.id}
                  label={agent.name}
                >
                  <span className="truncate">
                    {agent.avatar ? `${agent.avatar} ` : ""}
                    {agent.name}
                  </span>
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">
                    {harnessLabel(agent.harness)}
                  </span>
                </DropdownSelectOption>
              ))}
            </DropdownSelect>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No agent you may start. Create one in Agents, or ask a colleague
              to share theirs.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.prompt} className="text-[13px] font-medium">
            What should it do?
          </label>
          <Textarea
            id={ids.prompt}
            data-autofocus
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            maxLength={20_000}
            placeholder="Implement the refund endpoint described in PAY-142, with tests."
            className={cn(
              inputClass,
              "h-auto min-h-28 resize-y py-2.5 text-[14px] leading-6",
            )}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <WorkItemPicker value={workItemId} onChange={setWorkItemId} />
        {item && (
          <WorksFrom
            item={item}
            agentName={
              startable.find((a) => a.id === agentId)?.name ?? "The agent"
            }
          />
        )}
        {/* A long repository name truncates; it never pushes the base
            branch past the dialog's edge. */}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={ids.repository} className="text-[13px] font-medium">
              Repository{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            {repositories.length ? (
              <DropdownSelect
                id={ids.repository}
                value={choice}
                onValueChange={setRepository}
                size="lg"
                className="w-full"
              >
                <DropdownSelectOption
                  value={DEFAULT}
                  label={
                    choices.fallback
                      ? `Project default (${choices.fallback.fullName})`
                      : "None"
                  }
                >
                  <span className="truncate">
                    {choices.fallback
                      ? `Project default (${choices.fallback.fullName})`
                      : "None"}
                  </span>
                </DropdownSelectOption>
                {choices.repositories.map((r) => (
                  <DropdownSelectOption
                    key={r.id}
                    value={r.id}
                    label={r.fullName}
                  >
                    <span className="truncate font-mono text-[12.5px]">
                      {r.fullName}
                    </span>
                    {r.visibility !== "public" && (
                      <span className="ml-auto pl-3 text-xs text-muted-foreground">
                        {r.visibility === "private" ? "Private" : "Internal"}
                      </span>
                    )}
                  </DropdownSelectOption>
                ))}
                <DropdownSelectOption value={OTHER} label="Another address…">
                  Another address…
                </DropdownSelectOption>
              </DropdownSelect>
            ) : null}
            {(!repositories.length || choice === OTHER) && (
              <Input
                id={
                  repositories.length ? `${ids.repository}-url` : ids.repository
                }
                aria-label={
                  repositories.length ? "Repository address" : undefined
                }
                value={repositoryUrl}
                onChange={(event) => setRepositoryUrl(event.target.value)}
                placeholder="https://github.com/acme/payments.git"
                autoComplete="off"
                spellCheck={false}
              />
            )}
            {noRepository ? (
              // Said before it starts: the work of a session with no
              // repository is discarded with its scratch workspace.
              <p
                data-no-repository
                className="flex items-start gap-1.5 text-xs font-medium text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))]"
              >
                <TriangleAlert
                  aria-hidden
                  className="mt-px size-3.5 shrink-0"
                />
                No repository: it works in a scratch workspace, and files it
                changes are discarded when the session ends.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {choice === OTHER || !repositories.length
                  ? "Cloned with the runner’s own git credentials."
                  : item
                    ? "The project’s repositories, cloned with a short-lived credential."
                    : "Linked repositories, cloned with a short-lived credential."}
              </p>
            )}
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor={ids.base} className="text-[13px] font-medium">
              Base branch
            </label>
            <Input
              id={ids.base}
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
              placeholder="Default"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

const MAX_RESULTS = 30;

// A work item of the workspace, found by key or title.
// What the agent will work from, said before it starts: the item it reads
// with Lictory's tools (its approved specification, or the text as it is
// now), and whether agents would take it by themselves. The readiness
// policy governs what agents claim on their own; a person may still start
// one on any item, knowing what it reads.
function WorksFrom({ item, agentName }: { item: WorkItem; agentName: string }) {
  const { projects, directory } = useWorkspace();
  const verdict = useClaimability()(item);
  const project =
    projects.find((p) => p.id === item.projectId) ??
    directory.projects.find((p) => p.id === item.projectId);
  const key = project ? `${project.key}-${item.number}` : "the item";
  const state = item.refinementState;
  const source =
    state === null
      ? `${key} as written`
      : state === "ready"
        ? `the approved specification of ${key} (revision ${item.revisionNumber})`
        : `revision ${item.revisionNumber} of ${key}, still ${refinementMeta[state].label.toLowerCase()}: it may change while the agent works`;
  // Outside native delivery (or archived) agents claim nothing: no verdict.
  const own =
    verdict.stage === "outside"
      ? null
      : verdict.claimable
        ? { ok: true, text: "Agents may also claim it on their own." }
        : verdict.stage === "claimed"
          ? { ok: false, text: "An agent already holds its claim." }
          : {
              ok: false,
              text: `Agents would not take it on their own: ${verdict.reasons[0]?.message ?? "it is not ready."} You can still start one yourself.`,
            };
  return (
    <div
      data-works-from
      className="space-y-1.5 rounded-lg bg-muted/50 px-3 py-2.5 text-[13px] leading-5"
    >
      <p className="flex items-start gap-2">
        <FileText
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <span>
          {agentName} works from {source}, read with Lictory&apos;s tools.
        </span>
      </p>
      {own && (
        <p className="flex items-start gap-2 text-muted-foreground">
          {own.ok ? (
            <CircleCheck
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-success"
            />
          ) : (
            <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          <span>{own.text}</span>
        </p>
      )}
    </div>
  );
}

function WorkItemPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { items, projects } = useWorkspace();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<HTMLDivElement | null>(null);
  const labelId = useId();
  const keyOf = useMemo(() => {
    const keys = new Map(projects.map((p) => [p.id, p.key]));
    return (item: (typeof items)[number]) =>
      `${keys.get(item.projectId) ?? "?"}-${item.number}`;
  }, [projects]);
  const chosen = items.find((i) => i.id === value);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((i) => !i.archivedAt)
      .filter(
        (i) =>
          !needle ||
          keyOf(i).toLowerCase().includes(needle) ||
          i.title.toLowerCase().includes(needle),
      )
      .slice(0, MAX_RESULTS);
  }, [items, query, keyOf]);
  return (
    <div className="space-y-1.5">
      <span id={labelId} className="text-[13px] font-medium">
        Work item{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </span>
      <Combobox<string>
        container={popupContainer()}
        value={value}
        onValueChange={(next) => onChange(next)}
        query={open ? query : chosen ? `${keyOf(chosen)} ${chosen.title}` : ""}
        onQueryChange={(next, details) => {
          if (details.reason === "input-change") setQuery(next);
          if (details.reason === "input-change" && !next) onChange(null);
        }}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
        filter={false}
        autoHighlight="always"
      >
        <div ref={setField}>
          <ComboboxInput
            aria-labelledby={labelId}
            placeholder="Search by key or title…"
            autoComplete="off"
            spellCheck={false}
            className={inputClass}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
              if (event.key === "Enter" && !matches.length)
                event.preventDefault();
            }}
          />
        </div>
        <ComboboxContent
          anchor={field}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          style={{
            width: "var(--anchor-width)",
            maxHeight: "var(--available-height)",
          }}
          className={cn(dropdownContentClass, "flex min-w-0 flex-col")}
        >
          <ComboboxEmpty className="text-center text-xs text-muted-foreground data-empty:px-2 data-empty:py-3">
            No work items match.
          </ComboboxEmpty>
          <ComboboxList className="max-h-64 min-h-0 flex-1 overflow-y-auto p-1 outline-none">
            {matches.map((item) => (
              <ComboboxItem
                key={item.id}
                value={item.id}
                label={item.title}
                className={dropdownItemClass}
              >
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {keyOf(item)}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <ComboboxItemIndicator className="shrink-0">
                  <Check className="size-3.5" aria-hidden />
                </ComboboxItemIndicator>
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
