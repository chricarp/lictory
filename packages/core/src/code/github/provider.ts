import { createSign } from "node:crypto";
import {
  collect,
  createCodeHttp,
  date,
  nextLink,
  type CodeHttpOptions,
  type CodeRequest,
} from "@lictory/core/code/http";
import { selfManagedOrigin } from "@lictory/core/code/egress";
import { verifyGitHubWebhook } from "@lictory/core/code/signatures";
import { summarize } from "@lictory/core/code/checks";
import {
  CodeHostError,
  type CodeCheckRun,
  type CodeCommitInfo,
  type CodeConnection,
  type CodeHostProvider,
  type CodeIssueInfo,
  type CodePullRequestFile,
  type CodePullRequestInfo,
  type CodeRepositoryInfo,
  type CodeRepositoryRef,
  type CodeReviewDecision,
} from "@lictory/core/code/provider";

// GitHub (github.com and GitHub Enterprise Server) through its REST API.
// Two ways to connect:
// - a GitHub App installation (preferred): Lictory signs a JWT with the
//   app's private key and mints installation tokens that expire within an
//   hour, scoped to one repository for agent sessions;
// - a fine-grained personal access token, stored as is (long-lived).

export type GitHubTokenCredential = { token: string };
export type GitHubAppCredential = {
  appId: string;
  privateKey: string;
  installationId: string;
};

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);

const CLOUD = "https://github.com";

export function githubApiUrl(baseUrl: string) {
  return baseUrl === CLOUD ? "https://api.github.com" : `${baseUrl}/api/v3`;
}

function tokenCredential(value: unknown): GitHubTokenCredential {
  const token = str(obj(value).token);
  if (!token)
    throw new CodeHostError(
      "authentication",
      "The GitHub connection has no usable token. Reconnect GitHub.",
    );
  return { token };
}

export function appCredential(value: unknown): GitHubAppCredential {
  const v = obj(value);
  const appId = str(v.appId);
  const privateKey = str(v.privateKey);
  const installationId = str(v.installationId);
  if (!appId || !privateKey || !installationId)
    throw new CodeHostError(
      "authentication",
      "The GitHub App connection is incomplete. Reconnect it with the app id, private key and installation id.",
    );
  return { appId, privateKey, installationId };
}

// A JWT for the app itself (RS256, valid ten minutes, backdated a minute
// for clock drift), used only to mint installation tokens.
export function appJwt(credential: GitHubAppCredential, now = Date.now()) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const issued = Math.floor(now / 1000) - 60;
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: issued,
    exp: issued + 600,
    iss: credential.appId,
  })}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256")
      .update(unsigned)
      .sign(credential.privateKey, "base64url");
  } catch {
    throw new CodeHostError(
      "authentication",
      "The GitHub App private key could not be read. Paste the whole .pem file GitHub generated.",
    );
  }
  return `${unsigned}.${signature}`;
}

export function createGitHubProvider(
  options: CodeHttpOptions & { now?: () => number } = {},
): CodeHostProvider {
  const http = createCodeHttp(
    "GitHub",
    (status, body, headers) => {
      const message = str(obj(body).message) ?? undefined;
      const errors = arr(obj(body).errors)
        .map((e) => str(obj(e).message) ?? str(e))
        .filter(Boolean)
        .join(" ");
      return {
        message: [message, errors].filter(Boolean).join(": ") || undefined,
        rateLimited:
          status === 403 &&
          (headers.get("x-ratelimit-remaining") === "0" ||
            /rate limit/i.test(message ?? "")),
      };
    },
    options,
  );
  const now = options.now ?? Date.now;
  // Installation tokens are reused until five minutes before they expire.
  const installationTokens = new Map<
    string,
    { token: string; expiresAt: Date }
  >();

  const installationToken = async (
    connection: CodeConnection,
    scope?: { repositoryIds: number[] },
  ) => {
    const credential = appCredential(connection.credential);
    const key = `${connection.baseUrl}|${credential.appId}|${credential.installationId}`;
    const cached = scope ? undefined : installationTokens.get(key);
    if (cached && cached.expiresAt.getTime() - now() > 5 * 60_000)
      return cached;
    const { data } = await http<Json>(
      `${githubApiUrl(connection.baseUrl)}/app/installations/${encodeURIComponent(credential.installationId)}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appJwt(credential, now())}`,
          Accept: "application/vnd.github+json",
        },
        body: scope
          ? {
              repository_ids: scope.repositoryIds,
              permissions: {
                contents: "write",
                pull_requests: "write",
                metadata: "read",
              },
            }
          : {},
      },
    );
    const token = str(data.token);
    const expiresAt = date(data.expires_at) ?? new Date(now() + 50 * 60_000);
    if (!token)
      throw new CodeHostError(
        "authentication",
        "GitHub did not issue an installation token. Check that the app is still installed.",
      );
    const minted = { token, expiresAt };
    if (!scope) installationTokens.set(key, minted);
    return minted;
  };

  const authorization = async (connection: CodeConnection) =>
    connection.authKind === "github_app"
      ? `Bearer ${(await installationToken(connection)).token}`
      : `Bearer ${tokenCredential(connection.credential).token}`;

  const api = async <T>(
    connection: CodeConnection,
    path: string,
    call: CodeRequest = {},
  ) => {
    const url = path.startsWith("http")
      ? path
      : `${githubApiUrl(connection.baseUrl)}${path}`;
    return http<T>(url, {
      ...call,
      headers: {
        Authorization: await authorization(connection),
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...call.headers,
      },
    });
  };
  const list = <T>(
    connection: CodeConnection,
    path: string,
    limit: number,
    pick: (data: unknown) => unknown[] = arr,
    stop?: (item: T) => boolean,
  ) => {
    const base = githubApiUrl(connection.baseUrl);
    let stopped = false;
    return collect<T>(
      `${base}${path}`,
      async (url) => {
        const { data, headers } = await api<unknown>(connection, url);
        const items = pick(data) as T[];
        const kept: T[] = [];
        for (const item of items) {
          if (stop?.(item)) {
            stopped = true;
            break;
          }
          kept.push(item);
        }
        return { items: kept, next: stopped ? null : nextLink(headers, base) };
      },
      limit,
    );
  };
  const repoPath = (repository: CodeRepositoryRef) =>
    `/repos/${repository.fullName.split("/").map(encodeURIComponent).join("/")}`;

  const toRepository = (r: Json): CodeRepositoryInfo => ({
    externalId: String(num(r.id) ?? str(r.id) ?? ""),
    fullName: str(r.full_name) ?? "",
    defaultBranch: str(r.default_branch) ?? "main",
    webUrl: str(r.html_url) ?? "",
    cloneUrl: str(r.clone_url) ?? "",
    visibility:
      str(r.visibility) === "internal"
        ? "internal"
        : r.private === true || str(r.visibility) === "private"
          ? "private"
          : "public",
    archived: r.archived === true,
  });
  const toBasePullRequest = (p: Json): CodePullRequestInfo => {
    const head = obj(p.head);
    const base = obj(p.base);
    const user = obj(p.user);
    const mergedAt = date(p.merged_at);
    return {
      externalId: String(num(p.id) ?? ""),
      number: num(p.number) ?? 0,
      title: str(p.title) ?? "",
      body: str(p.body) ?? "",
      state: mergedAt ? "merged" : str(p.state) === "open" ? "open" : "closed",
      draft: p.draft === true,
      authorLogin: str(user.login),
      authorIsBot: str(user.type) === "Bot",
      headBranch: str(head.ref) ?? "",
      headSha: str(head.sha) ?? "",
      baseBranch: str(base.ref) ?? "",
      reviewDecision: "none",
      requestedReviewers: [
        ...arr(p.requested_reviewers).map((u) => str(obj(u).login)),
        ...arr(p.requested_teams).map((t) => str(obj(t).slug)),
      ].filter((x): x is string => !!x),
      approvedBy: [],
      mergeable: typeof p.mergeable === "boolean" ? p.mergeable : null,
      webUrl: str(p.html_url) ?? "",
      mergedAt,
      mergedByLogin: str(obj(p.merged_by).login),
      closedAt: date(p.closed_at),
      createdAt: date(p.created_at) ?? new Date(0),
      updatedAt: date(p.updated_at) ?? new Date(0),
    };
  };
  const withReviews = async (
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    pr: CodePullRequestInfo,
  ): Promise<CodePullRequestInfo> => {
    const reviews = await list<Json>(
      connection,
      `${repoPath(repository)}/pulls/${pr.number}/reviews?per_page=100`,
      300,
    );
    // The latest deciding review of each person counts.
    const latest = new Map<string, string>();
    for (const review of reviews) {
      const login = str(obj(review.user).login);
      const state = str(review.state);
      if (!login || !state || state === "COMMENTED" || state === "PENDING")
        continue;
      latest.set(login, state);
    }
    const approvedBy = [...latest]
      .filter(([, state]) => state === "APPROVED")
      .map(([login]) => login);
    const changes = [...latest.values()].includes("CHANGES_REQUESTED");
    const reviewDecision: CodeReviewDecision = changes
      ? "changes_requested"
      : approvedBy.length
        ? "approved"
        : pr.requestedReviewers.length
          ? "review_required"
          : "none";
    return { ...pr, approvedBy, reviewDecision };
  };
  const toIssue = (i: Json): CodeIssueInfo => ({
    externalId: String(num(i.id) ?? ""),
    number: num(i.number) ?? 0,
    title: str(i.title) ?? "",
    body: str(i.body) ?? "",
    state: str(i.state) === "closed" ? "closed" : "open",
    labels: arr(i.labels)
      .map((l) => (typeof l === "string" ? l : str(obj(l).name)))
      .filter((x): x is string => !!x),
    assignees: arr(i.assignees)
      .map((a) => str(obj(a).login))
      .filter((x): x is string => !!x),
    authorLogin: str(obj(i.user).login),
    webUrl: str(i.html_url) ?? "",
    createdAt: date(i.created_at) ?? new Date(0),
    updatedAt: date(i.updated_at) ?? new Date(0),
  });
  const toCommit = (c: Json): CodeCommitInfo => {
    const commit = obj(c.commit);
    return {
      sha: str(c.sha) ?? "",
      message: str(commit.message) ?? "",
      authorName: str(obj(commit.author).name),
      authorLogin: str(obj(c.author).login),
      webUrl: str(c.html_url) ?? "",
      committedAt:
        date(obj(commit.committer).date) ??
        date(obj(commit.author).date) ??
        new Date(0),
    };
  };
  const repoRef = (payload: Json): CodeRepositoryRef => {
    const r = obj(payload.repository);
    return {
      externalId: String(num(r.id) ?? ""),
      fullName: str(r.full_name) ?? "",
    };
  };

  const getBranch = async (
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    name: string,
  ): Promise<{ name: string; headSha: string } | null> => {
    try {
      const { data } = await api<Json>(
        connection,
        `${repoPath(repository)}/git/ref/heads/${name.split("/").map(encodeURIComponent).join("/")}`,
      );
      const sha = str(obj(data.object).sha);
      return sha ? { name, headSha: sha } : null;
    } catch (error) {
      if (error instanceof CodeHostError && error.kind === "not_found")
        return null;
      throw error;
    }
  };

  const getPullRequest = async (
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
  ): Promise<CodePullRequestInfo | null> => {
    try {
      const { data } = await api<Json>(
        connection,
        `${repoPath(repository)}/pulls/${number}`,
      );
      return withReviews(connection, repository, toBasePullRequest(data));
    } catch (error) {
      if (error instanceof CodeHostError && error.kind === "not_found")
        return null;
      throw error;
    }
  };

  return {
    kind: "github",
    authKinds: ["github_app", "token"],
    normalizeBaseUrl(input) {
      const value = input.trim().replace(/\/+$/, "").toLowerCase();
      if (
        !value ||
        ["github.com", "https://github.com", "https://api.github.com"].includes(
          value,
        ) ||
        value === "https://www.github.com"
      )
        return CLOUD;
      return selfManagedOrigin(input, "GitHub Enterprise Server");
    },
    async verify(connection) {
      if (connection.authKind === "github_app") {
        const credential = appCredential(connection.credential);
        const { data: installation } = await http<Json>(
          `${githubApiUrl(connection.baseUrl)}/app/installations/${encodeURIComponent(credential.installationId)}`,
          {
            headers: {
              Authorization: `Bearer ${appJwt(credential, now())}`,
              Accept: "application/vnd.github+json",
            },
          },
        );
        await installationToken(connection);
        const account = str(obj(installation.account).login) ?? "GitHub";
        const app = str(installation.app_slug) ?? `app ${credential.appId}`;
        return { accountLabel: `${app} on ${account}` };
      }
      const { data } = await api<Json>(connection, "/user");
      const login = str(data.login);
      if (!login)
        throw new CodeHostError(
          "authentication",
          "GitHub did not say who the token belongs to.",
        );
      return { accountLabel: `@${login}` };
    },
    async listRepositories(connection, query) {
      const repositories =
        connection.authKind === "github_app"
          ? await list<Json>(
              connection,
              "/installation/repositories?per_page=100",
              1000,
              (data) => arr(obj(data).repositories),
            )
          : await list<Json>(
              connection,
              "/user/repos?per_page=100&sort=updated",
              1000,
            );
      const wanted = query?.trim().toLowerCase();
      return repositories
        .map(toRepository)
        .filter((r) => !wanted || r.fullName.toLowerCase().includes(wanted));
    },
    async getRepository(connection, fullNameOrId) {
      try {
        const path = /^\d+$/.test(fullNameOrId)
          ? `/repositories/${fullNameOrId}`
          : repoPath({ externalId: "", fullName: fullNameOrId });
        return toRepository((await api<Json>(connection, path)).data);
      } catch (error) {
        if (error instanceof CodeHostError && error.kind === "not_found")
          return null;
        throw error;
      }
    },
    async listBranches(connection, repository) {
      const branches = await list<Json>(
        connection,
        `${repoPath(repository)}/branches?per_page=100`,
        1000,
      );
      return branches.map((b) => ({
        name: str(b.name) ?? "",
        headSha: str(obj(b.commit).sha) ?? "",
      }));
    },
    getBranch,
    async listPullRequests(connection, repository, options) {
      const since = options.since?.getTime();
      const prs = await list<Json>(
        connection,
        `${repoPath(repository)}/pulls?state=all&sort=updated&direction=desc&per_page=50`,
        options.limit ?? 200,
        arr,
        (p) =>
          since !== undefined &&
          str(p.state) !== "open" &&
          (date(p.updated_at)?.getTime() ?? 0) < since,
      );
      return prs.map(toBasePullRequest);
    },
    getPullRequest,
    async listPullRequestFiles(connection, repository, number) {
      const files = await list<Json>(
        connection,
        `${repoPath(repository)}/pulls/${number}/files?per_page=100`,
        300,
      );
      return files.map((f): CodePullRequestFile => ({
        path: str(f.filename) ?? "",
        previousPath: str(f.previous_filename),
        status:
          str(f.status) === "added"
            ? "added"
            : str(f.status) === "removed"
              ? "removed"
              : str(f.status) === "renamed"
                ? "renamed"
                : "modified",
        additions: num(f.additions) ?? 0,
        deletions: num(f.deletions) ?? 0,
        patch: str(f.patch),
      }));
    },
    async getChecks(connection, repository, sha) {
      const runs: CodeCheckRun[] = [];
      try {
        const checkRuns = await list<Json>(
          connection,
          `${repoPath(repository)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
          300,
          (data) => arr(obj(data).check_runs),
        );
        // Re-runs repeat a name; the newest run of each name counts.
        const latest = new Map<string, Json>();
        for (const run of checkRuns) {
          const name = str(run.name) ?? "check";
          const previous = latest.get(name);
          if (
            !previous ||
            (date(run.started_at)?.getTime() ?? 0) >=
              (date(previous.started_at)?.getTime() ?? 0)
          )
            latest.set(name, run);
        }
        for (const [name, run] of latest)
          runs.push({
            name,
            state: checkRunState(str(run.status), str(run.conclusion)),
            url: str(run.html_url),
          });
      } catch (error) {
        // Tokens without the Checks permission still see commit statuses.
        if (!(error instanceof CodeHostError) || error.kind !== "permission")
          throw error;
      }
      const { data } = await api<Json>(
        connection,
        `${repoPath(repository)}/commits/${encodeURIComponent(sha)}/status`,
      );
      for (const status of arr(data.statuses)) {
        const s = obj(status);
        const state = str(s.state);
        runs.push({
          name: str(s.context) ?? "status",
          state:
            state === "success"
              ? "success"
              : state === "pending"
                ? "pending"
                : "failure",
          url: str(s.target_url),
        });
      }
      return summarize(runs);
    },
    async listIssues(connection, repository, options) {
      const since = options.since
        ? `&since=${encodeURIComponent(options.since.toISOString())}`
        : "";
      const issues = await list<Json>(
        connection,
        `${repoPath(repository)}/issues?state=all&sort=updated&direction=desc&per_page=100${since}`,
        options.limit ?? 300,
      );
      return issues.filter((i) => !("pull_request" in i)).map(toIssue);
    },
    async getIssue(connection, repository, number) {
      try {
        const { data } = await api<Json>(
          connection,
          `${repoPath(repository)}/issues/${number}`,
        );
        return "pull_request" in data ? null : toIssue(data);
      } catch (error) {
        if (error instanceof CodeHostError && error.kind === "not_found")
          return null;
        throw error;
      }
    },
    async listCommits(connection, repository, options) {
      const query = new URLSearchParams({ per_page: "100" });
      if (options.branch) query.set("sha", options.branch);
      if (options.since) query.set("since", options.since.toISOString());
      const commits = await list<Json>(
        connection,
        `${repoPath(repository)}/commits?${query.toString()}`,
        options.limit ?? 300,
      );
      return commits.map(toCommit);
    },

    verifyWebhook: verifyGitHubWebhook,
    parseWebhook(event, raw) {
      const payload = obj(raw);
      const repository = repoRef(payload);
      if (event === "ping") return [{ kind: "ping" }];
      if (!repository.externalId) return [];
      switch (event) {
        case "pull_request":
        case "pull_request_review":
        case "pull_request_review_thread": {
          const number = num(obj(payload.pull_request).number);
          return number ? [{ kind: "pull_request", repository, number }] : [];
        }
        case "issue_comment": {
          const issue = obj(payload.issue);
          const number = num(issue.number);
          if (!number) return [];
          return "pull_request" in issue
            ? [{ kind: "pull_request", repository, number }]
            : [];
        }
        case "issues": {
          const number = num(obj(payload.issue).number);
          return number ? [{ kind: "issue", repository, number }] : [];
        }
        case "push": {
          const ref = str(payload.ref) ?? "";
          if (!ref.startsWith("refs/heads/")) return [];
          const deleted = payload.deleted === true;
          return [
            {
              kind: "push",
              repository,
              branch: ref.slice("refs/heads/".length),
              headSha: deleted ? null : str(payload.after),
              deleted,
              commits: arr(payload.commits).map((c) => {
                const commit = obj(c);
                const author = obj(commit.author);
                return {
                  sha: str(commit.id) ?? "",
                  message: str(commit.message) ?? "",
                  authorName: str(author.name),
                  authorLogin: str(author.username),
                  webUrl: str(commit.url) ?? "",
                  committedAt: date(commit.timestamp) ?? new Date(0),
                };
              }),
            },
          ];
        }
        case "check_run":
        case "check_suite": {
          const subject = obj(payload[event]);
          const sha = str(subject.head_sha);
          return sha
            ? [
                {
                  kind: "checks",
                  repository,
                  sha,
                  pullRequests: arr(subject.pull_requests)
                    .map((p) => num(obj(p).number))
                    .filter((n): n is number => !!n),
                },
              ]
            : [];
        }
        case "status": {
          const sha = str(payload.sha);
          return sha
            ? [{ kind: "checks", repository, sha, pullRequests: [] }]
            : [];
        }
        case "repository":
          return [{ kind: "repository", repository }];
        default:
          return [];
      }
    },

    async createBranch(connection, repository, name, fromSha) {
      try {
        await api(connection, `${repoPath(repository)}/git/refs`, {
          method: "POST",
          body: { ref: `refs/heads/${name}`, sha: fromSha },
        });
        return { name, headSha: fromSha };
      } catch (error) {
        if (
          error instanceof CodeHostError &&
          (error.kind === "validation" || error.kind === "conflict")
        ) {
          const existing = await getBranch(connection, repository, name);
          if (existing?.headSha === fromSha) return existing;
          if (existing)
            throw new CodeHostError(
              "conflict",
              `A branch named ${name} already exists on GitHub at another commit.`,
            );
        }
        throw error;
      }
    },
    async findOpenPullRequest(connection, repository, headBranch) {
      const owner = repository.fullName.split("/")[0]!;
      const { data } = await api<unknown[]>(
        connection,
        `${repoPath(repository)}/pulls?state=open&head=${encodeURIComponent(`${owner}:${headBranch}`)}&per_page=5`,
      );
      const found = arr(data)[0];
      return found
        ? withReviews(connection, repository, toBasePullRequest(obj(found)))
        : null;
    },
    async openPullRequest(connection, repository, input) {
      const { data } = await api<Json>(
        connection,
        `${repoPath(repository)}/pulls`,
        {
          method: "POST",
          body: {
            title: input.title,
            body: input.body,
            head: input.head,
            base: input.base,
            draft: input.draft,
          },
          once: true,
        },
      );
      return toBasePullRequest(data);
    },
    async findComment(connection, repository, number, marker) {
      const comments = await list<Json>(
        connection,
        `${repoPath(repository)}/issues/${number}/comments?per_page=100`,
        500,
      );
      const found = comments.find((c) => str(c.body)?.includes(marker));
      return found
        ? { id: String(num(found.id) ?? ""), url: str(found.html_url) }
        : null;
    },
    async comment(connection, repository, number, body) {
      const { data } = await api<Json>(
        connection,
        `${repoPath(repository)}/issues/${number}/comments`,
        { method: "POST", body: { body }, once: true },
      );
      return { id: String(num(data.id) ?? ""), url: str(data.html_url) };
    },
    async requestReview(connection, repository, number, reviewers) {
      await api(
        connection,
        `${repoPath(repository)}/pulls/${number}/requested_reviewers`,
        { method: "POST", body: { reviewers } },
      );
    },
    async merge(connection, repository, number, input) {
      try {
        const { data } = await api<Json>(
          connection,
          `${repoPath(repository)}/pulls/${number}/merge`,
          {
            method: "PUT",
            body: { merge_method: input.method, sha: input.expectedHeadSha },
          },
        );
        return { sha: str(data.sha) };
      } catch (error) {
        // Merged meanwhile (a retry after a lost answer): done.
        if (error instanceof CodeHostError && error.kind === "conflict") {
          const current = await getPullRequest(connection, repository, number);
          if (current?.state === "merged") return { sha: null };
        }
        throw error;
      }
    },
    async setPullRequestState(connection, repository, number, state) {
      await api(connection, `${repoPath(repository)}/pulls/${number}`, {
        method: "PATCH",
        body: { state },
      });
    },
    async createSessionCredential(connection, repository) {
      if (connection.authKind === "github_app") {
        const id = Number(repository.externalId);
        const minted = await installationToken(connection, {
          repositoryIds: Number.isSafeInteger(id) ? [id] : [],
        });
        return {
          username: "x-access-token",
          token: minted.token,
          expiresAt: minted.expiresAt,
          longLived: false,
        };
      }
      return {
        username: "x-access-token",
        token: tokenCredential(connection.credential).token,
        expiresAt: null,
        longLived: true,
      };
    },
  };
}

function checkRunState(
  status: string | null,
  conclusion: string | null,
): CodeCheckRun["state"] {
  if (status !== "completed") return "pending";
  if (conclusion === "success") return "success";
  if (conclusion === "neutral" || conclusion === "skipped") return "neutral";
  return "failure";
}
