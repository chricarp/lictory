import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  DeliveryError,
  DeliveryPayload,
} from "@lictory/core/delivery/provider";
import {
  createJiraCloudProvider,
  JIRA_PROPERTY,
} from "@lictory/core/delivery/jira/provider";

type Call = { method: string; path: string; body: unknown; auth: string };
type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

// A scripted Jira: each request is matched by "METHOD path-prefix".
function fakeJira(
  routes: Record<string, Reply | Reply[] | ((c: Call) => Reply)>,
) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = url.replace(connection.baseUrl, "");
    const call: Call = {
      method: init.method ?? "GET",
      path,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      auth: (init.headers as Record<string, string>).Authorization!,
    };
    calls.push(call);
    const key = Object.keys(routes)
      .filter((k) => `${call.method} ${path}`.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`Unexpected ${call.method} ${path}`);
    const route = routes[key]!;
    const reply =
      typeof route === "function"
        ? route(call)
        : Array.isArray(route)
          ? (route.shift() ?? { status: 500 })
          : route;
    return new Response(
      reply.body === undefined ? null : JSON.stringify(reply.body),
      { status: reply.status ?? 200, headers: reply.headers },
    );
  }) as typeof globalThis.fetch;
  const sleeps: number[] = [];
  const provider = createJiraCloudProvider({
    fetch,
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { provider, calls, sleeps };
}

const connection = {
  baseUrl: "https://acme.atlassian.net",
  credential: { email: "bot@acme.test", apiToken: "secret-token" },
};
const target = { projectId: "10000", projectKey: "PAY" };
const payload: DeliveryPayload = {
  lictoryItemId: "item-1",
  lictoryKey: "PAY-142",
  lictoryUrl: "https://lictory.test/items/PAY-142",
  revisionNumber: 3,
  title: "Retry\npayments",
  content: "## Acceptance criteria\n\n- [ ] Reuses ID",
  labels: ["payments", "needs design"],
  externalTypeId: "10001",
  parent: { id: "20000", key: "PAY-1", url: "" },
};

const issue = (
  overrides: Record<string, unknown> = {},
  property?: unknown,
) => ({
  id: "30000",
  key: "PAY-7",
  fields: {
    summary: "Retry payments",
    status: { name: "To Do" },
    issuetype: { id: "10001" },
    parent: { id: "20000" },
    labels: ["payments", "needs-design"],
    updated: "2026-09-27T10:00:00.000+0000",
    ...overrides,
  },
  ...(property ? { properties: { [JIRA_PROPERTY]: property } } : {}),
});

void test("create sends summary, ADF description, labels, parent and the identity property", async () => {
  const jira = fakeJira({
    "POST /rest/api/3/issue": {
      status: 201,
      body: { id: "30000", key: "PAY-7" },
    },
    "GET /rest/api/3/issue/30000": {
      body: issue({}, { itemId: "item-1", key: "PAY-142", labels: [] }),
    },
  });
  const item = await jira.provider.createItem(connection, target, payload);
  const body = jira.calls[0]!.body as {
    fields: Record<string, unknown> & {
      description: { content: { type: string }[] };
    };
    properties: { key: string; value: unknown }[];
  };
  assert.equal(
    jira.calls[0]!.auth,
    `Basic ${Buffer.from("bot@acme.test:secret-token").toString("base64")}`,
  );
  assert.equal(body.fields.summary, "Retry payments");
  assert.deepEqual(body.fields.project, { id: "10000" });
  assert.deepEqual(body.fields.issuetype, { id: "10001" });
  assert.deepEqual(body.fields.parent, { id: "20000" });
  assert.deepEqual(body.fields.labels, ["payments", "needs-design"]);
  assert.deepEqual(
    body.fields.description.content.map((n) => n.type),
    ["heading", "taskList", "rule", "paragraph"],
  );
  assert.deepEqual(body.properties, [
    {
      key: JIRA_PROPERTY,
      value: {
        itemId: "item-1",
        key: "PAY-142",
        labels: ["payments", "needs-design"],
      },
    },
  ]);
  assert.equal(item.key, "PAY-7");
  assert.equal(item.url, "https://acme.atlassian.net/browse/PAY-7");
  assert.equal(item.status, "To Do");
  assert.equal(item.lictoryItemId, "item-1");
});

void test("update keeps labels added in Jira and removes only labels Lictory pushed", async () => {
  const jira = fakeJira({
    "GET /rest/api/3/issue/30000": {
      body: issue(
        { labels: ["payments", "old", "team-x"] },
        { itemId: "item-1", key: "PAY-142", labels: ["payments", "old"] },
      ),
    },
    "PUT /rest/api/3/issue/30000": { status: 204 },
  });
  await jira.provider.updateItem(
    connection,
    { id: "30000", key: "PAY-7", url: "" },
    payload,
  );
  const edit = jira.calls.find(
    (c) => c.method === "PUT" && c.path === "/rest/api/3/issue/30000",
  )!;
  assert.deepEqual((edit.body as { update: unknown }).update, {
    labels: [{ add: "needs-design" }, { remove: "old" }],
  });
  assert.ok(!("parent" in (edit.body as { fields: object }).fields));
  assert.ok(
    jira.calls.some(
      (c) =>
        c.method === "PUT" && c.path.endsWith(`/properties/${JIRA_PROPERTY}`),
    ),
  );
});

void test("update refuses an issue stamped by another Lictory item", async () => {
  const jira = fakeJira({
    "GET /rest/api/3/issue/30000": {
      body: issue({}, { itemId: "someone-else", key: "PAY-9", labels: [] }),
    },
  });
  await assert.rejects(
    jira.provider.updateItem(
      connection,
      { id: "30000", key: "PAY-7", url: "" },
      payload,
    ),
    (e: DeliveryError) => e.kind === "validation",
  );
  assert.ok(!jira.calls.some((c) => c.method === "PUT"));
});

void test("recovery only adopts an issue carrying this item's property", async () => {
  const jira = fakeJira({
    "POST /rest/api/3/search/jql": {
      body: {
        issues: [
          { ...issue({}, { itemId: "other" }), id: "1", key: "PAY-1" },
          { ...issue({}, { itemId: "item-1" }), id: "2", key: "PAY-2" },
        ],
      },
    },
  });
  const found = await jira.provider.findCreated(connection, target, {
    lictoryItemId: "item-1",
    title: "Retry payments",
    since: new Date(Date.now() - 60_000),
  });
  assert.equal(found?.key, "PAY-2");
  const body = jira.calls[0]!.body as { jql: string; properties: string[] };
  assert.match(
    body.jql,
    /^project = 10000 AND reporter = currentUser\(\) AND created >= -\d+m/,
  );
  assert.deepEqual(body.properties, [JIRA_PROPERTY]);
});

void test("rate limits are retried after Retry-After; auth failures are not", async () => {
  const jira = fakeJira({
    "GET /rest/api/3/myself": [
      { status: 429, headers: { "Retry-After": "2" } },
      { body: { accountId: "a1", displayName: "Lictory Bot" } },
    ],
  });
  assert.deepEqual(await jira.provider.verify(connection), {
    accountLabel: "Lictory Bot (bot@acme.test)",
  });
  assert.deepEqual(jira.sleeps, [2000]);

  const denied = fakeJira({ "GET /rest/api/3/myself": { status: 401 } });
  await assert.rejects(
    denied.provider.verify(connection),
    (e: DeliveryError) => {
      assert.equal(e.kind, "authentication");
      assert.ok(!e.message.includes("secret-token"));
      return true;
    },
  );
  assert.equal(denied.calls.length, 1);
});

void test("an ambiguous create failure is not retried, so it cannot create twice", async () => {
  const jira = fakeJira({
    "POST /rest/api/3/issue": [
      { status: 502 },
      { body: { id: "1", key: "PAY-1" } },
    ],
  });
  await assert.rejects(
    jira.provider.createItem(connection, target, payload),
    (e: DeliveryError) => e.kind === "unavailable" && e.retryable,
  );
  assert.equal(jira.calls.length, 1);

  const limited = fakeJira({
    "POST /rest/api/3/issue": [
      { status: 429, headers: { "Retry-After": "1" } },
      { body: { id: "30000", key: "PAY-7" } },
    ],
    "GET /rest/api/3/issue/30000": { body: issue() },
  });
  await limited.provider.createItem(connection, target, payload);
  assert.equal(
    limited.calls.filter((c) => c.method === "POST").length,
    2,
    "a rate-limited create was not processed and is retried",
  );
});

void test("a hung Jira request times out instead of holding the export", async () => {
  const provider = createJiraCloudProvider({
    timeoutMs: 20,
    maxAttempts: 2,
    sleep: async () => undefined,
    fetch: ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal!.addEventListener("abort", () =>
          reject(init.signal!.reason as Error),
        ),
      )) as typeof globalThis.fetch,
  });
  await assert.rejects(
    provider.getItem(connection, "PAY-1"),
    (e: DeliveryError) => e.kind === "unavailable",
  );
});

void test("validation errors surface Jira's field messages", async () => {
  const jira = fakeJira({
    "POST /rest/api/3/issue": {
      status: 400,
      body: {
        errorMessages: [],
        errors: { components: "Component is required." },
      },
    },
  });
  await assert.rejects(
    jira.provider.createItem(connection, target, payload),
    (e: DeliveryError) =>
      e.kind === "validation" &&
      !e.retryable &&
      e.fieldErrors.components === "Component is required." &&
      e.message.includes("Component is required."),
  );
});

void test("missing issues read as null", async () => {
  const jira = fakeJira({
    "GET /rest/api/3/issue/PAY-404": { status: 404, body: {} },
  });
  assert.equal(await jira.provider.getItem(connection, "PAY-404"), null);
});

void test("external edits after the last export are reported per owned field", async () => {
  const since = new Date("2026-09-27T10:00:00.000Z");
  const jira = fakeJira({
    "GET /rest/api/3/issue/30000?": {
      body: issue(
        {},
        { itemId: "item-1", key: "PAY-142", labels: ["payments"] },
      ),
    },
    "GET /rest/api/3/issue/30000/changelog": {
      body: {
        isLast: true,
        maxResults: 100,
        values: [
          // Before our write: ignored.
          {
            created: "2026-09-27T09:00:00.000Z",
            items: [{ field: "summary", fieldId: "summary" }],
          },
          {
            created: "2026-09-27T11:00:00.000Z",
            items: [
              { field: "status", fieldId: "status" },
              { field: "description", fieldId: "description" },
              // Adding a Jira-only label is fine.
              {
                field: "labels",
                fieldId: "labels",
                fromString: "payments",
                toString: "payments team-x",
              },
            ],
          },
        ],
      },
    },
  });
  const ref = { id: "30000", key: "PAY-7", url: "" };
  assert.deepEqual(await jira.provider.changedSince(connection, ref, since), [
    "content",
  ]);

  const removed = fakeJira({
    "GET /rest/api/3/issue/30000?": {
      body: issue(
        {},
        { itemId: "item-1", key: "PAY-142", labels: ["payments"] },
      ),
    },
    "GET /rest/api/3/issue/30000/changelog": {
      body: {
        isLast: true,
        maxResults: 100,
        values: [
          {
            created: "2026-09-27T11:00:00.000Z",
            items: [
              {
                field: "labels",
                fieldId: "labels",
                fromString: "payments",
                toString: "",
              },
            ],
          },
        ],
      },
    },
  });
  assert.deepEqual(
    await removed.provider.changedSince(connection, ref, since),
    ["labels"],
  );
});

void test("site URLs normalize to an https origin", () => {
  const { provider } = fakeJira({});
  assert.equal(
    provider.normalizeBaseUrl("acme.atlassian.net/jira/"),
    "https://acme.atlassian.net",
  );
  assert.throws(() => provider.normalizeBaseUrl("http://acme.atlassian.net"));
});
