import { createGitHubProvider } from "@lictory/core/code/github/provider";
import { summarize } from "@lictory/core/code/checks";
import {
  CodeHostError,
  type CodeCheckRun,
  type CodeCommitInfo,
  type CodeHostProvider,
  type CodeHostProviderKind,
  type CodeIssueInfo,
  type CodePullRequestInfo,
  type CodeRepositoryInfo,
} from "@lictory/core/code/provider";
import type { CodeHostProviders } from "@lictory/core/code/registry";
import {
  hmacSignature,
  verifyGitHubWebhook,
} from "@lictory/core/code/signatures";

// An in-memory code host for domain tests. It behaves like a well-behaved
// host (stable ids, a clock, one open pull request per head branch) and
// lets a test act as the people working on the host, inject failures per
// call and lose the answer to a write that was applied (a timeout after
// the host did the work). Webhooks are GitHub-shaped and signed, and are
// parsed by the real GitHub adapter.

type Repo = {
  info: CodeRepositoryInfo;
  branches: Map<string, string>;
  prs: Map<number, CodePullRequestInfo>;
  issues: Map<number, CodeIssueInfo>;
  checks: Map<string, CodeCheckRun[]>;
  comments: Map<number, { id: string; body: string }[]>;
  commits: CodeCommitInfo[];
  sequence: number;
};

type Method = keyof CodeHostProvider;

export function createFakeCodeHost(kind: CodeHostProviderKind = "github") {
  const repos = new Map<string, Repo>();
  const failures: { method: Method; error: CodeHostError; applied?: true }[] =
    [];
  const calls: string[] = [];
  let clock = Date.UTC(2026, 0, 1);
  const tick = () => new Date((clock += 1000));
  let ids = 1000;
  const parser = createGitHubProvider();

  const repo = (externalId: string) => {
    const found = repos.get(externalId);
    if (!found) throw new CodeHostError("not_found", "No such repository.");
    return found;
  };
  // Throws an injected failure for this call; `applied` failures throw
  // after the change happened.
  const gate = (method: Method) => {
    calls.push(method);
    const index = failures.findIndex((f) => f.method === method && !f.applied);
    if (index >= 0) throw failures.splice(index, 1)[0]!.error;
  };
  const after = (method: Method) => {
    const index = failures.findIndex((f) => f.method === method && f.applied);
    if (index >= 0) throw failures.splice(index, 1)[0]!.error;
  };
  const sha = () => (ids++).toString(16).padStart(40, "a");

  const provider: CodeHostProvider = {
    kind,
    authKinds: ["token", "github_app", "oauth_consumer"],
    normalizeBaseUrl: (url) =>
      url.trim().replace(/\/+$/, "") || "https://github.com",
    verify(connection) {
      gate("verify");
      const token = (connection.credential as { token?: string }).token;
      if (token === "bad")
        return Promise.reject(
          new CodeHostError("authentication", "The token was rejected."),
        );
      return Promise.resolve({ accountLabel: "@lictory-bot" });
    },
    listRepositories(_connection, query) {
      gate("listRepositories");
      return Promise.resolve(
        [...repos.values()]
          .map((r) => r.info)
          .filter((r) => !query || r.fullName.includes(query)),
      );
    },
    getRepository(_connection, fullNameOrId) {
      gate("getRepository");
      const found = [...repos.values()].find(
        (r) =>
          r.info.externalId === fullNameOrId ||
          r.info.fullName === fullNameOrId,
      );
      return Promise.resolve(found ? { ...found.info } : null);
    },
    listBranches(_connection, ref) {
      gate("listBranches");
      return Promise.resolve(
        [...repo(ref.externalId).branches].map(([name, headSha]) => ({
          name,
          headSha,
        })),
      );
    },
    getBranch(_connection, ref, name) {
      gate("getBranch");
      const headSha = repo(ref.externalId).branches.get(name);
      return Promise.resolve(headSha ? { name, headSha } : null);
    },
    listPullRequests(_connection, ref, options) {
      gate("listPullRequests");
      return Promise.resolve(
        [...repo(ref.externalId).prs.values()]
          .filter(
            (p) =>
              p.state === "open" ||
              !options.since ||
              p.updatedAt.getTime() >= options.since.getTime(),
          )
          .map((p) => ({ ...p })),
      );
    },
    getPullRequest(_connection, ref, number) {
      gate("getPullRequest");
      const pr = repo(ref.externalId).prs.get(number);
      return Promise.resolve(pr ? { ...pr } : null);
    },
    listPullRequestFiles(_connection, ref, number) {
      gate("listPullRequestFiles");
      if (!repo(ref.externalId).prs.has(number))
        return Promise.reject(
          new CodeHostError("not_found", "No such pull request."),
        );
      return Promise.resolve([
        {
          path: "src/refunds.ts",
          previousPath: null,
          status: "modified" as const,
          additions: 2,
          deletions: 1,
          patch: "@@ -1,2 +1,3 @@\n-old\n+new\n+more",
        },
      ]);
    },
    getChecks(_connection, ref, commit) {
      gate("getChecks");
      return Promise.resolve(
        summarize(repo(ref.externalId).checks.get(commit) ?? []),
      );
    },
    listIssues(_connection, ref) {
      gate("listIssues");
      return Promise.resolve(
        [...repo(ref.externalId).issues.values()].map((i) => ({ ...i })),
      );
    },
    getIssue(_connection, ref, number) {
      gate("getIssue");
      const issue = repo(ref.externalId).issues.get(number);
      return Promise.resolve(issue ? { ...issue } : null);
    },
    listCommits(_connection, ref) {
      gate("listCommits");
      return Promise.resolve([...repo(ref.externalId).commits]);
    },
    verifyWebhook: verifyGitHubWebhook,
    parseWebhook: (event, payload) => parser.parseWebhook(event, payload),
    createBranch(_connection, ref, name, fromSha) {
      gate("createBranch");
      const r = repo(ref.externalId);
      const existing = r.branches.get(name);
      if (existing && existing !== fromSha)
        return Promise.reject(
          new CodeHostError(
            "conflict",
            `A branch named ${name} already exists.`,
          ),
        );
      r.branches.set(name, fromSha);
      after("createBranch");
      return Promise.resolve({ name, headSha: fromSha });
    },
    findOpenPullRequest(_connection, ref, head) {
      gate("findOpenPullRequest");
      const found = [...repo(ref.externalId).prs.values()].find(
        (p) => p.state === "open" && p.headBranch === head,
      );
      return Promise.resolve(found ? { ...found } : null);
    },
    openPullRequest(_connection, ref, input) {
      gate("openPullRequest");
      const r = repo(ref.externalId);
      const headSha = r.branches.get(input.head);
      if (!headSha)
        return Promise.reject(
          new CodeHostError("validation", `There is no branch ${input.head}.`),
        );
      const pr = fake.openPullRequest(ref.externalId, {
        head: input.head,
        base: input.base,
        title: input.title,
        body: input.body,
        draft: input.draft,
        author: "lictory-bot",
      });
      after("openPullRequest");
      return Promise.resolve({ ...pr });
    },
    findComment(_connection, ref, number, marker) {
      gate("findComment");
      const found = (repo(ref.externalId).comments.get(number) ?? []).find(
        (c) => c.body.includes(marker),
      );
      return Promise.resolve(found ? { id: found.id, url: null } : null);
    },
    comment(_connection, ref, number, body) {
      gate("comment");
      const r = repo(ref.externalId);
      const list = r.comments.get(number) ?? [];
      const comment = { id: String(ids++), body };
      list.push(comment);
      r.comments.set(number, list);
      after("comment");
      return Promise.resolve({ id: comment.id, url: null });
    },
    requestReview(_connection, ref, number, reviewers) {
      gate("requestReview");
      const pr = repo(ref.externalId).prs.get(number)!;
      pr.requestedReviewers = [
        ...new Set([...pr.requestedReviewers, ...reviewers]),
      ];
      pr.reviewDecision = pr.approvedBy.length
        ? pr.reviewDecision
        : "review_required";
      pr.updatedAt = tick();
      return Promise.resolve();
    },
    merge(_connection, ref, number, input) {
      gate("merge");
      const pr = repo(ref.externalId).prs.get(number);
      if (!pr)
        return Promise.reject(
          new CodeHostError("not_found", "No such pull request."),
        );
      if (pr.state === "merged") return Promise.resolve({ sha: null });
      if (pr.headSha !== input.expectedHeadSha)
        return Promise.reject(
          new CodeHostError("conflict", "Head branch was modified."),
        );
      fake.mergeOnHost(ref.externalId, number, "lictory-bot");
      after("merge");
      return Promise.resolve({ sha: sha() });
    },
    setPullRequestState(_connection, ref, number, state) {
      gate("setPullRequestState");
      const pr = repo(ref.externalId).prs.get(number)!;
      pr.state = state === "closed" ? "closed" : "open";
      pr.closedAt = state === "closed" ? tick() : null;
      pr.updatedAt = tick();
      return Promise.resolve();
    },
    createSessionCredential(connection) {
      gate("createSessionCredential");
      return Promise.resolve(
        connection.authKind === "github_app"
          ? {
              username: "x-access-token",
              token: `ghs_session_${ids++}`,
              expiresAt: new Date(clock + 3600_000),
              longLived: false,
            }
          : {
              username: "x-access-token",
              token: (connection.credential as { token: string }).token,
              expiresAt: null,
              longLived: true,
            },
      );
    },
  };

  const fake = {
    provider,
    calls,
    repos,
    // Fails the next call of `method`; with `applied`, the change happens
    // and only the answer is lost.
    fail(method: Method, error: CodeHostError, applied = false) {
      failures.push({
        method,
        error,
        ...(applied ? { applied: true as const } : {}),
      });
    },
    addRepository(fullName: string, defaultBranch = "main") {
      const externalId = String(ids++);
      const info: CodeRepositoryInfo = {
        externalId,
        fullName,
        defaultBranch,
        webUrl: `https://github.example/${fullName}`,
        cloneUrl: `https://github.example/${fullName}.git`,
        visibility: "private",
        archived: false,
      };
      repos.set(externalId, {
        info,
        branches: new Map([[defaultBranch, sha()]]),
        prs: new Map(),
        issues: new Map(),
        checks: new Map(),
        comments: new Map(),
        commits: [],
        sequence: 0,
      });
      return info;
    },
    pushBranch(externalId: string, name: string) {
      const head = sha();
      repo(externalId).branches.set(name, head);
      return head;
    },
    openPullRequest(
      externalId: string,
      input: {
        head: string;
        base?: string;
        title: string;
        body?: string;
        draft?: boolean;
        author?: string;
      },
    ) {
      const r = repo(externalId);
      const headSha =
        r.branches.get(input.head) ?? fake.pushBranch(externalId, input.head);
      const number = ++r.sequence;
      const at = tick();
      const pr: CodePullRequestInfo = {
        externalId: String(ids++),
        number,
        title: input.title,
        body: input.body ?? "",
        state: "open",
        draft: input.draft ?? false,
        authorLogin: input.author ?? "ada",
        authorIsBot: false,
        headBranch: input.head,
        headSha,
        baseBranch: input.base ?? r.info.defaultBranch,
        reviewDecision: "none",
        requestedReviewers: [],
        approvedBy: [],
        mergeable: true,
        webUrl: `${r.info.webUrl}/pull/${number}`,
        mergedAt: null,
        mergedByLogin: null,
        closedAt: null,
        createdAt: at,
        updatedAt: at,
      };
      r.prs.set(number, pr);
      return pr;
    },
    updatePullRequest(
      externalId: string,
      number: number,
      change: Partial<CodePullRequestInfo>,
    ) {
      const pr = repo(externalId).prs.get(number)!;
      Object.assign(pr, change, { updatedAt: tick() });
      return pr;
    },
    approve(externalId: string, number: number, login = "grace") {
      const pr = repo(externalId).prs.get(number)!;
      pr.approvedBy = [...new Set([...pr.approvedBy, login])];
      pr.reviewDecision = "approved";
      pr.updatedAt = tick();
    },
    setChecks(externalId: string, commit: string, runs: CodeCheckRun[]) {
      repo(externalId).checks.set(commit, runs);
    },
    mergeOnHost(externalId: string, number: number, login = "ada") {
      const pr = repo(externalId).prs.get(number)!;
      pr.state = "merged";
      pr.mergedAt = tick();
      pr.mergedByLogin = login;
      pr.updatedAt = pr.mergedAt;
    },
    addIssue(
      externalId: string,
      title: string,
      body = "",
      labels: string[] = [],
    ) {
      const r = repo(externalId);
      const number = ++r.sequence;
      const at = tick();
      const issue: CodeIssueInfo = {
        externalId: String(ids++),
        number,
        title,
        body,
        state: "open",
        labels,
        assignees: [],
        authorLogin: "ada",
        webUrl: `${r.info.webUrl}/issues/${number}`,
        createdAt: at,
        updatedAt: at,
      };
      r.issues.set(number, issue);
      return issue;
    },
    comments(externalId: string, number: number) {
      return repo(externalId).comments.get(number) ?? [];
    },
    // A GitHub-shaped delivery, signed with `secret`.
    webhook(
      secret: string,
      event: string,
      payload: Record<string, unknown>,
      deliveryId: string = crypto.randomUUID(),
    ) {
      const body = JSON.stringify(payload);
      return {
        headers: {
          "x-github-event": event,
          "x-github-delivery": deliveryId,
          "x-hub-signature-256": hmacSignature(secret, body),
        },
        body,
      };
    },
    // The repository object GitHub puts in every payload.
    repositoryPayload(externalId: string) {
      const r = repo(externalId);
      return { id: Number(externalId), full_name: r.info.fullName };
    },
  };
  return fake;
}

export type FakeCodeHost = ReturnType<typeof createFakeCodeHost>;

export function fakeCodeHosts(host: FakeCodeHost): CodeHostProviders {
  return {
    github: host.provider,
    gitlab: host.provider,
    bitbucket: host.provider,
  };
}
