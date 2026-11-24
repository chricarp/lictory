import {
  DeliveryError,
  type DeliveryConnection,
  type DeliveryPayload,
  type DeliveryProvider,
  type ExternalItem,
  type OwnedField,
} from "@lictory/core/delivery/provider";

// In-memory provider for domain tests. Behaves like a well-behaved external
// system: stable ids, human keys, a clock, and per-call failure injection so
// tests can prove idempotency and partial-failure recovery.

type Stored = ExternalItem & { content: string; managedLabels: string[] };

// Issue types with Jira's hierarchy: an issue's parent must sit strictly
// higher (an Epic holds Stories and Tasks, a Story or Task holds Subtasks;
// a Task cannot sit under a Story).
const types = [
  { id: "epic", name: "Epic", hierarchyLevel: 1 },
  { id: "story", name: "Story", hierarchyLevel: 0 },
  { id: "task", name: "Task", hierarchyLevel: 0 },
  { id: "subtask", name: "Subtask", hierarchyLevel: -1 },
].map((t) => ({ ...t, unsupportedRequiredFields: [] }));
const levelOf = (typeId: string) =>
  types.find((t) => t.id === typeId)?.hierarchyLevel ?? 0;

export function createFakeProvider() {
  const items = new Map<string, Stored>();
  const edits: { id: string; field: OwnedField; at: Date }[] = [];
  const failures: {
    method: keyof DeliveryProvider;
    error: DeliveryError;
    when?: (payload?: DeliveryPayload) => boolean;
  }[] = [];
  const calls: string[] = [];
  let sequence = 0;
  let clock = Date.UTC(2026, 0, 1);
  const now = () => new Date((clock += 1000));

  const fail = (method: keyof DeliveryProvider, payload?: DeliveryPayload) => {
    calls.push(method);
    const index = failures.findIndex(
      (f) => f.method === method && (!f.when || f.when(payload)),
    );
    if (index >= 0) throw failures.splice(index, 1)[0]!.error;
  };

  const write = (stored: Stored, payload: DeliveryPayload) => {
    const parent = payload.parent && items.get(payload.parent.id);
    if (parent && levelOf(parent.typeId) <= levelOf(payload.externalTypeId))
      throw new DeliveryError(
        "validation",
        `Jira rejected the item: ${parent.key} cannot be its parent.`,
        { parent: "The parent issue type is not above this issue type." },
      );
    const foreign = stored.labels.filter(
      (l) => !stored.managedLabels.includes(l),
    );
    stored.title = payload.title;
    stored.content = payload.content;
    stored.managedLabels = [...payload.labels];
    stored.labels = [...new Set([...foreign, ...payload.labels])];
    stored.parentId = payload.parent?.id ?? stored.parentId;
    stored.lictoryItemId = payload.lictoryItemId;
    stored.updatedAt = now();
    return { ...stored };
  };

  const provider: DeliveryProvider = {
    kind: "jira_cloud",
    normalizeBaseUrl: (url) => new URL(url).origin,
    async verify(connection: DeliveryConnection) {
      fail("verify");
      return {
        accountLabel: (connection.credential as { email?: string }).email ?? "",
      };
    },
    async listProjects() {
      fail("listProjects");
      return [{ id: "p1", key: "EXT", name: "External" }];
    },
    async describeProject() {
      fail("describeProject");
      return {
        id: "p1",
        key: "EXT",
        name: "External",
        types,
      };
    },
    async getItem(_connection, idOrKey) {
      fail("getItem");
      const item =
        items.get(idOrKey) ??
        [...items.values()].find((i) => i.key === idOrKey);
      return item ? { ...item } : null;
    },
    async getItems(_connection, ids) {
      fail("getItems");
      return ids.flatMap((id) => {
        const item = items.get(id);
        return item ? [{ ...item }] : [];
      });
    },
    async findCreated(_connection, _target, hint) {
      fail("findCreated");
      const item = [...items.values()].find(
        (i) => i.lictoryItemId === hint.lictoryItemId,
      );
      return item ? { ...item } : null;
    },
    async createItem(_connection, target, payload) {
      fail("createItem", payload);
      const id = String(++sequence);
      const stored: Stored = {
        id,
        key: `${target.projectKey}-${sequence}`,
        url: `https://fake.test/browse/${target.projectKey}-${sequence}`,
        title: "",
        status: "To Do",
        statusCategory: "todo",
        assignee: null,
        typeId: payload.externalTypeId,
        parentId: null,
        labels: [],
        managedLabels: [],
        updatedAt: now(),
        lictoryItemId: null,
        content: "",
      };
      // A refused create leaves nothing behind, as in Jira.
      const created = write(stored, payload);
      items.set(id, stored);
      return created;
    },
    async updateItem(_connection, ref, payload) {
      fail("updateItem", payload);
      const stored = items.get(ref.id);
      if (!stored)
        throw new DeliveryError("not_found", `${ref.key} no longer exists.`);
      return write(stored, payload);
    },
    async changedSince(_connection, ref, since) {
      fail("changedSince");
      return [
        ...new Set(
          edits
            .filter((e) => e.id === ref.id && e.at > since)
            .map((e) => e.field),
        ),
      ];
    },
    async linkBack() {
      fail("linkBack");
    },
  };

  return {
    provider,
    items,
    calls,
    // Queue a failure for the next call of `method` (optionally only for
    // a matching payload).
    failNext(
      method: keyof DeliveryProvider,
      error: DeliveryError,
      when?: (payload?: DeliveryPayload) => boolean,
    ) {
      failures.push({ method, error, when });
    },
    // Simulate someone editing an owned field directly in the external tool.
    editExternally(id: string, field: OwnedField, value: string) {
      const stored = items.get(id);
      if (!stored) throw new Error(`No fake item ${id}`);
      if (field === "title") stored.title = value;
      else if (field === "content") stored.content = value;
      else stored.labels = stored.labels.filter((l) => l !== value);
      const at = now();
      stored.updatedAt = at;
      edits.push({ id, field, at });
    },
    // Simulate work progressing in the external tool (not an owned field).
    progressExternally(
      id: string,
      status: string,
      statusCategory: Stored["statusCategory"],
      assignee: string | null = null,
    ) {
      const stored = items.get(id);
      if (!stored) throw new Error(`No fake item ${id}`);
      stored.status = status;
      stored.statusCategory = statusCategory;
      stored.assignee = assignee;
      stored.updatedAt = now();
    },
    // Simulate an import: an issue that exists before Lictory links it.
    seed(item: Partial<Stored> & { key: string }) {
      const id = String(++sequence);
      items.set(id, {
        id,
        url: `https://fake.test/browse/${item.key}`,
        title: "",
        status: "To Do",
        statusCategory: "todo",
        assignee: null,
        typeId: "story",
        parentId: null,
        labels: [],
        managedLabels: [],
        updatedAt: now(),
        lictoryItemId: null,
        content: "",
        ...item,
      });
      return id;
    },
  };
}
