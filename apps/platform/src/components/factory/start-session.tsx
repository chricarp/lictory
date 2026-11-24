import { useId, useMemo, useState } from "react";
import { Check } from "lucide-react";
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
import type { SessionEntity } from "@lictory/core/factory/entities";
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

// Start an agent session: which agent, what to do, and optionally the work
// item and the repository. The server checks who may start it.
export function StartSessionDialog({
  onClose,
  agentId: initialAgent,
  workItemId: initialItem,
}: {
  onClose: () => void;
  agentId?: string;
  workItemId?: string;
}) {
  const { organization, userId } = useWorkspace();
  const { agents } = useFactory();
  const router = useRouter();
  const startable = agents.filter(
    (a) =>
      a.kind === "runner" &&
      !a.archivedAt &&
      (a.ownerId === userId || a.shared),
  );
  const [agentId, setAgentId] = useState(
    initialAgent ?? startable[0]?.id ?? "",
  );
  const [prompt, setPrompt] = useState("");
  const [workItemId, setWorkItemId] = useState<string | null>(
    initialItem ?? null,
  );
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
          repositoryUrl: repositoryUrl.trim() || null,
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
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <div className="space-y-1.5">
            <label htmlFor={ids.repository} className="text-[13px] font-medium">
              Repository{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Input
              id={ids.repository}
              value={repositoryUrl}
              onChange={(event) => setRepositoryUrl(event.target.value)}
              placeholder="https://github.com/acme/payments.git"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
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
