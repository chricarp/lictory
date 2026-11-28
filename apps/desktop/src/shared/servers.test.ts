import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deepLinkFromArgv,
  originForHost,
  parseDeepLink,
  serverForLink,
} from "./deep-link";
import {
  parseServerAddress,
  probeServer,
  readProbe,
  type ProbeFetch,
} from "./server-address";
import {
  addServer,
  emptyServers,
  initials,
  moveServer,
  nameFromOrganization,
  normalizeServers,
  partitionFor,
  removeServer,
  serverForShortcut,
  updateServer,
} from "./servers";

const now = new Date("2026-11-24T10:00:00Z");

void test("a typed address becomes a server origin", () => {
  assert.deepEqual(parseServerAddress(" lictory.example.com "), {
    ok: true,
    origin: "https://lictory.example.com",
    insecure: false,
  });
  assert.deepEqual(
    parseServerAddress("https://Lictory.Example.com:8443/acme/inbox?x#y"),
    { ok: true, origin: "https://lictory.example.com:8443", insecure: false },
  );
  assert.deepEqual(parseServerAddress("localhost:3000"), {
    ok: true,
    origin: "http://localhost:3000",
    insecure: false,
  });
  assert.deepEqual(parseServerAddress("http://lictory.internal"), {
    ok: true,
    origin: "http://lictory.internal",
    insecure: true,
  });
  for (const input of [
    "",
    "   ",
    "ftp://lictory.example.com",
    "https://admin:pw@lictory.example.com",
    "lictory example.com",
    "https://",
  ]) {
    const result = parseServerAddress(input);
    assert.equal(result.ok, false, input);
  }
  // The message names both schemes the form accepts.
  assert.deepEqual(parseServerAddress("ftp://lictory.example.com"), {
    ok: false,
    error:
      "A Lictory server address starts with https:// (or http://), not ftp://.",
  });
});

const lictoryBody = {
  user: null,
  providers: { google: false, microsoft: false, oidc: true },
  signIn: { password: true, ssoName: "Acme SSO", signUpMode: "invite" },
};

void test("a server is Lictory when its session endpoint answers like one", () => {
  const response = {
    status: 200,
    url: "https://lictory.example.com/api/session",
    contentType: "application/json; charset=utf-8",
    body: lictoryBody,
  };
  assert.deepEqual(readProbe("https://lictory.example.com", response), {
    ok: true,
    origin: "https://lictory.example.com",
    insecure: false,
  });
  // A redirect to the canonical address is followed.
  assert.deepEqual(
    readProbe("http://lictory.example.com", {
      ...response,
      url: "https://app.lictory.example.com/api/session",
    }),
    { ok: true, origin: "https://app.lictory.example.com", insecure: false },
  );
  // A downgrade is not.
  assert.equal(
    readProbe("https://lictory.example.com", {
      ...response,
      url: "http://lictory.example.com/api/session",
    }).ok,
    false,
  );
  for (const wrong of [
    { ...response, status: 404 },
    { ...response, contentType: "text/html" },
    { ...response, body: { user: null } },
    { ...response, body: [] },
  ])
    assert.equal(readProbe("https://lictory.example.com", wrong).ok, false);
  const down = readProbe("https://lictory.example.com", {
    ...response,
    status: 502,
  });
  assert.equal(down.ok, false);
  assert.match(!down.ok ? down.error : "", /HTTP 502/);
});

void test("probing reports unreachable and silent servers", async () => {
  const unreachable: ProbeFetch = () =>
    Promise.reject(new Error("net::ERR_NAME_NOT_RESOLVED"));
  const result = await probeServer("https://nowhere.example", unreachable);
  assert.equal(result.ok, false);
  // Plain words with the next step; the code is a detail, not the message.
  assert.equal(
    !result.ok ? result.error : "",
    "No server named nowhere.example could be found. Check the address. On a company network, connect to it or its VPN.",
  );
  assert.equal(!result.ok ? result.detail : "", "ERR_NAME_NOT_RESOLVED");

  const silent: ProbeFetch = (_url, init) =>
    new Promise((_resolve, reject) =>
      init.signal.addEventListener("abort", () => reject(new Error("aborted"))),
    );
  const timedOut = await probeServer("https://slow.example", silent, 10);
  assert.match(!timedOut.ok ? timedOut.error : "", /did not answer/);

  const lictory: ProbeFetch = async (url) => ({
    status: 200,
    url,
    headers: { get: () => "application/json" },
    json: async () => lictoryBody,
  });
  assert.equal(
    (await probeServer("https://lictory.example.com", lictory)).ok,
    true,
  );
});

void test("deep links name a server host and an in-app path", () => {
  assert.deepEqual(
    parseDeepLink("lictory://Lictory.Example.com/acme/items/PAY-142?pr=3#c1"),
    { host: "lictory.example.com", path: "/acme/items/PAY-142?pr=3#c1" },
  );
  assert.deepEqual(parseDeepLink("lictory://localhost:3000"), {
    host: "localhost:3000",
    path: "/",
  });
  assert.deepEqual(parseDeepLink("LICTORY://lictory.example.com/"), {
    host: "lictory.example.com",
    path: "/",
  });
  for (const link of [
    "https://lictory.example.com/acme",
    "lictory://",
    "lictory://user:pw@lictory.example.com/x",
    "lictory:///acme",
    "lictory://lictory.example.com//evil.example/x",
    `lictory://h/${"a".repeat(9000)}`,
  ])
    assert.equal(parseDeepLink(link), null, link);
});

void test("the deep link is found among a second instance's arguments", () => {
  assert.equal(
    deepLinkFromArgv([
      "C:\\Program Files\\Lictory\\Lictory.exe",
      "--allow-file-access-from-files",
      "lictory://lictory.example.com/acme",
    ]),
    "lictory://lictory.example.com/acme",
  );
  assert.equal(deepLinkFromArgv(["/usr/bin/lictory", "--hidden"]), null);
});

void test("a link opens on the configured server with that host", () => {
  const servers = [
    { id: "a", origin: "http://lictory.example.com" },
    { id: "b", origin: "https://lictory.example.com" },
    { id: "c", origin: "https://other.example.com:8443" },
  ];
  assert.equal(
    serverForLink({ host: "lictory.example.com", path: "/" }, servers)?.id,
    "b",
  );
  assert.equal(
    serverForLink({ host: "other.example.com:8443", path: "/" }, servers)?.id,
    "c",
  );
  assert.equal(
    serverForLink({ host: "other.example.com", path: "/" }, servers),
    undefined,
  );
  assert.equal(
    originForHost("lictory.example.com"),
    "https://lictory.example.com",
  );
  assert.equal(originForHost("localhost:3000"), "http://localhost:3000");
});

void test("servers are added once, selected, moved and removed", () => {
  const a = addServer(emptyServers, {
    id: "aaaaaaaa-1",
    origin: "https://a.example.com",
    now,
  });
  assert.equal(a.added, true);
  assert.equal(a.state.activeId, "aaaaaaaa-1");
  assert.equal(a.server.name, "a.example.com");
  const b = addServer(a.state, {
    id: "bbbbbbbb-2",
    origin: "https://b.example.com",
    name: "Acme",
    now,
  });
  assert.equal(b.state.activeId, "bbbbbbbb-2");
  const again = addServer(b.state, {
    id: "cccccccc-3",
    origin: "https://a.example.com",
    now,
  });
  assert.equal(again.added, false);
  assert.equal(again.state.servers.length, 2);
  assert.equal(again.state.activeId, "aaaaaaaa-1");

  const moved = moveServer(b.state, "bbbbbbbb-2", -1);
  assert.deepEqual(
    moved.servers.map((s) => s.id),
    ["bbbbbbbb-2", "aaaaaaaa-1"],
  );
  assert.equal(serverForShortcut(moved, 1)?.id, "bbbbbbbb-2");
  assert.equal(serverForShortcut(moved, 3), undefined);

  const removed = removeServer(b.state, "bbbbbbbb-2");
  assert.equal(removed.activeId, "aaaaaaaa-1");
  assert.equal(removeServer(removed, "aaaaaaaa-1").activeId, null);
  assert.equal(partitionFor({ id: "aaaaaaaa-1" }), "persist:server-aaaaaaaa-1");
});

void test("a damaged servers file keeps its valid entries", () => {
  const state = normalizeServers({
    activeId: "missing",
    servers: [
      { id: "aaaaaaaa-1", origin: "https://a.example.com/path", name: " A " },
      { id: "aaaaaaaa-1", origin: "https://dup.example.com" },
      { id: "bbbbbbbb-2", origin: "https://a.example.com" },
      { id: "short", origin: "https://c.example.com" },
      { id: "dddddddd-4", origin: "javascript:alert(1)" },
      {
        id: "eeeeeeee-5",
        origin: "https://e.example.com",
        lastPath: "//evil.example",
        zoomLevel: 99,
      },
      "garbage",
    ],
  });
  assert.deepEqual(
    state.servers.map((s) => [s.id, s.origin, s.name]),
    [
      ["aaaaaaaa-1", "https://a.example.com", "A"],
      ["eeeeeeee-5", "https://e.example.com", "e.example.com"],
    ],
  );
  assert.equal(state.activeId, "aaaaaaaa-1");
  assert.equal(state.servers[1]?.lastPath, null);
  assert.equal(state.servers[1]?.zoomLevel, 5);
  assert.deepEqual(normalizeServers(null), emptyServers);
});

void test("a servers file written by an administrator before the first launch", () => {
  // The managed-computer recipe of the docs (basics/desktop): only ids and
  // origins; everything else takes its default.
  const state = normalizeServers({
    servers: [{ id: "managed-lictory", origin: "https://lictory.example.com" }],
  });
  assert.deepEqual(state, {
    activeId: "managed-lictory",
    servers: [
      {
        id: "managed-lictory",
        origin: "https://lictory.example.com",
        name: "lictory.example.com",
        organization: null,
        addedAt: new Date(0).toISOString(),
        lastPath: null,
        zoomLevel: 0,
      },
    ],
  });
});

void test("stored paths and names are validated on update", () => {
  const { state } = addServer(emptyServers, {
    id: "aaaaaaaa-1",
    origin: "https://a.example.com",
    now,
  });
  const updated = updateServer(state, "aaaaaaaa-1", {
    lastPath: "/acme/inbox",
    name: "  ",
  });
  assert.equal(updated.servers[0]?.lastPath, "/acme/inbox");
  assert.equal(updated.servers[0]?.name, "a.example.com");
  assert.equal(
    updateServer(updated, "aaaaaaaa-1", { lastPath: "https://x" }).servers[0]
      ?.lastPath,
    null,
  );
});

void test("a server is named after its organization unless the person named it", () => {
  const { state } = addServer(emptyServers, {
    id: "aaaaaaaa-1",
    origin: "http://localhost:6201",
    now,
  });
  const named = nameFromOrganization(
    state,
    "aaaaaaaa-1",
    " Harborline\nFreight ",
  );
  assert.equal(named.servers[0]?.name, "Harborline Freight");
  assert.equal(initials(named.servers[0].name), "HF");
  // Unchanged: the same state, so nothing is written.
  assert.equal(
    nameFromOrganization(named, "aaaaaaaa-1", "Harborline Freight"),
    named,
  );
  // The organization renames itself; the server follows.
  const renamed = nameFromOrganization(named, "aaaaaaaa-1", "Harborline");
  assert.equal(renamed.servers[0]?.name, "Harborline");
  // No single organization any more: back to the host.
  const none = nameFromOrganization(renamed, "aaaaaaaa-1", null);
  assert.equal(none.servers[0]?.name, "localhost:6201");
  assert.equal(none.servers[0]?.organization, null);
  // A name the person chose stays.
  const chosen = updateServer(renamed, "aaaaaaaa-1", { name: "Work" });
  assert.equal(
    nameFromOrganization(chosen, "aaaaaaaa-1", "Acme").servers[0]?.name,
    "Work",
  );
  // It survives a restart.
  assert.equal(
    normalizeServers(JSON.parse(JSON.stringify(named))).servers[0]
      ?.organization,
    "Harborline Freight",
  );
});

void test("switcher initials", () => {
  assert.equal(initials("Acme Payments"), "AP");
  assert.equal(initials("lictory.example.com"), "LE");
  assert.equal(initials("acme.com"), "AC");
  // Addresses without a name to abbreviate get the server glyph instead.
  assert.equal(initials("localhost:3000"), "");
  assert.equal(initials("127.0.0.1:5001"), "");
  assert.equal(initials("[::1]:3000"), "");
});
