// Plain-language descriptions of the assistant's tool calls, so the chat shows
// "Read PAY-142 Checkout retries" instead of a capability name and JSON. Pure:
// the caller supplies a lookup that resolves ids against the synced workspace.

export type ItemRef = {
  id?: string;
  key: string;
  title?: string;
  href?: string;
};

export type RefKind =
  | "project"
  | "member"
  | "status"
  | "type"
  | "team"
  | "iteration"
  | "discipline"
  | "label"
  | "milestone";

export type Lookup = {
  item(ref: { id?: string; key?: string }): ItemRef | undefined;
  name(kind: RefKind, id: string): string | undefined;
};

export type StepKind = "read" | "search" | "write";

export type Subject =
  | { kind: "item"; item: ItemRef }
  | { kind: "text"; text: string; quoted?: boolean };

export type Outcome = {
  // A one-line summary of what came back, e.g. "12 of 40 work items".
  summary: string | null;
  items: ItemRef[];
  error: string | null;
};

export type Step = {
  kind: StepKind;
  // "Create work item": waiting for approval, declined or failed.
  action: string;
  running: string;
  done: string;
  subject: Subject | null;
  fields: [string, string][];
  outcome: Outcome;
};

const verbs: Record<string, [running: string, done: string, kind?: StepKind]> =
  {
    list: ["Listing", "Listed", "search"],
    search: ["Searching", "Searched", "search"],
    get: ["Reading", "Read", "read"],
    count: ["Counting", "Counted", "read"],
    describe: ["Inspecting", "Inspected", "read"],
    preview: ["Previewing", "Previewed", "read"],
    create: ["Creating", "Created"],
    update: ["Updating", "Updated"],
    archive: ["Archiving", "Archived"],
    remove: ["Removing", "Removed"],
    delete: ["Deleting", "Deleted"],
    set: ["Setting", "Set"],
    add: ["Adding", "Added"],
    request: ["Requesting", "Requested"],
    reply: ["Replying", "Replied"],
    decide: ["Deciding", "Decided"],
    merge: ["Merging", "Merged"],
    rank: ["Ranking", "Ranked"],
    reorder: ["Reordering", "Reordered"],
    start: ["Starting", "Started"],
    complete: ["Completing", "Completed"],
    commit: ["Committing", "Committed"],
    publish: ["Publishing", "Published"],
    mark: ["Marking", "Marked"],
    sync: ["Syncing", "Synced"],
    cancel: ["Canceling", "Canceled"],
    revert: ["Reverting", "Reverted"],
    rerun: ["Rerunning", "Reran"],
    apply: ["Applying", "Applied"],
    connect: ["Connecting", "Connected"],
    disconnect: ["Disconnecting", "Disconnected"],
    refresh: ["Refreshing", "Refreshed"],
    link: ["Linking", "Linked"],
    unlink: ["Unlinking", "Unlinked"],
    revise: ["Revising", "Revised"],
    reset: ["Resetting", "Reset"],
    revoke: ["Revoking", "Revoked"],
    finish: ["Finishing", "Finished"],
    watch: ["Watching", "Watched"],
  };

// Names whose generic reading would be awkward.
const phrases: Record<
  string,
  [running: string, done: string, kind?: StepKind]
> = {
  getWorkspace: ["Reading workspace setup", "Read workspace setup", "read"],
  getWatching: ["Checking watch state", "Checked watch state", "read"],
  updateSpecification: ["Revising specification", "Revised specification"],
  revertSpecification: ["Restoring revision", "Restored revision"],
  createThread: ["Starting discussion", "Started discussion"],
  replyToThread: ["Replying to discussion", "Replied to discussion"],
  setThreadState: ["Updating discussion", "Updated discussion"],
  requestAiReview: [
    "Requesting Intelligence review",
    "Requested Intelligence review",
  ],
  publishDelivery: ["Exporting to delivery tool", "Exported to delivery tool"],
  syncRead: ["Synchronizing workspace", "Synchronized workspace", "read"],
  getInsights: ["Gathering insights", "Gathered insights", "read"],
};

// "createWorkItem" -> "Create work item".
export function humanize(name: string) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function phrase(name: string): [string, string, StepKind] {
  const fixed = phrases[name];
  if (fixed) return [fixed[0], fixed[1], fixed[2] ?? "write"];
  const verb = /^[a-z]+/.exec(name)?.[0] ?? "";
  const rest = humanize(name).slice(verb.length).trim().toLowerCase();
  const known = verbs[verb];
  if (!known) return [humanize(name), humanize(name), "write"];
  return [
    rest ? `${known[0]} ${rest}` : known[0],
    rest ? `${known[1]} ${rest}` : known[1],
    known[2] ?? "write",
  ];
}

const refFields: Record<string, RefKind | "item"> = {
  projectId: "project",
  assigneeId: "member",
  userId: "member",
  memberId: "member",
  reviewerId: "member",
  reviewerIds: "member",
  statusId: "status",
  typeId: "type",
  teamId: "team",
  iterationId: "iteration",
  disciplineId: "discipline",
  disciplineIds: "discipline",
  labelId: "label",
  labelIds: "label",
  milestoneId: "milestone",
  workItemId: "item",
  parentId: "item",
  fromId: "item",
  toId: "item",
};

const hidden = new Set([
  "organizationId",
  "mutationId",
  "protocol",
  "offset",
  "limit",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fieldLabels: Record<string, string> = {
  workItemId: "Work item",
  parentId: "Parent",
  fromId: "From",
  toId: "To",
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function clip(text: string, max = 140) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function itemLabel(item: ItemRef) {
  return item.title ? `${item.key} ${item.title}` : item.key;
}

function resolve(
  key: string,
  value: unknown,
  lookup: Lookup,
): string | undefined {
  const kind = refFields[key];
  if (!kind || value === null || value === undefined) return undefined;
  const one = (id: unknown) => {
    if (typeof id !== "string") return undefined;
    if (kind === "item") {
      const item = lookup.item({ id });
      return item ? itemLabel(item) : undefined;
    }
    return lookup.name(kind, id);
  };
  if (Array.isArray(value)) {
    const names = value.map(one);
    return names.every(Boolean) ? names.join(", ") : undefined;
  }
  return one(value);
}

function display(value: unknown): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return clip(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v !== "object"))
    return value.length ? clip(value.join(", ")) : "None";
  return clip(JSON.stringify(value));
}

// The parts of a tool input a person cares about, with ids replaced by names.
// Pagination, unset flags and ids that name nothing readable are left to the
// raw data view.
export function describeInput(
  input: unknown,
  lookup: Lookup,
  skip: string[] = [],
): [string, string][] {
  const fields = record(input);
  if (!fields) return [];
  return Object.entries(fields)
    .filter(
      ([k, v]) =>
        v !== undefined &&
        v !== "" &&
        v !== false &&
        !hidden.has(k) &&
        !skip.includes(k),
    )
    .flatMap(([k, v]): [string, string][] => {
      const value = resolve(k, v, lookup) ?? display(v);
      if (uuid.test(value)) return [];
      return [[fieldLabels[k] ?? humanize(k.replace(/Ids?$/, "")), value]];
    })
    .slice(0, 8);
}

function asItem(value: unknown, lookup: Lookup): ItemRef | undefined {
  const r = record(value);
  if (!r || typeof r.key !== "string") return undefined;
  const id = typeof r.id === "string" ? r.id : undefined;
  const known = lookup.item({ id, key: r.key });
  return {
    id,
    key: r.key,
    title: typeof r.title === "string" ? r.title : known?.title,
    href: known?.href,
  };
}

// Tool results are `{ ok, result }` or `{ ok: false, error }` (see agentTools).
function outcomeOf(
  output: unknown,
  errorText: string | undefined,
  lookup: Lookup,
): Outcome {
  if (errorText) return { summary: null, items: [], error: errorText };
  const envelope = record(output);
  if (envelope?.ok === false)
    return {
      summary: null,
      items: [],
      error:
        (record(envelope.error)?.message as string | undefined) ??
        "The action failed.",
    };
  const result = record(envelope?.result);
  if (!result) return { summary: null, items: [], error: null };
  if (typeof result.headline === "string")
    return { summary: result.headline, items: [], error: null };
  const single = asItem(result.item, lookup);
  if (single) return { summary: null, items: [single], error: null };
  for (const [key, value] of Object.entries(result)) {
    if (!Array.isArray(value)) continue;
    const items = value.flatMap((v) => asItem(v, lookup) ?? []);
    const noun =
      items.length === value.length && items.length > 0
        ? "work items"
        : humanize(key).toLowerCase();
    const total = typeof result.total === "number" ? result.total : null;
    const count =
      total !== null && total !== value.length
        ? `${value.length} of ${total}`
        : String(value.length);
    return {
      summary: value.length === 0 ? `No ${noun}` : `${count} ${noun}`,
      items: items.slice(0, 5),
      error: null,
    };
  }
  return { summary: null, items: [], error: null };
}

function subjectOf(
  input: Record<string, unknown> | undefined,
  outcome: Outcome,
  output: unknown,
  lookup: Lookup,
): { subject: Subject | null; used: string[] } {
  const created = record(record(output)?.result)?.workItemId;
  const fromOutput =
    typeof created === "string" ? lookup.item({ id: created }) : undefined;
  if (outcome.items.length === 1 && !outcome.summary)
    return { subject: { kind: "item", item: outcome.items[0]! }, used: [] };
  if (typeof input?.key === "string") {
    const item = lookup.item({ key: input.key }) ?? { key: input.key };
    return { subject: { kind: "item", item }, used: ["key"] };
  }
  if (typeof input?.workItemId === "string") {
    const item = lookup.item({ id: input.workItemId });
    if (item) return { subject: { kind: "item", item }, used: ["workItemId"] };
  }
  if (fromOutput)
    return {
      subject: { kind: "item", item: fromOutput },
      used: input?.title ? ["title"] : [],
    };
  for (const key of ["query", "q"]) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim())
      return {
        subject: { kind: "text", text: clip(value, 60), quoted: true },
        used: [key],
      };
  }
  for (const key of ["title", "name", "topic"]) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim())
      return {
        subject: { kind: "text", text: clip(value, 60) },
        used: [key],
      };
  }
  if (typeof input?.projectId === "string") {
    const project = lookup.name("project", input.projectId);
    if (project)
      return { subject: { kind: "text", text: project }, used: ["projectId"] };
  }
  return { subject: null, used: [] };
}

export function describeStep(
  name: string,
  input: unknown,
  output: unknown,
  errorText: string | undefined,
  lookup: Lookup,
): Step {
  const [running, done, kind] = phrase(name);
  const outcome = outcomeOf(output, errorText, lookup);
  const fields = record(input);
  const { subject, used } = subjectOf(fields, outcome, output, lookup);
  return {
    kind,
    action: humanize(name),
    running,
    done,
    subject,
    fields: describeInput(input, lookup, used),
    outcome,
  };
}

export function subjectText(subject: Subject) {
  return subject.kind === "item"
    ? itemLabel(subject.item)
    : subject.quoted
      ? `“${subject.text}”`
      : subject.text;
}

// One line for a finished run of steps: "5 steps · 2 changes · 1 failed".
export function summarizeSteps(
  steps: { step: Pick<Step, "kind">; failed: boolean; declined: boolean }[],
) {
  const changes = steps.filter(
    (s) => s.step.kind === "write" && !s.failed && !s.declined,
  ).length;
  const failed = steps.filter((s) => s.failed).length;
  const parts = [`${steps.length} ${steps.length === 1 ? "step" : "steps"}`];
  if (changes) parts.push(`${changes} ${changes === 1 ? "change" : "changes"}`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

export type Change = { verb: string; subject: Subject };

// What the assistant changed in one answer, newest verb per subject, so the
// person sees at a glance which items it touched.
export function changesOf(
  steps: { step: Step; failed: boolean; declined: boolean; done: boolean }[],
): Change[] {
  const changes = new Map<string, Change>();
  for (const { step, failed, declined, done } of steps) {
    if (step.kind !== "write" || failed || declined || !done || !step.subject)
      continue;
    const id =
      step.subject.kind === "item"
        ? `item:${step.subject.item.id ?? step.subject.item.key}`
        : `text:${step.subject.text}`;
    const verb = step.done.split(" ")[0]!;
    const previous = changes.get(id);
    changes.delete(id);
    changes.set(id, {
      verb: previous?.verb === "Created" ? "Created" : verb,
      subject: step.subject,
    });
  }
  return [...changes.values()];
}

// "12 created · 3 updated", most frequent first, for answers that touched
// too many things to list inline.
export function summarizeChanges(changes: Change[]) {
  const counts = new Map<string, number>();
  for (const { verb } of changes) counts.set(verb, (counts.get(verb) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([verb, n]) => `${n} ${verb.toLowerCase()}`)
    .join(" · ");
}
