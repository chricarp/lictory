import { summarize } from "@lictory/core/code/checks";
import {
  collect,
  createCodeHttp,
  date,
  sameOrigin,
  type CodeHttpOptions,
  type CodeRequest,
} from "@lictory/core/code/http";
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
  type CodeWebhookEvent,
} from "@lictory/core/code/provider";
import { verifyBitbucketWebhook } from "@lictory/core/code/signatures";

// Bitbucket Cloud through REST API 2.0. Connect with:
// - an access token (repository, project or workspace access token), sent
//   as a bearer token;
// - an Atlassian API token with the account's email (basic auth);
// - an OAuth consumer (key and secret): Lictory exchanges it for access
//   tokens that expire within two hours.
// Bitbucket Data Center has a different API (REST 1.0, `/rest/api/1.0`,
// numeric ids, `X-Hub-Signature` too) and follows as its own adapter with
// provider kind `bitbucket_server`; nothing in the domain depends on
// Bitbucket Cloud's shapes.

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);

const CLOUD = "https://bitbucket.org";

export type BitbucketCredential =
  | { token: string }
  | { email: string; apiToken: string }
  | { key: string; secret: string };

function apiUrl(baseUrl: string) {
  return baseUrl === CLOUD ? "https://api.bitbucket.org/2.0" : `${baseUrl}/2.0`;
}

export function createBitbucketProvider(
  options: CodeHttpOptions & { tokenUrl?: string } = {},
): CodeHostProvider {
  const http = createCodeHttp(
    "Bitbucket",
    (_status, body) => {
      const error = obj(obj(body).error);
      const message = str(error.message);
      const detail = str(error.detail);
      return {
        message: [message, detail].filter(Boolean).join(": ") || undefined,
      };
    },
    options,
  );
  const consumerTokens = new Map<string, { token: string; expiresAt: Date }>();

  const consumerToken = async (connection: CodeConnection) => {
    const c = obj(connection.credential);
    const key = str(c.key);
    const secret = str(c.secret);
    if (!key || !secret) throw missing();
    const cached = consumerTokens.get(key);
    if (cached && cached.expiresAt.getTime() - Date.now() > 5 * 60_000)
      return cached;
    const tokenUrl =
      options.tokenUrl ??
      (connection.baseUrl === CLOUD
        ? "https://bitbucket.org/site/oauth2/access_token"
        : `${connection.baseUrl}/site/oauth2/access_token`);
    const { data } = await http<Json>(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      },
      form: { grant_type: "client_credentials" },
    });
    const token = str(data.access_token);
    if (!token)
      throw new CodeHostError(
        "authentication",
        "Bitbucket did not issue an access token for the OAuth consumer. Check that it is private and has the needed permissions.",
      );
    const minted = {
      token,
      expiresAt: new Date(Date.now() + (num(data.expires_in) ?? 3600) * 1000),
    };
    consumerTokens.set(key, minted);
    return minted;
  };
  const missing = () =>
    new CodeHostError(
      "authentication",
      "The Bitbucket connection has no usable credential. Reconnect Bitbucket.",
    );
  const authorization = async (connection: CodeConnection) => {
    if (connection.authKind === "oauth_consumer")
      return `Bearer ${(await consumerToken(connection)).token}`;
    const c = obj(connection.credential);
    const token = str(c.token);
    if (token) return `Bearer ${token}`;
    const email = str(c.email);
    const apiToken = str(c.apiToken);
    if (email && apiToken)
      return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
    throw missing();
  };
  const api = async <T>(
    connection: CodeConnection,
    path: string,
    call: CodeRequest = {},
  ) =>
    http<T>(
      path.startsWith("http") ? path : `${apiUrl(connection.baseUrl)}${path}`,
      {
        ...call,
        headers: {
          Authorization: await authorization(connection),
          ...call.headers,
        },
      },
    );
  const list = <T>(
    connection: CodeConnection,
    path: string,
    limit: number,
    stop?: (item: T) => boolean,
  ) => {
    const base = apiUrl(connection.baseUrl);
    let stopped = false;
    return collect<T>(
      `${base}${path}`,
      async (url) => {
        const { data } = await api<Json>(connection, url);
        const kept: T[] = [];
        for (const item of arr(data.values) as T[]) {
          if (stop?.(item)) {
            stopped = true;
            break;
          }
          kept.push(item);
        }
        const next = str(data.next);
        return {
          items: kept,
          next: stopped || !next ? null : sameOrigin(next, base),
        };
      },
      limit,
    );
  };
  const repo = (repository: CodeRepositoryRef) =>
    `/repositories/${repository.fullName.split("/").map(encodeURIComponent).join("/")}`;
  const notFoundIsNull = async <T>(load: () => Promise<T>) => {
    try {
      return await load();
    } catch (error) {
      if (error instanceof CodeHostError && error.kind === "not_found")
        return null;
      throw error;
    }
  };

  const toRepository = (r: Json): CodeRepositoryInfo => {
    const links = obj(r.links);
    const clone = arr(links.clone)
      .map(obj)
      .find((c) => str(c.name) === "https");
    return {
      externalId: str(r.uuid) ?? "",
      fullName: str(r.full_name) ?? "",
      defaultBranch: str(obj(r.mainbranch).name) ?? "main",
      webUrl: str(obj(links.html).href) ?? "",
      // Without the user name Bitbucket puts in front of the host.
      cloneUrl: (str(clone?.href) ?? "").replace(
        /^https:\/\/[^@/]+@/,
        "https://",
      ),
      visibility: r.is_private === false ? "public" : "private",
      archived: false,
    };
  };
  const toBasePullRequest = (p: Json): CodePullRequestInfo => {
    const state = str(p.state);
    const author = obj(p.author);
    const participants = arr(p.participants).map(obj);
    const nick = (u: Json) => str(u.nickname) ?? str(u.display_name);
    const approvedBy = participants
      .filter((x) => x.approved === true)
      .map((x) => nick(obj(x.user)))
      .filter((x): x is string => !!x);
    const changes = participants.some(
      (x) => str(x.state) === "changes_requested",
    );
    const reviewers = arr(p.reviewers)
      .map((u) => nick(obj(u)))
      .filter((x): x is string => !!x);
    const reviewDecision: CodeReviewDecision = changes
      ? "changes_requested"
      : approvedBy.length
        ? "approved"
        : reviewers.length
          ? "review_required"
          : "none";
    const closed = state === "DECLINED" || state === "SUPERSEDED";
    return {
      externalId: String(num(p.id) ?? ""),
      number: num(p.id) ?? 0,
      title: str(p.title) ?? "",
      body: str(p.description) ?? str(obj(p.summary).raw) ?? "",
      state: state === "MERGED" ? "merged" : closed ? "closed" : "open",
      draft: p.draft === true,
      authorLogin: nick(author),
      authorIsBot: str(author.type) === "app_user",
      headBranch: str(obj(obj(p.source).branch).name) ?? "",
      headSha: str(obj(obj(p.source).commit).hash) ?? "",
      baseBranch: str(obj(obj(p.destination).branch).name) ?? "",
      reviewDecision,
      requestedReviewers: reviewers,
      approvedBy,
      mergeable: null,
      webUrl: str(obj(obj(p.links).html).href) ?? "",
      mergedAt: state === "MERGED" ? date(p.updated_on) : null,
      mergedByLogin: state === "MERGED" ? nick(obj(p.closed_by)) : null,
      closedAt: closed ? date(p.updated_on) : null,
      createdAt: date(p.created_on) ?? new Date(0),
      updatedAt: date(p.updated_on) ?? new Date(0),
    };
  };
  const toIssue = (i: Json): CodeIssueInfo => {
    const state = str(i.state);
    return {
      externalId: String(num(i.id) ?? ""),
      number: num(i.id) ?? 0,
      title: str(i.title) ?? "",
      body: str(obj(i.content).raw) ?? "",
      state:
        state === "new" || state === "open" || state === "on hold"
          ? "open"
          : "closed",
      labels: [str(i.kind), str(i.priority)].filter((x): x is string => !!x),
      assignees: [str(obj(i.assignee).nickname)].filter(
        (x): x is string => !!x,
      ),
      authorLogin: str(obj(i.reporter).nickname),
      webUrl: str(obj(obj(i.links).html).href) ?? "",
      createdAt: date(i.created_on) ?? new Date(0),
      updatedAt: date(i.updated_on) ?? new Date(0),
    };
  };
  const toCommit = (c: Json): CodeCommitInfo => {
    const author = obj(c.author);
    return {
      sha: str(c.hash) ?? "",
      message: str(c.message) ?? "",
      authorName:
        str(obj(author.user).display_name) ??
        str(author.raw)?.replace(/\s*<[^>]*>$/, "") ??
        null,
      authorLogin: str(obj(author.user).nickname),
      webUrl: str(obj(obj(c.links).html).href) ?? "",
      committedAt: date(c.date) ?? new Date(0),
    };
  };
  const checkState = (state: string | null): CodeCheckRun["state"] =>
    state === "SUCCESSFUL"
      ? "success"
      : state === "INPROGRESS"
        ? "pending"
        : "failure";

  const getBranch = (
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    name: string,
  ) =>
    notFoundIsNull(async () => {
      const { data } = await api<Json>(
        connection,
        `${repo(repository)}/refs/branches/${encodeURIComponent(name)}`,
      );
      return { name, headSha: str(obj(data.target).hash) ?? "" };
    });
  const getPullRequest = (
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
  ) =>
    notFoundIsNull(async () =>
      toBasePullRequest(
        (
          await api<Json>(
            connection,
            `${repo(repository)}/pullrequests/${number}`,
          )
        ).data,
      ),
    );

  return {
    kind: "bitbucket",
    authKinds: ["token", "oauth_consumer"],
    normalizeBaseUrl(input) {
      const value = input.trim().replace(/\/+$/, "").toLowerCase();
      if (
        !value ||
        ["bitbucket.org", CLOUD, "https://api.bitbucket.org"].includes(value)
      )
        return CLOUD;
      // A local stand-in outside production; Data Center is another adapter.
      if (
        process.env.NODE_ENV !== "production" &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(value)
      )
        return value;
      throw new CodeHostError(
        "validation",
        "This adapter connects Bitbucket Cloud (https://bitbucket.org). Bitbucket Data Center is not supported yet.",
      );
    },
    async verify(connection) {
      try {
        const { data } = await api<Json>(connection, "/user");
        const name = str(data.nickname) ?? str(data.display_name);
        if (name) return { accountLabel: name };
      } catch (error) {
        // Repository and workspace access tokens are not users.
        if (
          !(error instanceof CodeHostError) ||
          error.kind === "authentication"
        )
          throw error;
      }
      await api(connection, "/repositories?role=member&pagelen=1");
      return { accountLabel: "Bitbucket access token" };
    },
    async listRepositories(connection, query) {
      const q = query?.trim()
        ? `&q=${encodeURIComponent(`full_name ~ "${query.trim().replaceAll('"', "")}"`)}`
        : "";
      const repositories = await list<Json>(
        connection,
        `/repositories?role=member&sort=-updated_on&pagelen=100${q}`,
        1000,
      );
      return repositories.map(toRepository);
    },
    getRepository(connection, fullNameOrId) {
      return notFoundIsNull(async () =>
        toRepository(
          (
            await api<Json>(
              connection,
              repo({ externalId: "", fullName: fullNameOrId }),
            )
          ).data,
        ),
      );
    },
    async listBranches(connection, repository) {
      const branches = await list<Json>(
        connection,
        `${repo(repository)}/refs/branches?pagelen=100`,
        1000,
      );
      return branches.map((b) => ({
        name: str(b.name) ?? "",
        headSha: str(obj(b.target).hash) ?? "",
      }));
    },
    getBranch,
    async listPullRequests(connection, repository, options) {
      const since = options.since?.getTime();
      const states = ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]
        .map((s) => `state=${s}`)
        .join("&");
      const prs = await list<Json>(
        connection,
        `${repo(repository)}/pullrequests?${states}&sort=-updated_on&pagelen=50`,
        options.limit ?? 200,
        (p) =>
          since !== undefined &&
          str(p.state) !== "OPEN" &&
          (date(p.updated_on)?.getTime() ?? 0) < since,
      );
      return prs.map(toBasePullRequest);
    },
    getPullRequest,
    async listPullRequestFiles(connection, repository, number) {
      const stats = await list<Json>(
        connection,
        `${repo(repository)}/pullrequests/${number}/diffstat?pagelen=100`,
        300,
      );
      const { data: diff } = await api<string>(
        connection,
        `${repo(repository)}/pullrequests/${number}/diff`,
        { text: true, headers: { Accept: "text/plain" } },
      );
      const patches = splitDiff(diff ?? "");
      return stats.map((s): CodePullRequestFile => {
        const status = str(s.status);
        const path = str(obj(s.new).path) ?? str(obj(s.old).path) ?? "unknown";
        return {
          path,
          previousPath: status === "renamed" ? str(obj(s.old).path) : null,
          status:
            status === "added"
              ? "added"
              : status === "removed"
                ? "removed"
                : status === "renamed"
                  ? "renamed"
                  : "modified",
          additions: num(s.lines_added) ?? 0,
          deletions: num(s.lines_removed) ?? 0,
          patch: patches.get(path) ?? null,
        };
      });
    },
    async getChecks(connection, repository, sha) {
      const statuses = await list<Json>(
        connection,
        `${repo(repository)}/commit/${encodeURIComponent(sha)}/statuses?pagelen=100`,
        300,
      );
      return summarize(
        statuses.map((s) => ({
          name: str(s.name) ?? str(s.key) ?? "build",
          state: checkState(str(s.state)),
          url: str(s.url),
        })),
      );
    },
    async listIssues(connection, repository, options) {
      const since = options.since
        ? `&q=${encodeURIComponent(`updated_on > ${options.since.toISOString()}`)}`
        : "";
      try {
        const issues = await list<Json>(
          connection,
          `${repo(repository)}/issues?sort=-updated_on&pagelen=50${since}`,
          options.limit ?? 300,
        );
        return issues.map(toIssue);
      } catch (error) {
        // The repository has no issue tracker.
        if (error instanceof CodeHostError && error.kind === "not_found")
          return [];
        throw error;
      }
    },
    getIssue(connection, repository, number) {
      return notFoundIsNull(async () =>
        toIssue(
          (await api<Json>(connection, `${repo(repository)}/issues/${number}`))
            .data,
        ),
      );
    },
    async listCommits(connection, repository, options) {
      const since = options.since?.getTime();
      const path = options.branch
        ? `${repo(repository)}/commits/${encodeURIComponent(options.branch)}?pagelen=100`
        : `${repo(repository)}/commits?pagelen=100`;
      const commits = await list<Json>(
        connection,
        path,
        options.limit ?? 300,
        (c) => since !== undefined && (date(c.date)?.getTime() ?? 0) < since,
      );
      return commits.map(toCommit);
    },

    verifyWebhook: verifyBitbucketWebhook,
    parseWebhook(event, raw): CodeWebhookEvent[] {
      const payload = obj(raw);
      const r = obj(payload.repository);
      const repository: CodeRepositoryRef = {
        externalId: str(r.uuid) ?? "",
        fullName: str(r.full_name) ?? "",
      };
      if (!repository.externalId) return [];
      if (event.startsWith("pullrequest:")) {
        const number = num(obj(payload.pullrequest).id);
        return number ? [{ kind: "pull_request", repository, number }] : [];
      }
      if (event.startsWith("issue:")) {
        const number = num(obj(payload.issue).id);
        return number ? [{ kind: "issue", repository, number }] : [];
      }
      if (event.startsWith("repo:commit_status_")) {
        const status = obj(payload.commit_status);
        const sha = str(obj(status.commit).hash);
        return sha
          ? [{ kind: "checks", repository, sha, pullRequests: [] }]
          : [];
      }
      if (event === "repo:push")
        return arr(obj(payload.push).changes).flatMap(
          (c): CodeWebhookEvent[] => {
            const change = obj(c);
            const next = obj(change.new);
            const old = obj(change.old);
            const subject = change.new ? next : old;
            if (str(subject.type) !== "branch") return [];
            const deleted = change.closed === true || !change.new;
            return [
              {
                kind: "push",
                repository,
                branch: str(subject.name) ?? "",
                headSha: deleted ? null : str(obj(next.target).hash),
                deleted,
                commits: arr(change.commits).map((x) => toCommit(obj(x))),
              },
            ];
          },
        );
      if (event === "repo:updated") return [{ kind: "repository", repository }];
      return [];
    },

    async createBranch(connection, repository, name, fromSha) {
      try {
        await api(connection, `${repo(repository)}/refs/branches`, {
          method: "POST",
          body: { name, target: { hash: fromSha } },
        });
        return { name, headSha: fromSha };
      } catch (error) {
        if (error instanceof CodeHostError && error.kind === "validation") {
          const existing = await getBranch(connection, repository, name);
          if (existing && fromSha.startsWith(existing.headSha.slice(0, 12)))
            return existing;
          if (existing)
            throw new CodeHostError(
              "conflict",
              `A branch named ${name} already exists on Bitbucket at another commit.`,
            );
        }
        throw error;
      }
    },
    async findOpenPullRequest(connection, repository, headBranch) {
      const q = encodeURIComponent(
        `source.branch.name = "${headBranch.replaceAll('"', "")}" AND state = "OPEN"`,
      );
      const { data } = await api<Json>(
        connection,
        `${repo(repository)}/pullrequests?q=${q}&pagelen=5`,
      );
      const found = arr(data.values)[0];
      return found ? toBasePullRequest(obj(found)) : null;
    },
    async openPullRequest(connection, repository, input) {
      const { data } = await api<Json>(
        connection,
        `${repo(repository)}/pullrequests`,
        {
          method: "POST",
          body: {
            title: input.title,
            description: input.body,
            source: { branch: { name: input.head } },
            destination: { branch: { name: input.base } },
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
        `${repo(repository)}/pullrequests/${number}/comments?pagelen=100&sort=-created_on`,
        300,
      );
      const found = comments.find((c) =>
        str(obj(c.content).raw)?.includes(marker),
      );
      return found
        ? {
            id: String(num(found.id) ?? ""),
            url: str(obj(obj(found.links).html).href),
          }
        : null;
    },
    async comment(connection, repository, number, body) {
      const { data } = await api<Json>(
        connection,
        `${repo(repository)}/pullrequests/${number}/comments`,
        { method: "POST", body: { content: { raw: body } }, once: true },
      );
      return {
        id: String(num(data.id) ?? ""),
        url: str(obj(obj(data.links).html).href),
      };
    },
    async requestReview(connection, repository, number, reviewers) {
      const workspace = repository.fullName.split("/")[0]!;
      const members = await list<Json>(
        connection,
        `/workspaces/${encodeURIComponent(workspace)}/members?pagelen=100`,
        1000,
      );
      const uuids = reviewers.map((login) => {
        const user = members
          .map((m) => obj(m.user))
          .find((u) => str(u.nickname) === login);
        if (!user)
          throw new CodeHostError(
            "not_found",
            `${login} is not a member of the ${workspace} workspace.`,
          );
        return str(user.uuid)!;
      });
      const { data } = await api<Json>(
        connection,
        `${repo(repository)}/pullrequests/${number}`,
      );
      const existing = arr(data.reviewers)
        .map((u) => str(obj(u).uuid))
        .filter((x): x is string => !!x);
      await api(connection, `${repo(repository)}/pullrequests/${number}`, {
        method: "PUT",
        body: {
          title: str(data.title),
          reviewers: [...new Set([...existing, ...uuids])].map((uuid) => ({
            uuid,
          })),
        },
      });
    },
    async merge(connection, repository, number, input) {
      const current = await getPullRequest(connection, repository, number);
      if (current?.state === "merged") return { sha: null };
      // Bitbucket cannot merge on a condition; the head is compared just
      // before (hashes may be abbreviated).
      if (
        current &&
        !input.expectedHeadSha.startsWith(current.headSha.slice(0, 12)) &&
        !current.headSha.startsWith(input.expectedHeadSha.slice(0, 12))
      )
        throw new CodeHostError(
          "conflict",
          "The pull request has new commits since it was checked. Review them before merging.",
        );
      const { data } = await api<Json>(
        connection,
        `${repo(repository)}/pullrequests/${number}/merge`,
        {
          method: "POST",
          body: {
            merge_strategy:
              input.method === "squash"
                ? "squash"
                : input.method === "rebase"
                  ? "fast_forward"
                  : "merge_commit",
          },
        },
      );
      return { sha: str(obj(data.merge_commit).hash) };
    },
    async setPullRequestState(connection, repository, number, state) {
      if (state === "open")
        throw new CodeHostError(
          "validation",
          "Bitbucket cannot reopen a declined pull request. Open a new one from the same branch.",
        );
      await api(
        connection,
        `${repo(repository)}/pullrequests/${number}/decline`,
        {
          method: "POST",
        },
      );
    },
    async createSessionCredential(connection) {
      if (connection.authKind === "oauth_consumer") {
        const minted = await consumerToken(connection);
        return {
          username: "x-token-auth",
          token: minted.token,
          expiresAt: minted.expiresAt,
          longLived: false,
        };
      }
      const c = obj(connection.credential);
      const token = str(c.token);
      if (token)
        return {
          username: "x-token-auth",
          token,
          expiresAt: null,
          longLived: true,
        };
      const apiToken = str(c.apiToken);
      if (!apiToken) throw missing();
      return {
        username: "x-bitbucket-api-token-auth",
        token: apiToken,
        expiresAt: null,
        longLived: true,
      };
    },
  };
}

// Per-file hunks of a unified diff, by the file's new path.
function splitDiff(diff: string) {
  const files = new Map<string, string>();
  const parts = diff.split(/^diff --git /m).slice(1);
  for (const part of parts) {
    const header = /^a\/(.+?) b\/(.+?)$/m.exec(part);
    if (!header) continue;
    const start = part.indexOf("@@");
    files.set(header[2]!, start >= 0 ? part.slice(start) : "");
  }
  return files;
}
