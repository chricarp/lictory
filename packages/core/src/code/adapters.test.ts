import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { createBitbucketProvider } from "@lictory/core/code/bitbucket/provider";
import {
  appJwt,
  createGitHubProvider,
} from "@lictory/core/code/github/provider";
import { createGitLabProvider } from "@lictory/core/code/gitlab/provider";
import { CodeHostError } from "@lictory/core/code/provider";

// A scripted host: answers by method and path, records every request.
function scripted(
  routes: Record<string, (request: Request) => Response | Promise<Response>>,
) {
  const requests: {
    method: string;
    url: string;
    headers: Headers;
    body: string;
  }[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = typeof init?.body === "string" ? init.body : "";
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    });
    const url = new URL(request.url);
    const route = routes[`${request.method} ${url.pathname}`];
    if (!route) return Response.json({ message: "Not Found" }, { status: 404 });
    return route(request);
  }) as typeof globalThis.fetch;
  return { fetch: fakeFetch, requests };
}
const noSleep = { sleep: () => Promise.resolve() };

const pr = (overrides: Record<string, unknown> = {}) => ({
  id: 9001,
  number: 7,
  title: "PAY-1: refunds",
  body: "Implements refunds",
  state: "open",
  draft: false,
  user: { login: "ada", type: "User" },
  head: { ref: "pay-1-refunds", sha: "a".repeat(40) },
  base: { ref: "main" },
  requested_reviewers: [{ login: "grace" }],
  requested_teams: [],
  mergeable: true,
  html_url: "https://github.com/acme/pay/pull/7",
  merged_at: null,
  merged_by: null,
  closed_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  ...overrides,
});

void test("GitHub: a pull request's latest review per person decides", async () => {
  const host = scripted({
    "GET /repos/acme/pay/pulls/7": () => Response.json(pr()),
    "GET /repos/acme/pay/pulls/7/reviews": () =>
      Response.json([
        { user: { login: "grace" }, state: "CHANGES_REQUESTED" },
        { user: { login: "grace" }, state: "APPROVED" },
        { user: { login: "linus" }, state: "COMMENTED" },
      ]),
  });
  const github = createGitHubProvider({ fetch: host.fetch, ...noSleep });
  const connection = {
    baseUrl: "https://github.com",
    authKind: "token" as const,
    credential: { token: "github_pat_x" },
  };
  const info = await github.getPullRequest(
    connection,
    { externalId: "1", fullName: "acme/pay" },
    7,
  );
  assert.equal(info?.reviewDecision, "approved");
  assert.deepEqual(info?.approvedBy, ["grace"]);
  assert.equal(info?.headSha, "a".repeat(40));
  assert.equal(
    host.requests[0]!.headers.get("authorization"),
    "Bearer github_pat_x",
  );
  assert.ok(host.requests[0]!.url.startsWith("https://api.github.com/"));
});

void test("GitHub Enterprise Server uses /api/v3 on its own origin", () => {
  const github = createGitHubProvider();
  assert.equal(github.normalizeBaseUrl("github.com"), "https://github.com");
  assert.equal(
    github.normalizeBaseUrl("https://ghe.example.com/"),
    "https://ghe.example.com",
  );
});

void test("GitHub App: installation tokens are minted with an RS256 app JWT and scoped per session", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const credential = { appId: "42", privateKey: pem, installationId: "77" };
  const jwt = appJwt(credential, Date.UTC(2026, 0, 1));
  const [header, payload, signature] = jwt.split(".");
  assert.ok(
    createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, signature!, "base64url"),
  );
  assert.equal(
    (
      JSON.parse(Buffer.from(payload!, "base64url").toString()) as {
        iss: string;
      }
    ).iss,
    "42",
  );
  const host = scripted({
    "POST /app/installations/77/access_tokens": (request) =>
      request.headers.get("authorization")?.startsWith("Bearer ey")
        ? Response.json(
            { token: "ghs_minted", expires_at: "2099-01-01T00:00:00Z" },
            { status: 201 },
          )
        : Response.json({ message: "Bad credentials" }, { status: 401 }),
  });
  const github = createGitHubProvider({ fetch: host.fetch, ...noSleep });
  const session = await github.createSessionCredential(
    { baseUrl: "https://github.com", authKind: "github_app", credential },
    { externalId: "555", fullName: "acme/pay" },
  );
  assert.deepEqual(
    {
      token: session.token,
      longLived: session.longLived,
      username: session.username,
    },
    { token: "ghs_minted", longLived: false, username: "x-access-token" },
  );
  assert.deepEqual(
    (JSON.parse(host.requests[0]!.body) as { repository_ids: number[] })
      .repository_ids,
    [555],
  );
  // A stored token is handed out as it is, and flagged.
  const stored = await github.createSessionCredential(
    {
      baseUrl: "https://github.com",
      authKind: "token",
      credential: { token: "pat" },
    },
    { externalId: "555", fullName: "acme/pay" },
  );
  assert.equal(stored.longLived, true);
});

void test("GitHub: opening a pull request is not retried after a server error (the outbox recovers it)", async () => {
  let posts = 0;
  const host = scripted({
    "POST /repos/acme/pay/pulls": () => {
      posts++;
      return new Response("upstream", { status: 502 });
    },
  });
  const github = createGitHubProvider({ fetch: host.fetch, ...noSleep });
  await assert.rejects(
    github.openPullRequest(
      {
        baseUrl: "https://github.com",
        authKind: "token",
        credential: { token: "t" },
      },
      { externalId: "1", fullName: "acme/pay" },
      { head: "h", base: "main", title: "t", body: "", draft: false },
    ),
    (e) => e instanceof CodeHostError && e.kind === "unavailable",
  );
  assert.equal(posts, 1);
});

void test("pagination never follows a Link to another origin (the credential would go with it)", async () => {
  const host = scripted({
    "GET /repos/acme/pay/branches": () =>
      Response.json([{ name: "main", commit: { sha: "b".repeat(40) } }], {
        headers: { link: '<https://evil.example/steal?page=2>; rel="next"' },
      }),
  });
  const github = createGitHubProvider({ fetch: host.fetch, ...noSleep });
  const branches = await github.listBranches(
    {
      baseUrl: "https://github.com",
      authKind: "token",
      credential: { token: "t" },
    },
    { externalId: "1", fullName: "acme/pay" },
  );
  assert.equal(branches.length, 1);
  assert.ok(
    host.requests.every((r) => new URL(r.url).host === "api.github.com"),
  );
});

void test("errors are actionable and never contain the credential", async () => {
  const host = scripted({
    "GET /user": () =>
      Response.json({ message: "Bad credentials" }, { status: 401 }),
  });
  const github = createGitHubProvider({ fetch: host.fetch, ...noSleep });
  await assert.rejects(
    github.verify({
      baseUrl: "https://github.com",
      authKind: "token",
      credential: { token: "github_pat_secret" },
    }),
    (e) =>
      e instanceof CodeHostError &&
      e.kind === "authentication" &&
      !e.message.includes("github_pat_secret"),
  );
});

void test("GitHub webhooks become domain events", () => {
  const github = createGitHubProvider();
  const repository = { id: 1, full_name: "acme/pay" };
  assert.deepEqual(
    github.parseWebhook("pull_request", {
      repository,
      pull_request: { number: 7 },
    }),
    [
      {
        kind: "pull_request",
        repository: { externalId: "1", fullName: "acme/pay" },
        number: 7,
      },
    ],
  );
  const [push] = github.parseWebhook("push", {
    repository,
    ref: "refs/heads/pay-1-x",
    after: "c".repeat(40),
    deleted: false,
    commits: [
      {
        id: "c".repeat(40),
        message: "PAY-1 start",
        author: { name: "Ada", username: "ada" },
        url: "https://github.com/acme/pay/commit/c",
        timestamp: "2026-01-01T00:00:00Z",
      },
    ],
  });
  assert.equal(push?.kind, "push");
  assert.equal(push?.kind === "push" && push.branch, "pay-1-x");
  assert.deepEqual(
    github.parseWebhook("push", { repository, ref: "refs/tags/v1" }),
    [],
  );
  assert.deepEqual(
    github.parseWebhook("check_suite", {
      repository,
      check_suite: { head_sha: "d".repeat(40), pull_requests: [{ number: 7 }] },
    }),
    [
      {
        kind: "checks",
        repository: { externalId: "1", fullName: "acme/pay" },
        sha: "d".repeat(40),
        pullRequests: [7],
      },
    ],
  );
  assert.deepEqual(
    github.parseWebhook("issue_comment", { repository, issue: { number: 3 } }),
    [],
  );
  assert.deepEqual(github.parseWebhook("ping", {}), [{ kind: "ping" }]);
});

void test("GitLab hooks: merge requests, deleted branches and pipelines", () => {
  const gitlab = createGitLabProvider();
  const project = { id: 12, path_with_namespace: "acme/pay" };
  const ref = { externalId: "12", fullName: "acme/pay" };
  assert.deepEqual(
    gitlab.parseWebhook("Merge Request Hook", {
      project,
      object_attributes: { iid: 4 },
    }),
    [{ kind: "pull_request", repository: ref, number: 4 }],
  );
  const [deleted] = gitlab.parseWebhook("Push Hook", {
    project,
    ref: "refs/heads/pay-1-x",
    after: "0".repeat(40),
    commits: [],
  });
  assert.equal(deleted?.kind === "push" && deleted.deleted, true);
  assert.deepEqual(
    gitlab.parseWebhook("Pipeline Hook", {
      project,
      object_attributes: { sha: "e".repeat(40) },
      merge_request: { iid: 4 },
    }),
    [
      {
        kind: "checks",
        repository: ref,
        sha: "e".repeat(40),
        pullRequests: [4],
      },
    ],
  );
  assert.equal(gitlab.normalizeBaseUrl("gitlab.com"), "https://gitlab.com");
});

void test("Bitbucket events: pull requests and pushes per branch", () => {
  const bitbucket = createBitbucketProvider();
  const repository = { uuid: "{r1}", full_name: "acme/pay" };
  const ref = { externalId: "{r1}", fullName: "acme/pay" };
  assert.deepEqual(
    bitbucket.parseWebhook("pullrequest:fulfilled", {
      repository,
      pullrequest: { id: 3 },
    }),
    [{ kind: "pull_request", repository: ref, number: 3 }],
  );
  const events = bitbucket.parseWebhook("repo:push", {
    repository,
    push: {
      changes: [
        {
          new: {
            type: "branch",
            name: "pay-1-x",
            target: { hash: "f".repeat(40) },
          },
          commits: [],
        },
        { new: null, old: { type: "branch", name: "old" }, closed: true },
        { new: { type: "tag", name: "v1" } },
      ],
    },
  });
  assert.equal(events.length, 2);
  assert.equal(events[1]?.kind === "push" && events[1].deleted, true);
  assert.throws(
    () => bitbucket.normalizeBaseUrl("https://bitbucket.acme.internal"),
    (e) => e instanceof CodeHostError,
  );
});

void test("Bitbucket: a refused OAuth consumer says what to fix", async () => {
  const answer = (error: string, description: string) =>
    scripted({
      "POST /site/oauth2/access_token": () =>
        Response.json(
          { error, error_description: description },
          { status: 400 },
        ),
    });
  const connection = {
    baseUrl: "https://bitbucket.org",
    authKind: "oauth_consumer" as const,
    credential: { key: "k", secret: "wrong" },
  };
  const verify = (host: ReturnType<typeof scripted>) =>
    createBitbucketProvider({
      fetch: host.fetch,
      tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
      ...noSleep,
    }).verify(connection);

  await assert.rejects(
    verify(answer("invalid_client", "Invalid OAuth client credentials")),
    (e) =>
      e instanceof CodeHostError &&
      e.kind === "authentication" &&
      /OAuth consumer key and secret/.test(e.message),
  );
  await assert.rejects(
    verify(
      answer(
        "unauthorized_client",
        "Client credentials grant is not allowed for this consumer",
      ),
    ),
    (e) =>
      e instanceof CodeHostError &&
      e.kind === "validation" &&
      /private consumer/.test(e.message),
  );
});
