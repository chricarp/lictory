import { readinessHistory } from "@lictory/platform/data/lookups";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@lictory/platform/lib/navigation";
import { ChevronDown, History, ListChecks, Plus, Undo2 } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { relativeTime, type Project } from "@lictory/core/lib/work-items";
import {
  type ReadinessRevision,
  type WorkItemType,
} from "@lictory/core/contracts/protocol";
import {
  checkLabel,
  checksFor,
  diffReadinessChecks,
  isBuiltInKind,
  readinessChecksSchema,
  readinessGroups,
  readinessImpactSchema,
  sameReadinessRules,
  type BuiltInReadinessKind,
  type ReadinessChange,
  type ReadinessCheckDefinition,
  type ReadinessCheckKind,
  type ReadinessImpact,
  type ReadinessRules,
} from "@lictory/core/contracts/readiness";
import { Button } from "@lictory/ui/button";
import { Popover, Picker } from "@lictory/ui/popover";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import {
  Choice,
  useCommand,
} from "@lictory/platform/components/settings/project-shared";

// The Definition of Ready reads as a sentence per type ("A Story is ready
// when…"). Editing happens in place on a draft; publishing goes through a
// review step that shows what the change does to real items.

type Draft = { base: ReadinessRevision; rules: ReadinessRules };

const versionName = (number: number) =>
  number === 0 ? "Lictory defaults" : `Version ${number}`;

// Storage order follows the reading order: by group, built-in checks first.
const order = (check: ReadinessCheckDefinition) => {
  const group = readinessGroups.findIndex((g) => g.kinds.includes(check.kind));
  return group * 10 + readinessGroups[group]!.kinds.indexOf(check.kind);
};
const sorted = (checks: ReadinessCheckDefinition[]) =>
  [...checks].sort((a, b) => order(a) - order(b));

function useSpecTypes(project: Project) {
  const { delivery } = useWorkspace();
  return useMemo(() => {
    const enabled = delivery.projectTypes.get(project.id) ?? new Set<string>();
    return [...delivery.types.values()]
      .filter((t) => t.hasSpecification && !t.archivedAt && enabled.has(t.id))
      .sort((a, b) => b.level - a.level || a.position - b.position);
  }, [delivery, project.id]);
}

export function ProjectReadiness({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { directory } = useWorkspace();
  const latest = directory.readiness.find((r) => r.projectId === project.id);
  const [draft, setDraft] = useState<Draft>();
  if (!latest) return null;
  return (
    <>
      <DefinitionOfReady
        project={project}
        canEdit={canEdit}
        latest={latest}
        draft={draft}
        setDraft={setDraft}
      />
      <VersionHistory
        project={project}
        latest={latest}
        onLoad={
          canEdit
            ? (revision) =>
                setDraft({
                  base: draft?.base ?? latest,
                  rules: structuredClone(revision.rules),
                })
            : undefined
        }
      />
    </>
  );
}

function DefinitionOfReady({
  project,
  canEdit,
  latest,
  draft,
  setDraft,
}: {
  project: Project;
  canEdit: boolean;
  latest: ReadinessRevision;
  draft: Draft | undefined;
  setDraft: (draft: Draft | undefined) => void;
}) {
  const { memberName } = useWorkspace();
  const types = useSpecTypes(project);
  const [selected, setSelected] = useState<string>();
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string>();
  const type = types.find((t) => t.id === selected) ?? types[0];
  const base = draft?.base ?? latest;
  const rules = draft?.rules ?? latest.rules;
  const changes = types
    .map((t) => ({
      type: t,
      changes: diffReadinessChecks(
        checksFor(base.rules, t.id),
        checksFor(rules, t.id),
      ),
    }))
    .filter((c) => c.changes.length > 0);
  const dirty = Boolean(draft) && !sameReadinessRules(rules, base.rules);
  const outdated = Boolean(draft) && base.number !== latest.number;
  const edit = (
    typeId: string,
    update: (checks: ReadinessCheckDefinition[]) => ReadinessCheckDefinition[],
  ) => {
    setError(undefined);
    const next = { ...rules };
    next[typeId] = sorted(update(checksFor(rules, typeId)));
    setDraft({ base, rules: next });
  };
  const discard = () => {
    setDraft(undefined);
    setReviewing(false);
    setError(undefined);
  };
  const review = () => {
    for (const { type: t } of changes) {
      const parsed = readinessChecksSchema.safeParse(checksFor(rules, t.id));
      if (!parsed.success) {
        setSelected(t.id);
        setError(
          `${t.name}: ${parsed.error.issues[0]?.message ?? "check the rules."}`,
        );
        return;
      }
    }
    setReviewing(true);
  };
  return (
    <SettingsSection
      id="definition"
      icon={<ListChecks />}
      title="Definition of Ready"
      description={
        latest.number === 0
          ? "Lictory’s defaults · not edited yet. A specification becomes Ready automatically when every rule of its type passes."
          : `${versionName(latest.number)} · ${latest.authorId ? memberName(latest.authorId) : "Lictory"}${latest.createdAt ? ` · ${relativeTime(latest.createdAt)}` : ""}. A specification becomes Ready automatically when every rule of its type passes.`
      }
      action={
        <a
          href="#history"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          History
        </a>
      }
    >
      {types.length === 0 ? (
        <SettingsBody>
          <p className="text-[13px] text-muted-foreground">
            This project uses no work item type with a specification, so nothing
            is checked for readiness.
          </p>
        </SettingsBody>
      ) : reviewing && dirty ? (
        <Review
          project={project}
          latest={latest}
          base={base}
          rules={rules}
          changes={changes}
          outdated={outdated}
          onBack={() => setReviewing(false)}
          onPublished={discard}
        />
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Work item types"
            className="flex flex-wrap gap-1 px-5 pt-3"
          >
            {types.map((t) => {
              const changed = changes.some((c) => c.type.id === t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={t.id === type!.id}
                  onClick={() => setSelected(t.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[13px] font-medium",
                    t.id === type!.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {t.name}
                  {changed && (
                    <span
                      aria-label="changed"
                      className="ml-1.5 inline-block size-1.5 rounded-full bg-amber-500 align-middle"
                    />
                  )}
                </button>
              );
            })}
          </div>
          <TypeRules
            key={type!.id}
            project={project}
            type={type!}
            types={types}
            canEdit={canEdit}
            base={checksFor(base.rules, type!.id)}
            checks={checksFor(rules, type!.id)}
            usesDefaults={!rules[type!.id]}
            onChange={(update) => edit(type!.id, update)}
            onCopy={(from) =>
              edit(type!.id, () =>
                structuredClone(checksFor(rules, from)).map((c) =>
                  isBuiltInKind(c.kind) ? c : { ...c, id: crypto.randomUUID() },
                ),
              )
            }
            onReset={() => {
              const next = { ...rules };
              delete next[type!.id];
              setDraft({ base, rules: next });
            }}
          />
          <StartingPolicy project={project} canEdit={canEdit} />
          {dirty && (
            <div className="space-y-2 border-t px-5 py-3">
              {outdated && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px]">
                  {versionName(latest.number)} was published while you were
                  editing. Discard your changes to start from it.
                </p>
              )}
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs text-muted-foreground">
                  {changes.reduce((n, c) => n + c.changes.length, 0)} changes to{" "}
                  {changes.map((c) => c.type.name).join(", ")}
                </p>
                <Button variant="ghost" size="md" onClick={discard}>
                  Discard
                </Button>
                <Button size="md" disabled={outdated} onClick={review}>
                  Review changes…
                </Button>
              </div>
              <InlineError>{error}</InlineError>
            </div>
          )}
        </>
      )}
    </SettingsSection>
  );
}

function TypeRules({
  project,
  type,
  types,
  canEdit,
  base,
  checks,
  usesDefaults,
  onChange,
  onCopy,
  onReset,
}: {
  project: Project;
  type: WorkItemType;
  types: WorkItemType[];
  canEdit: boolean;
  base: ReadinessCheckDefinition[];
  checks: ReadinessCheckDefinition[];
  usesDefaults: boolean;
  onChange: (
    update: (checks: ReadinessCheckDefinition[]) => ReadinessCheckDefinition[],
  ) => void;
  onCopy: (typeId: string) => void;
  onReset: () => void;
}) {
  const { directory } = useWorkspace();
  const change = (id: string) =>
    diffReadinessChecks(base, checks).find((c) => c.check.id === id)?.change;
  const removed = base.filter(
    (b) => !isBuiltInKind(b.kind) && !checks.some((c) => c.id === b.id),
  );
  const replace = (check: ReadinessCheckDefinition) =>
    onChange((list) => list.map((c) => (c.id === check.id ? check : c)));
  const remove = (id: string) =>
    onChange((list) => list.filter((c) => c.id !== id));
  const add = (check: ReadinessCheckDefinition) =>
    onChange((list) => [...list, check]);
  const firstReviewer = directory.disciplines.find(
    (d) => d.projectId === project.id && !d.archivedAt && d.capabilities.review,
  );
  const others = types.filter((t) => t.id !== type.id);
  return (
    <div className="pb-2">
      <div className="flex items-center gap-2 px-5 pt-3 pb-1">
        <p className="flex-1 text-sm">
          A <b>{type.name}</b> is ready when…
          {usesDefaults && (
            <span className="ml-2 text-xs text-muted-foreground">
              Lictory’s defaults
            </span>
          )}
        </p>
        {canEdit && (others.length > 0 || !usesDefaults) && (
          <Popover
            width={240}
            align="end"
            trigger={(props) => (
              <Button {...props} size="sm" variant="ghost">
                Start from… <ChevronDown className="size-3" />
              </Button>
            )}
          >
            {(close) => (
              <div role="menu" className="p-1 text-[13px]">
                {others.map((t) => (
                  <MenuItem
                    key={t.id}
                    onClick={() => {
                      onCopy(t.id);
                      close();
                    }}
                  >
                    The {t.name} rules
                  </MenuItem>
                ))}
                {!usesDefaults && (
                  <MenuItem
                    onClick={() => {
                      onReset();
                      close();
                    }}
                  >
                    Lictory’s defaults
                  </MenuItem>
                )}
              </div>
            )}
          </Popover>
        )}
      </div>
      {readinessGroups.map((group) => {
        const builtIns = group.kinds.filter((k): k is BuiltInReadinessKind =>
          isBuiltInKind(k),
        );
        const custom = checks.filter(
          (c) => group.kinds.includes(c.kind) && !isBuiltInKind(c.kind),
        );
        const gone = removed.filter((c) => group.kinds.includes(c.kind));
        return (
          <div key={group.id} className="px-5 pt-2">
            <p className="mb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {group.title}
            </p>
            {sortedKinds(builtIns, group.kinds).map((kind) => {
              const on = checks.some((c) => c.kind === kind);
              const was = base.some((c) => c.kind === kind);
              const label = checkLabel({ id: kind, kind }, () => "");
              return (
                <Rule
                  key={kind}
                  on={on}
                  label={label}
                  canEdit={canEdit}
                  change={on === was ? undefined : on ? "added" : "removed"}
                  onToggle={() =>
                    on
                      ? onChange((list) => list.filter((c) => c.kind !== kind))
                      : add({ id: kind, kind })
                  }
                >
                  <span className={cn(!on && "text-muted-foreground")}>
                    {label}
                  </span>
                </Rule>
              );
            })}
            {custom.map((check) => (
              <Rule
                key={check.id}
                on
                label={check.kind === "manual" ? check.label : check.kind}
                canEdit={canEdit}
                change={change(check.id)}
                onToggle={() => remove(check.id)}
              >
                <CustomSentence
                  project={project}
                  check={check}
                  canEdit={canEdit}
                  onChange={replace}
                />
              </Rule>
            ))}
            {gone.map((check) => (
              <RemovedRule
                key={check.id}
                check={check}
                canEdit={canEdit}
                onUndo={() => add(check)}
              />
            ))}
            {canEdit && group.id !== "decomposed" && (
              <AddRule
                group={group.id}
                onAdd={(kind) =>
                  add(
                    kind === "section"
                      ? {
                          id: crypto.randomUUID(),
                          kind,
                          heading: "Acceptance criteria",
                        }
                      : kind === "discipline_approval"
                        ? {
                            id: crypto.randomUUID(),
                            kind,
                            disciplineIds: firstReviewer
                              ? [firstReviewer.id]
                              : [],
                          }
                        : {
                            id: crypto.randomUUID(),
                            kind: "manual",
                            label: "Designs attached",
                            description: null,
                            disciplineIds: [],
                          },
                  )
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const sortedKinds = (
  kinds: BuiltInReadinessKind[],
  groupKinds: ReadinessCheckKind[],
) => [...kinds].sort((a, b) => groupKinds.indexOf(a) - groupKinds.indexOf(b));

function MenuItem({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

function Switch({
  on,
  label,
  disabled,
  onToggle,
}: {
  on: boolean;
  label: string;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default disabled:opacity-60",
        on ? "bg-primary" : "bg-muted-foreground/25",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-3 rounded-full bg-white shadow-sm transition-transform duration-150",
          on ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

const changeTags: Record<ReadinessChange["change"], [string, string]> = {
  added: ["New", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"],
  changed: ["Changed", "bg-amber-500/15 text-amber-700 dark:text-amber-400"],
  removed: ["Removed", "bg-red-500/15 text-red-700 dark:text-red-400"],
};

function ChangeTag({ change }: { change: ReadinessChange["change"] }) {
  const [text, className] = changeTags[change];
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 text-[10.5px] font-semibold uppercase",
        className,
      )}
    >
      {text}
    </span>
  );
}

function Rule({
  on,
  label,
  canEdit,
  change,
  onToggle,
  children,
}: {
  on: boolean;
  label: string;
  canEdit: boolean;
  change?: ReadinessChange["change"];
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "-mx-5 flex min-h-9 items-center gap-3 px-5 py-1 text-[13px]",
        change === "added" && "bg-emerald-500/6",
        change === "changed" && "bg-amber-500/6",
        change === "removed" && "bg-red-500/6",
      )}
    >
      <Switch on={on} label={label} disabled={!canEdit} onToggle={onToggle} />
      <div className="min-w-0 flex-1">{children}</div>
      {change && <ChangeTag change={change} />}
    </div>
  );
}

function RemovedRule({
  check,
  canEdit,
  onUndo,
}: {
  check: ReadinessCheckDefinition;
  canEdit: boolean;
  onUndo: () => void;
}) {
  const { disciplineName } = useWorkspace();
  return (
    <div className="-mx-5 flex min-h-9 items-center gap-3 bg-red-500/6 px-5 py-1 text-[13px]">
      <span className="w-7 shrink-0" />
      <span className="min-w-0 flex-1 text-muted-foreground line-through">
        {checkLabel(check, disciplineName)}
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Undo2 className="size-3" /> Undo
        </button>
      )}
      <ChangeTag change="removed" />
    </div>
  );
}

const chip =
  "inline-flex h-6 items-center gap-1 rounded-md border bg-muted/60 px-1.5 align-baseline text-[13px] font-medium";

function ChipInput({
  value,
  label,
  placeholder,
  canEdit,
  onChange,
}: {
  value: string;
  label: string;
  placeholder: string;
  canEdit: boolean;
  onChange: (value: string) => void;
}) {
  if (!canEdit) return <span className={chip}>{value}</span>;
  return (
    <input
      value={value}
      aria-label={label}
      placeholder={placeholder}
      maxLength={120}
      size={Math.max(placeholder.length, value.length, 4)}
      onChange={(e) => onChange(e.target.value)}
      className={cn(chip, "outline-none focus:border-primary/60 focus:bg-card")}
    />
  );
}

function CustomSentence({
  project,
  check,
  canEdit,
  onChange,
}: {
  project: Project;
  check: ReadinessCheckDefinition;
  canEdit: boolean;
  onChange: (check: ReadinessCheckDefinition) => void;
}) {
  switch (check.kind) {
    case "section":
      return (
        <span className="leading-7">
          It has a non-empty{" "}
          <ChipInput
            value={check.heading}
            label="Required section"
            placeholder="Section heading"
            canEdit={canEdit}
            onChange={(heading) => onChange({ ...check, heading })}
          />{" "}
          section
        </span>
      );
    case "discipline_approval":
      return (
        <span className="leading-7">
          <DisciplineChip
            project={project}
            value={check.disciplineIds}
            reviewing
            canEdit={canEdit}
            empty="Choose disciplines"
            onChange={(disciplineIds) => onChange({ ...check, disciplineIds })}
          />{" "}
          approved the current revision
        </span>
      );
    case "manual":
      return (
        <span className="block leading-7">
          <DisciplineChip
            project={project}
            value={check.disciplineIds}
            canEdit={canEdit}
            empty="Anyone with a discipline"
            onChange={(disciplineIds) => onChange({ ...check, disciplineIds })}
          />{" "}
          {check.disciplineIds.length > 1 ? "confirm" : "confirms"}{" "}
          <ChipInput
            value={check.label}
            label="Sign-off name"
            placeholder="Designs attached"
            canEdit={canEdit}
            onChange={(label) => onChange({ ...check, label })}
          />
          {canEdit ? (
            <input
              value={check.description ?? ""}
              aria-label={`Guidance for ${check.label}`}
              placeholder="Guidance shown on the item (optional)"
              maxLength={500}
              onChange={(e) =>
                onChange({ ...check, description: e.target.value || null })
              }
              className="mt-0.5 block w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60"
            />
          ) : (
            check.description && (
              <span className="block text-xs text-muted-foreground">
                {check.description}
              </span>
            )
          )}
        </span>
      );
    default:
      return null;
  }
}

function DisciplineChip({
  project,
  value,
  reviewing = false,
  canEdit,
  empty,
  onChange,
}: {
  project: Project;
  value: string[];
  reviewing?: boolean;
  canEdit: boolean;
  empty: string;
  onChange: (ids: string[]) => void;
}) {
  const { directory, disciplineName } = useWorkspace();
  const options = directory.disciplines.filter(
    (d) =>
      d.projectId === project.id &&
      ((!d.archivedAt && (!reviewing || d.capabilities.review)) ||
        value.includes(d.id)),
  );
  const text = value.length ? value.map(disciplineName).join(", ") : empty;
  if (!canEdit) return <span className={chip}>{text}</span>;
  return (
    <Popover
      width={240}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`${empty}: ${text}`}
          className={cn(chip, "hover:bg-muted")}
        >
          {text}
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      )}
    >
      <Picker
        title="Disciplines"
        multiple
        hideSearch
        emptyText={
          reviewing
            ? "No discipline of this project can review."
            : "This project has no disciplines."
        }
        options={options.map((d) => ({
          value: d.id,
          label: d.name,
          hint: d.archivedAt ? "Archived" : undefined,
        }))}
        value={value}
        onSelect={(id) =>
          onChange(
            value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
          )
        }
      />
    </Popover>
  );
}

const addLabels: Record<string, [ReadinessCheckKind, string][]> = {
  written: [["section", "Require a section"]],
  reviewed: [["discipline_approval", "Require a discipline’s approval"]],
  confirmed: [["manual", "Add a sign-off"]],
};

function AddRule({
  group,
  onAdd,
}: {
  group: string;
  onAdd: (kind: ReadinessCheckKind) => void;
}) {
  return (
    <div className="flex gap-3 py-1">
      {(addLabels[group] ?? []).map(([kind, text]) => (
        <button
          key={kind}
          type="button"
          onClick={() => onAdd(kind)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Plus className="size-3" /> {text}
        </button>
      ))}
    </div>
  );
}

function StartingPolicy({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { run, error } = useCommand();
  const external = project.deliveryMode === "external";
  return (
    <div className="space-y-2 border-t px-5 py-3">
      <p className="text-[13px] font-medium">
        When work starts before it’s ready
        {external && (
          <span className="ml-1 font-normal text-muted-foreground">
            · only ready work is handed off to Jira
          </span>
        )}
      </p>
      <Choice
        label="Readiness policy"
        value={project.readinessPolicy}
        disabled={!canEdit || external}
        onChange={(readinessPolicy) =>
          void run({
            type: "updateProject",
            projectId: project.id,
            readinessPolicy,
          })
        }
        options={[
          {
            value: "off",
            label: "Allow",
            description: "Readiness is informative only.",
          },
          {
            value: "warn",
            label: "Warn",
            description: "Allowed, and recorded in activity.",
          },
          {
            value: "block",
            label: "Block",
            description: "Only ready specifications can start.",
          },
        ]}
      />
      <InlineError>{error}</InlineError>
    </div>
  );
}

// Publishing is reviewed like a change: what differs, and what it does to the
// project's items, computed by the server without writing anything.
function Review({
  project,
  latest,
  base,
  rules,
  changes,
  outdated,
  onBack,
  onPublished,
}: {
  project: Project;
  latest: ReadinessRevision;
  base: ReadinessRevision;
  rules: ReadinessRules;
  changes: { type: WorkItemType; changes: ReadinessChange[] }[];
  outdated: boolean;
  onBack: () => void;
  onPublished: () => void;
}) {
  const { organization, mutateConfirmed, disciplineName } = useWorkspace();
  const [impact, setImpact] = useState<ReadinessImpact>();
  const [error, setError] = useState<string>();
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState(false);
  const next = latest.number === 0 ? 2 : latest.number + 1;
  const current = base.number === 0 ? 1 : base.number;
  useEffect(() => {
    let cancelled = false;
    fetch("/api/readiness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        projectId: project.id,
        rules,
      }),
    })
      .then(async (r) => {
        const body: unknown = await r.json();
        if (!r.ok)
          throw new Error(
            (body as { error?: { message?: string } }).error?.message ??
              "The impact could not be computed.",
          );
        return readinessImpactSchema.parse(body);
      })
      .then((value) => !cancelled && setImpact(value))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setError(e instanceof Error ? e.message : "Impact unavailable."),
      );
    return () => {
      cancelled = true;
    };
  }, [organization.id, project.id, rules]);
  const publish = async () => {
    setPending(true);
    setError(undefined);
    try {
      await mutateConfirmed({
        type: "publishReadinessChecks",
        projectId: project.id,
        baseRevisionId: base.id,
        rules,
        summary: summary.trim() || undefined,
      });
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not published.");
    } finally {
      setPending(false);
    }
  };
  const itemLinks = (items: ReadinessImpact["becomeReady"]) => (
    <span className="text-xs text-muted-foreground">
      {items.slice(0, 8).map((item, index) => (
        <span key={item.id}>
          {index > 0 && ", "}
          <Link
            href={`/${organization.slug}/items/${item.key}`}
            className="font-mono underline-offset-2 hover:text-foreground hover:underline"
          >
            {item.key}
          </Link>
        </span>
      ))}
      {items.length > 8 && ` and ${items.length - 8} more`}
    </span>
  );
  return (
    <div>
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm font-semibold">Publish version {next}?</p>
        <ul className="space-y-1.5 text-[13px]">
          {changes.map(({ type, changes: list }) =>
            list.map(({ check, change }) => (
              <li key={`${type.id}:${check.id}`} className="flex gap-2">
                <ChangeTag change={change} />
                <span>
                  <span className="text-muted-foreground">{type.name}:</span>{" "}
                  {checkLabel(check, disciplineName)}
                </span>
              </li>
            )),
          )}
        </ul>
      </div>
      <div className="border-t px-5 py-2">
        {!impact && !error && (
          <p className="py-2 text-[13px] text-muted-foreground">
            Checking the project’s items…
          </p>
        )}
        {impact && (
          <>
            <Impact
              count={impact.kept}
              title={`ready or done ${impact.kept === 1 ? "item keeps" : "items keep"} version ${current}`}
            >
              Finished work never loses readiness because the rules changed.
            </Impact>
            <Impact
              count={impact.becomeReady.length}
              tone="text-success"
              title="become Ready when you publish"
            >
              {impact.becomeReady.length > 0 && itemLinks(impact.becomeReady)}
            </Impact>
            <Impact
              count={impact.needMoreWork.length}
              tone="text-amber-600 dark:text-amber-400"
              title="will need more work"
            >
              {impact.reasons.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-muted-foreground">
                  {impact.reasons.map((r) => (
                    <li key={r.label}>
                      {r.count} fail “{r.label}”
                    </li>
                  ))}
                </ul>
              )}
              {impact.needMoreWork.length > 0 && itemLinks(impact.needMoreWork)}
            </Impact>
            <Impact count={impact.unaffected} title="are unaffected">
              Their outcome does not change.
            </Impact>
          </>
        )}
      </div>
      <div className="space-y-2 border-t px-5 py-3">
        {outdated && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px]">
            {versionName(latest.number)} was published meanwhile. Go back and
            discard your changes to start from it.
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={500}
            placeholder="Why is this changing? (shown in history)"
            aria-label="Change summary"
            className="h-8 min-w-48 flex-1 rounded-md border bg-card px-2.5 text-[13px] outline-none focus:border-primary/60"
          />
          <Button variant="ghost" size="md" onClick={onBack}>
            Back
          </Button>
          <Button
            size="md"
            disabled={pending || outdated}
            onClick={() => void publish()}
          >
            Publish version {next}
          </Button>
        </div>
        <InlineError>{error}</InlineError>
      </div>
    </div>
  );
}

function Impact({
  count,
  title,
  tone,
  children,
}: {
  count: number;
  title: string;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-3 border-b border-dashed py-2.5 last:border-0">
      <span
        className={cn(
          "w-8 shrink-0 text-lg leading-6 font-semibold tabular-nums",
          tone,
        )}
      >
        {count}
      </span>
      <div className="min-w-0 space-y-0.5 text-[13px]">
        <p className="font-medium">{title}</p>
        {typeof children === "string" ? (
          <p className="text-xs text-muted-foreground">{children}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// Versions are read on demand. Each shows what it changed from the previous
// one; any of them can be loaded into the editor and published again.
function VersionHistory({
  project,
  latest,
  onLoad,
}: {
  project: Project;
  latest: ReadinessRevision;
  onLoad?: (revision: ReadinessRevision) => void;
}) {
  const { organization, memberName, disciplineName } = useWorkspace();
  const types = useSpecTypes(project);
  const [revisions, setRevisions] = useState<ReadinessRevision[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    readinessHistory(organization.id, project.id)
      .then((list) => !cancelled && setRevisions(list))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setError(e instanceof Error ? e.message : "History unavailable."),
      );
    return () => {
      cancelled = true;
    };
  }, [organization.id, project.id, latest.number]);
  const typeName = (id: string) =>
    types.find((t) => t.id === id)?.name ?? "A former type";
  return (
    <SettingsSection
      id="history"
      icon={<History />}
      title="History"
      description="Versions are never changed. Items that were ready or done when a version was published keep the rules they met."
    >
      {error ? (
        <SettingsBody>
          <InlineError>{error}</InlineError>
        </SettingsBody>
      ) : !revisions ? (
        <SettingsBody>
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        </SettingsBody>
      ) : (
        <SettingsList isEmpty={false} empty={null}>
          {revisions.map((revision, index) => {
            const previous = revisions[index + 1];
            const typeIds = [
              ...new Set([
                ...Object.keys(revision.rules),
                ...Object.keys(previous?.rules ?? {}),
              ]),
            ];
            const diff = previous
              ? typeIds.flatMap((typeId) =>
                  diffReadinessChecks(
                    checksFor(previous.rules, typeId),
                    checksFor(revision.rules, typeId),
                  ).map((c) => ({ ...c, typeId })),
                )
              : [];
            return (
              <div key={revision.number} className="space-y-1 px-5 py-2.5">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="font-medium">
                    {versionName(revision.number)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {revision.authorId
                      ? memberName(revision.authorId)
                      : "Lictory"}
                    {revision.createdAt &&
                      ` · ${relativeTime(revision.createdAt)}`}
                    {revision.summary && ` · ${revision.summary}`}
                  </span>
                  {revision.number === latest.number ? (
                    <span className="text-xs text-muted-foreground">
                      Current
                    </span>
                  ) : (
                    onLoad && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onLoad(revision)}
                      >
                        Restore
                      </Button>
                    )
                  )}
                </div>
                {diff.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {diff.map(({ check, change, typeId }) => (
                      <li key={`${typeId}:${check.id}`}>
                        {change === "added"
                          ? "+"
                          : change === "removed"
                            ? "−"
                            : "~"}{" "}
                        {typeName(typeId)}: {checkLabel(check, disciplineName)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </SettingsList>
      )}
    </SettingsSection>
  );
}
