import { summarize } from "@lictory/core/code/checks";
import { selfManagedOrigin } from "@lictory/core/code/egress";
import {
  collect,
  createCodeHttp,
  date,
  nextLink,
  type CodeHttpOptions,
  type CodeRequest,
} from "@lictory/core/code/http";
import {
  CodeHostError,
  type CodeBranchInfo,
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
import { verifyGitLabWebhook } from "@lictory/core/code/signatures";

// GitLab (gitlab.com and self-managed) through REST API v4 with a personal,
// group or project access token (scope `api`; `read_api` is enough for a
// read-only mirror). Merge requests are this module's pull requests and
// their `iid` its number.

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);

const CLOUD = "https://gitlab.com";
const ZERO_SHA = /^0{40}$/;

export function gitlabApiUrl(baseUrl: string) {
  return `${baseUrl}/api/v4`;
}

function token(connection: CodeConnection) {
  const value = str(obj(connection.credential).token);
  if (!value)
    throw new CodeHostError(
      "authentication",
      "The GitLab connection has no usable access token. Reconnect GitLab.",
    );
  return value;
}

export function createGitLabProvider(
  options: CodeHttpOptions = {},
): CodeHostProvider {
  const http = createCodeHttp(
    "GitLab",
    (_status, body) => {
      const b = obj(body);
      const message = b.message ?? b.error;
      const text =
        typeof message === "string"
          ? message
          : Array.isArray(message)
            ? message.map(String).join(" ")
            : message && typeof message === "object"
              ? Object.entries(message as Json)
                  .map(
                    ([k, v]) =>
                      `${k} ${Array.isArray(v) ? v.join(", ") : String(v)}`,
                  )
                  .join("; ")
              : undefined;
      return { message: text };
    },
    options,
  );
  const api = <T>(
    connection: CodeConnection,
    path: string,
    call: CodeRequest = {},
  ) =>
    http<T>(
      path.startsWith("http")
        ? path
        : `${gitlabApiUrl(connection.baseUrl)}${path}`,
      {
        ...call,
        headers: { "PRIVATE-TOKEN": token(connection), ...call.headers },
      },
    );
  const list = <T>(connection: CodeConnection, path: string, limit: number) => {
    const base = gitlabApiUrl(connection.baseUrl);
    return collect<T>(
      `${base}${path}`,
      async (url) => {
        const { data, headers } = await api<unknown>(connection, url);
        return { items: arr(data) as T[], next: nextLink(headers, base) };
      },
      limit,
    );
  };
  const project = (repository: CodeRepositoryRef) =>
    `/projects/${encodeURIComponent(repository.externalId || repository.fullName)}`;
  const notFoundIsNull = async <T>(load: () => Promise<T>) => {
    try {
      return await load();
    } catch (error) {
      if (error instanceof CodeHostError && error.kind === "not_found")
        return null;
      throw error;
    }
  };

  const toRepository = (p: Json): CodeRepositoryInfo => ({
    externalId: String(num(p.id) ?? ""),
    fullName: str(p.path_with_namespace) ?? "",
    defaultBranch: str(p.default_branch) ?? "main",
    webUrl: str(p.web_url) ?? "",
    cloneUrl: str(p.http_url_to_repo) ?? "",
    visibility:
      str(p.visibility) === "internal"
        ? "internal"
        : str(p.visibility) === "public"
          ? "public"
          : "private",
    archived: p.archived === true,
  });
  const toBaseMergeRequest = (m: Json): CodePullRequestInfo => {
    const state = str(m.state);
    const author = obj(m.author);
    return {
      externalId: String(num(m.id) ?? ""),
      number: num(m.iid) ?? 0,
      title: str(m.title) ?? "",
      body: str(m.description) ?? "",
      state:
        state === "merged" ? "merged" : state === "opened" ? "open" : "closed",
      draft: m.draft === true || m.work_in_progress === true,
      authorLogin: str(author.username),
      authorIsBot: author.bot === true,
      headBranch: str(m.source_branch) ?? "",
      headSha: str(m.sha) ?? "",
      baseBranch: str(m.target_branch) ?? "",
      reviewDecision: "none",
      requestedReviewers: arr(m.reviewers)
        .map((r) => str(obj(r).username))
        .filter((x): x is string => !!x),
      approvedBy: [],
      mergeable:
        str(m.detailed_merge_status) === "mergeable" ||
        str(m.merge_status) === "can_be_merged"
          ? true
          : str(m.merge_status) === "cannot_be_merged"
            ? false
            : null,
      webUrl: str(m.web_url) ?? "",
      mergedAt: date(m.merged_at),
      mergedByLogin:
        str(obj(m.merge_user).username) ?? str(obj(m.merged_by).username),
      closedAt: date(m.closed_at),
      createdAt: date(m.created_at) ?? new Date(0),
      updatedAt: date(m.updated_at) ?? new Date(0),
    };
  };
  const withApprovals = async (
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    mr: CodePullRequestInfo,
  ): Promise<CodePullRequestInfo> => {
    const { data } = await api<Json>(
      connection,
      `${project(repository)}/merge_requests/${mr.number}/approvals`,
    );
    const approvedBy = arr(data.approved_by)
      .map((a) => str(obj(obj(a).user).username))
      .filter((x): x is string => !!x);
    // Reviewer states (GitLab 17+): "requested_changes" blocks.
    const reviewers = await api<unknown[]>(
      connection,
      `${project(repository)}/merge_requests/${mr.number}/reviewers`,
    ).catch(() => ({ data: [] as unknown[] }));
    const changes = arr(reviewers.data).some(
      (r) => str(obj(r).state) === "requested_changes",
    );
    const left = num(data.approvals_left) ?? 0;
    const reviewDecision: CodeReviewDecision = changes
      ? "changes_requested"
      : approvedBy.length && left === 0
        ? "approved"
        : left > 0 || mr.requestedReviewers.length
          ? "review_required"
          : "none";
    return { ...mr, approvedBy, reviewDecision };
  };
  const toIssue = (i: Json): CodeIssueInfo => ({
    externalId: String(num(i.id) ?? ""),
    number: num(i.iid) ?? 0,
    title: str(i.title) ?? "",
    body: str(i.description) ?? "",
    state: str(i.state) === "closed" ? "closed" : "open",
    labels: arr(i.labels)
      .map((l) => str(l) ?? str(obj(l).name))
      .filter((x): x is string => !!x),
    assignees: arr(i.assignees)
      .map((a) => str(obj(a).username))
      .filter((x): x is string => !!x),
    authorLogin: str(obj(i.author).username),
    webUrl: str(i.web_url) ?? "",
    createdAt: date(i.created_at) ?? new Date(0),
    updatedAt: date(i.updated_at) ?? new Date(0),
  });
  const toCommit = (c: Json): CodeCommitInfo => ({
    sha: str(c.id) ?? "",
    message: str(c.message) ?? "",
    authorName: str(c.author_name) ?? str(obj(c.author).name),
    authorLogin: null,
    webUrl: str(c.web_url) ?? str(c.url) ?? "",
    committedAt:
      date(c.committed_date) ??
      date(c.timestamp) ??
      date(c.created_at) ??
      new Date(0),
  });
  const statusState = (status: string | null): CodeCheckRun["state"] =>
    status === "success"
      ? "success"
      : status === "skipped" || status === "manual"
        ? "neutral"
        : status === "failed" || status === "canceled"
          ? "failure"
          : "pending";

  const getBranch = (
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    name: string,
  ) =>
    notFoundIsNull(async () => {
      const { data } = await api<Json>(
        connection,
        `${project(repository)}/repository/branches/${encodeURIComponent(name)}`,
      );
      return { name, headSha: str(obj(data.commit).id) ?? "" };
    });
  const getMergeRequest = (
    connection: CodeConnection,
    repository: CodeRepositoryRef,
    number: number,
  ) =>
    notFoundIsNull(async () => {
      const { data } = await api<Json>(
        connection,
        `${project(repository)}/merge_requests/${number}`,
      );
      return withApprovals(connection, repository, toBaseMergeRequest(data));
    });

  return {
    kind: "gitlab",
    authKinds: ["token"],
    normalizeBaseUrl(input) {
      const value = input.trim().replace(/\/+$/, "").toLowerCase();
      if (!value || value === "gitlab.com" || value === CLOUD) return CLOUD;
      return selfManagedOrigin(input, "GitLab instance");
    },
    async verify(connection) {
      const { data } = await api<Json>(connection, "/user");
      const username = str(data.username);
      if (!username)
        throw new CodeHostError(
          "authentication",
          "GitLab did not say who the token belongs to.",
        );
      return { accountLabel: `@${username}` };
    },
    async listRepositories(connection, query) {
      const search = query?.trim()
        ? `&search=${encodeURIComponent(query.trim())}`
        : "";
      const projects = await list<Json>(
        connection,
        `/projects?membership=true&archived=false&order_by=last_activity_at&per_page=100${search}`,
        1000,
      );
      return projects.map(toRepository);
    },
    getRepository(connection, fullNameOrId) {
      return notFoundIsNull(async () =>
        toRepository(
          (
            await api<Json>(
              connection,
              `/projects/${encodeURIComponent(fullNameOrId)}`,
            )
          ).data,
        ),
      );
    },
    async listBranches(connection, repository) {
      const branches = await list<Json>(
        connection,
        `${project(repository)}/repository/branches?per_page=100`,
        1000,
      );
      return branches.map((b): CodeBranchInfo => ({
        name: str(b.name) ?? "",
        headSha: str(obj(b.commit).id) ?? "",
      }));
    },
    getBranch,
    async listPullRequests(connection, repository, options) {
      const limit = options.limit ?? 200;
      const open = await list<Json>(
        connection,
        `${project(repository)}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=50`,
        limit,
      );
      const since = options.since
        ? `&updated_after=${encodeURIComponent(options.since.toISOString())}`
        : "";
      const recent = await list<Json>(
        connection,
        `${project(repository)}/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=50${since}`,
        limit,
      );
      const byIid = new Map<number, Json>();
      for (const m of [...open, ...recent]) byIid.set(num(m.iid) ?? 0, m);
      return [...byIid.values()].map(toBaseMergeRequest).slice(0, limit);
    },
    getPullRequest: getMergeRequest,
    async listPullRequestFiles(connection, repository, number) {
      const diffs = await list<Json>(
        connection,
        `${project(repository)}/merge_requests/${number}/diffs?per_page=100`,
        300,
      );
      return diffs.map((d): CodePullRequestFile => {
        const patch = str(d.diff);
        const lines = (patch ?? "").split("\n");
        return {
          path: str(d.new_path) ?? "",
          previousPath: d.renamed_file === true ? str(d.old_path) : null,
          status:
            d.new_file === true
              ? "added"
              : d.deleted_file === true
                ? "removed"
                : d.renamed_file === true
                  ? "renamed"
                  : "modified",
          additions: lines.filter(
            (l) => l.startsWith("+") && !l.startsWith("+++"),
          ).length,
          deletions: lines.filter(
            (l) => l.startsWith("-") && !l.startsWith("---"),
          ).length,
          patch: patch?.length ? patch : null,
        };
      });
    },
    async getChecks(connection, repository, sha) {
      const statuses = await list<Json>(
        connection,
        `${project(repository)}/repository/commits/${encodeURIComponent(sha)}/statuses?per_page=100`,
        300,
      );
      // Retried jobs repeat a name; the newest counts.
      const latest = new Map<string, Json>();
      for (const s of statuses) {
        const name = str(s.name) ?? "pipeline";
        const previous = latest.get(name);
        if (!previous || (num(s.id) ?? 0) > (num(previous.id) ?? 0))
          latest.set(name, s);
      }
      return summarize(
        [...latest].map(([name, s]) => ({
          name,
          state: statusState(str(s.status)),
          url: str(s.target_url),
          ...(s.allow_failure === true ? { required: false } : {}),
        })),
      );
    },
    async listIssues(connection, repository, options) {
      const since = options.since
        ? `&updated_after=${encodeURIComponent(options.since.toISOString())}`
        : "";
      const issues = await list<Json>(
        connection,
        `${project(repository)}/issues?order_by=updated_at&sort=desc&per_page=100${since}`,
        options.limit ?? 300,
      );
      return issues.map(toIssue);
    },
    getIssue(connection, repository, number) {
      return notFoundIsNull(async () =>
        toIssue(
          (
            await api<Json>(
              connection,
              `${project(repository)}/issues/${number}`,
            )
          ).data,
        ),
      );
    },
    async listCommits(connection, repository, options) {
      const query = new URLSearchParams({ per_page: "100" });
      if (options.branch) query.set("ref_name", options.branch);
      if (options.since) query.set("since", options.since.toISOString());
      const commits = await list<Json>(
        connection,
        `${project(repository)}/repository/commits?${query.toString()}`,
        options.limit ?? 300,
      );
      return commits.map(toCommit);
    },

    verifyWebhook: verifyGitLabWebhook,
    parseWebhook(event, raw): CodeWebhookEvent[] {
      const payload = obj(raw);
      const p = obj(payload.project);
      const repository: CodeRepositoryRef = {
        externalId: String(num(p.id) ?? num(payload.project_id) ?? ""),
        fullName: str(p.path_with_namespace) ?? "",
      };
      if (!repository.externalId) return [];
      const attributes = obj(payload.object_attributes);
      switch (event) {
        case "Merge Request Hook": {
          const number = num(attributes.iid);
          return number ? [{ kind: "pull_request", repository, number }] : [];
        }
        case "Note Hook": {
          const number = num(obj(payload.merge_request).iid);
          return number ? [{ kind: "pull_request", repository, number }] : [];
        }
        case "Issue Hook": {
          const number = num(attributes.iid);
          return number ? [{ kind: "issue", repository, number }] : [];
        }
        case "Push Hook": {
          const ref = str(payload.ref) ?? "";
          if (!ref.startsWith("refs/heads/")) return [];
          const after = str(payload.after);
          const deleted = !!after && ZERO_SHA.test(after);
          return [
            {
              kind: "push",
              repository,
              branch: ref.slice("refs/heads/".length),
              headSha: deleted ? null : after,
              deleted,
              commits: arr(payload.commits).map((c) => toCommit(obj(c))),
            },
          ];
        }
        case "Pipeline Hook":
        case "Job Hook": {
          const sha = str(attributes.sha) ?? str(payload.sha);
          const mr = num(obj(payload.merge_request).iid);
          return sha
            ? [
                {
                  kind: "checks",
                  repository,
                  sha,
                  pullRequests: mr ? [mr] : [],
                },
              ]
            : [];
        }
        default:
          return [];
      }
    },

    async createBranch(connection, repository, name, fromSha) {
      try {
        await api(
          connection,
          `${project(repository)}/repository/branches?branch=${encodeURIComponent(name)}&ref=${encodeURIComponent(fromSha)}`,
          { method: "POST" },
        );
        return { name, headSha: fromSha };
      } catch (error) {
        if (error instanceof CodeHostError && error.kind === "validation") {
          const existing = await getBranch(connection, repository, name);
          if (existing?.headSha === fromSha) return existing;
          if (existing)
            throw new CodeHostError(
              "conflict",
              `A branch named ${name} already exists on GitLab at another commit.`,
            );
        }
        throw error;
      }
    },
    async findOpenPullRequest(connection, repository, headBranch) {
      const { data } = await api<unknown[]>(
        connection,
        `${project(repository)}/merge_requests?state=opened&source_branch=${encodeURIComponent(headBranch)}&per_page=5`,
      );
      const found = arr(data)[0];
      return found
        ? getMergeRequest(connection, repository, num(obj(found).iid) ?? 0)
        : null;
    },
    async openPullRequest(connection, repository, input) {
      const { data } = await api<Json>(
        connection,
        `${project(repository)}/merge_requests`,
        {
          method: "POST",
          body: {
            source_branch: input.head,
            target_branch: input.base,
            title: input.draft ? `Draft: ${input.title}` : input.title,
            description: input.body,
            remove_source_branch: false,
          },
          once: true,
        },
      );
      return toBaseMergeRequest(data);
    },
    async findComment(connection, repository, number, marker) {
      const notes = await list<Json>(
        connection,
        `${project(repository)}/merge_requests/${number}/notes?per_page=100&sort=desc`,
        300,
      );
      const found = notes.find((n) => str(n.body)?.includes(marker));
      return found ? { id: String(num(found.id) ?? ""), url: null } : null;
    },
    async comment(connection, repository, number, body) {
      const { data } = await api<Json>(
        connection,
        `${project(repository)}/merge_requests/${number}/notes`,
        { method: "POST", body: { body }, once: true },
      );
      return { id: String(num(data.id) ?? ""), url: null };
    },
    async requestReview(connection, repository, number, reviewers) {
      const ids: number[] = [];
      for (const login of reviewers) {
        const { data } = await api<unknown[]>(
          connection,
          `/users?username=${encodeURIComponent(login)}`,
        );
        const id = num(obj(arr(data)[0]).id);
        if (!id)
          throw new CodeHostError(
            "not_found",
            `GitLab has no user named ${login}.`,
          );
        ids.push(id);
      }
      const { data } = await api<Json>(
        connection,
        `${project(repository)}/merge_requests/${number}`,
      );
      const existing = arr(data.reviewers)
        .map((r) => num(obj(r).id))
        .filter((x): x is number => !!x);
      await api(connection, `${project(repository)}/merge_requests/${number}`, {
        method: "PUT",
        body: { reviewer_ids: [...new Set([...existing, ...ids])] },
      });
    },
    async merge(connection, repository, number, input) {
      if (input.method === "rebase")
        throw new CodeHostError(
          "validation",
          "GitLab chooses fast-forward and rebase merges in the project's merge settings. Choose Merge or Squash.",
        );
      try {
        const { data } = await api<Json>(
          connection,
          `${project(repository)}/merge_requests/${number}/merge`,
          {
            method: "PUT",
            body: {
              sha: input.expectedHeadSha,
              squash: input.method === "squash",
            },
          },
        );
        return { sha: str(data.merge_commit_sha) };
      } catch (error) {
        if (
          error instanceof CodeHostError &&
          (error.kind === "conflict" || error.kind === "validation")
        ) {
          const current = await getMergeRequest(connection, repository, number);
          if (current?.state === "merged") return { sha: null };
        }
        throw error;
      }
    },
    async setPullRequestState(connection, repository, number, state) {
      await api(connection, `${project(repository)}/merge_requests/${number}`, {
        method: "PUT",
        body: { state_event: state === "closed" ? "close" : "reopen" },
      });
    },
    createSessionCredential(connection) {
      return Promise.resolve({
        username: "oauth2",
        token: token(connection),
        expiresAt: null,
        longLived: true,
      });
    },
  };
}
