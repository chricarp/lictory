// Stand-ins for GitHub (Enterprise Server shape), GitLab and Bitbucket Cloud,
// for browser workflows of the Code module (tests/platform/code.spec.ts).
// Each one implements the REST endpoints its real adapter calls
// (packages/core/src/code/<host>) with the host's shapes, and sends signed
// webhooks the way the host would, so connecting, ingest, the outbox and
// merging run unchanged against them. A test plays the people working on the
// host through /__fake/*: creating repositories, opening pull requests,
// turning checks green, approving.
//
// They run inside scripts/test-e2e.ts on 127.0.0.1 and are reached only
// through route-fake-sites.ts, which that script preloads into the API and
// worker it starts. Production images contain neither file.
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { json, listen, send } from "./http";

export const FAKE_GITHUB_SITE = "https://github.lictory-e2e.test";
export const FAKE_GITHUB_TOKEN = "e2e-fake-github-token";
export const FAKE_GITLAB_SITE = "https://gitlab.lictory-e2e.test";
const FAKE_GITLAB_TOKEN = "e2e-fake-gitlab-token";
// Bitbucket Cloud has fixed addresses; the route sends both to the fake.
export const FAKE_BITBUCKET_API = "https://api.bitbucket.org";
const FAKE_BITBUCKET_TOKEN = "e2e-fake-bitbucket-token";

type Check = { name: string; state: "pending" | "success" | "failure" };
type PullRequest = {
  id: number;
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  sha: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  author: string;
  reviewers: string[];
  approvals: string[];
  comments: { id: number; body: string }[];
  created: Date;
  updated: Date;
  mergedAt: Date | null;
};
type Issue = {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  created: Date;
  updated: Date;
};
type Repo = {
  id: number;
  uuid: string;
  fullName: string;
  defaultBranch: string;
  branches: Map<string, string>;
  pulls: Map<number, PullRequest>;
  issues: Map<number, Issue>;
  checks: Map<string, Check[]>;
  sequence: number;
  // A real bare repository on this machine (`git: true`), cloned and pushed
  // to over file:// by a real lictory-runner; its branches are the host's.
  gitDir: string | null;
};
type Hook = { url: string; secret: string };

const git = (gitDir: string, args: string[], input?: string) =>
  execFileSync("git", ["--git-dir", gitDir, ...args], {
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fake Host",
      GIT_AUTHOR_EMAIL: "host@example.test",
      GIT_COMMITTER_NAME: "Fake Host",
      GIT_COMMITTER_EMAIL: "host@example.test",
    },
  }).trim();

// A bare repository whose default branch has one commit with a README.
function createGitRepository(fullName: string, defaultBranch: string) {
  const root = mkdtempSync(join(tmpdir(), "lictory-fake-git-"));
  const gitDir = join(root, `${fullName.replaceAll("/", "__")}.git`);
  mkdirSync(gitDir, { recursive: true });
  git(gitDir, ["init", "--quiet", "--bare", "--initial-branch", defaultBranch]);
  const blob = git(gitDir, ["hash-object", "-w", "--stdin"], "# Payments\n");
  const tree = git(gitDir, ["mktree"], `100644 blob ${blob}\tREADME.md\n`);
  const commit = git(gitDir, ["commit-tree", tree, "-m", "Initial commit"]);
  git(gitDir, ["update-ref", `refs/heads/${defaultBranch}`, commit]);
  return { gitDir, head: commit };
}

// The state every host's fake keeps.
function createModel() {
  const repos = new Map<string, Repo>();
  const hooks: Hook[] = [];
  let ids = 1000;
  const sha = () => (ids++).toString(16).padStart(40, "c");
  const tick = () => new Date();
  return {
    repos,
    hooks,
    sha,
    next: () => ids++,
    tick,
    repo(fullNameOrId: string) {
      const decoded = decodeURIComponent(fullNameOrId);
      return (
        repos.get(decoded) ??
        [...repos.values()].find(
          (r) => String(r.id) === decoded || r.uuid === decoded,
        )
      );
    },
    addRepo(fullName: string, defaultBranch = "main", withGit = false) {
      const existing = repos.get(fullName);
      if (existing) return existing;
      const created = withGit
        ? createGitRepository(fullName, defaultBranch)
        : null;
      const repo: Repo = {
        id: ids++,
        uuid: `{${randomUUID()}}`,
        fullName,
        defaultBranch,
        branches: new Map([[defaultBranch, created?.head ?? sha()]]),
        pulls: new Map(),
        issues: new Map(),
        checks: new Map(),
        sequence: 0,
        gitDir: created?.gitDir ?? null,
      };
      repos.set(fullName, repo);
      return repo;
    },
    // A repository with real git: its branches are what was pushed, and an
    // open pull request's head follows its branch (as on the host).
    syncGit(repo: Repo) {
      if (!repo.gitDir) return;
      const refs = git(repo.gitDir, [
        "for-each-ref",
        "--format=%(refname:short) %(objectname)",
        "refs/heads",
      ]);
      for (const line of refs.split("\n").filter(Boolean)) {
        const [name, head] = line.split(" ") as [string, string];
        repo.branches.set(name, head);
        for (const pull of repo.pulls.values())
          if (
            pull.state === "open" &&
            pull.head === name &&
            pull.sha !== head
          ) {
            pull.sha = head;
            pull.updated = tick();
          }
      }
    },
    openPull(
      repo: Repo,
      input: {
        head: string;
        base?: string;
        title: string;
        body?: string;
        author?: string;
      },
    ) {
      const head = repo.branches.get(input.head) ?? sha();
      repo.branches.set(input.head, head);
      const number = ++repo.sequence;
      const pull: PullRequest = {
        id: ids++,
        number,
        title: input.title,
        body: input.body ?? "",
        head: input.head,
        base: input.base ?? repo.defaultBranch,
        sha: head,
        state: "open",
        draft: false,
        author: input.author ?? "ada",
        reviewers: [],
        approvals: [],
        comments: [],
        created: tick(),
        updated: tick(),
        mergedAt: null,
      };
      repo.pulls.set(number, pull);
      return pull;
    },
    async deliver(
      headers: (body: string, secret: string) => Record<string, string>,
      payload: unknown,
    ) {
      const body = JSON.stringify(payload);
      // Every registered webhook receives every delivery, independently, as
      // on the host: specs running in parallel each register their own
      // organization's webhook and ignore repositories they did not link.
      await Promise.all(
        hooks.map((hook) =>
          fetch(hook.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers(body, hook.secret),
            },
            body,
          }).catch((error: unknown) =>
            console.error("[fake code host] webhook failed", error),
          ),
        ),
      );
    },
  };
}
type Model = ReturnType<typeof createModel>;

const hmac = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

// The test's side, shared by the three fakes: /__fake/*.
async function control(
  model: Model,
  method: string,
  path: string,
  body: Record<string, unknown>,
  events: {
    pull: (repo: Repo, pull: PullRequest, action: string) => Promise<void>;
    checks: (repo: Repo, sha: string, pull: PullRequest) => Promise<void>;
  },
): Promise<[number, unknown?]> {
  let match: RegExpExecArray | null;
  if (method === "POST" && path === "/__fake/repos") {
    const repo = model.addRepo(
      String(body.fullName),
      (body.defaultBranch as string) || "main",
      body.git === true,
    );
    return [200, { ...repo, branches: Object.fromEntries(repo.branches) }];
  }
  if (method === "POST" && path === "/__fake/hooks") {
    // Registering adds a webhook (the host keeps many); registering the
    // same address again replaces its secret.
    const url = String(body.url);
    const existing = model.hooks.findIndex((hook) => hook.url === url);
    if (existing !== -1) model.hooks.splice(existing, 1);
    model.hooks.push({ url, secret: String(body.secret) });
    return [204];
  }
  if (
    (match = /^\/__fake\/repos\/(.+)\/pulls(?:\/(\d+)(?:\/(\w+))?)?$/.exec(
      path,
    ))
  ) {
    const repo = model.repo(match[1]!);
    if (!repo) return [404, { message: "No such repository" }];
    model.syncGit(repo);
    if (method === "GET" && !match[2]) return [200, [...repo.pulls.values()]];
    if (method === "POST" && !match[2]) {
      const pull = model.openPull(repo, {
        head: String(body.head),
        base: body.base as string | undefined,
        title: String(body.title),
        body: body.body as string | undefined,
      });
      await events.pull(repo, pull, "opened");
      return [200, pull];
    }
    const pull = repo.pulls.get(Number(match[2]));
    if (!pull) return [404, { message: "No such pull request" }];
    if (method === "POST" && match[3] === "approve") {
      pull.approvals.push(
        typeof body.login === "string" ? body.login : "grace",
      );
      pull.updated = model.tick();
      await events.pull(repo, pull, "submitted");
      return [204];
    }
    if (method === "POST" && match[3] === "checks") {
      model.repos.get(repo.fullName)!.checks.set(pull.sha, [
        {
          name: typeof body.name === "string" ? body.name : "ci",
          state: body.state as Check["state"],
        },
      ]);
      await events.checks(repo, pull.sha, pull);
      return [204];
    }
  }
  return [404, { message: `No fake route ${method} ${path}` }];
}

const split = (path: string, prefix: RegExp) => {
  const match = prefix.exec(path);
  return match ? match.slice(1) : null;
};

// ------------------------------------------------------------------ GitHub

export async function startFakeGitHub(port: number) {
  const model = createModel();
  const site = FAKE_GITHUB_SITE;
  const repoView = (r: Repo) => ({
    id: r.id,
    full_name: r.fullName,
    default_branch: r.defaultBranch,
    html_url: `${site}/${r.fullName}`,
    clone_url: r.gitDir ? `file://${r.gitDir}` : `${site}/${r.fullName}.git`,
    visibility: "private",
    private: true,
    archived: false,
  });
  const pullView = (r: Repo, p: PullRequest) => ({
    id: p.id,
    number: p.number,
    title: p.title,
    body: p.body,
    state: p.state === "open" ? "open" : "closed",
    draft: p.draft,
    user: { login: p.author, type: "User" },
    head: { ref: p.head, sha: p.sha },
    base: { ref: p.base },
    requested_reviewers: p.reviewers.map((login) => ({ login })),
    requested_teams: [],
    mergeable: true,
    html_url: `${site}/${r.fullName}/pull/${p.number}`,
    merged_at: p.mergedAt?.toISOString() ?? null,
    merged_by: p.mergedAt ? { login: "lictory-bot" } : null,
    closed_at: p.state === "open" ? null : p.updated.toISOString(),
    created_at: p.created.toISOString(),
    updated_at: p.updated.toISOString(),
  });
  const headers = (event: string) => (body: string, secret: string) => ({
    "X-GitHub-Event": event,
    "X-GitHub-Delivery": randomUUID(),
    "X-Hub-Signature-256": hmac(secret, body),
  });
  const events = {
    pull: (repo: Repo, pull: PullRequest, action: string) =>
      model.deliver(
        headers(
          action === "submitted" ? "pull_request_review" : "pull_request",
        ),
        {
          action,
          repository: repoView(repo),
          pull_request: pullView(repo, pull),
        },
      ),
    checks: (repo: Repo, sha: string, pull: PullRequest) =>
      model.deliver(headers("check_suite"), {
        action: "completed",
        repository: repoView(repo),
        check_suite: {
          head_sha: sha,
          pull_requests: [{ number: pull.number }],
        },
      }),
  };
  return listen(port, async (request, response) => {
    const url = new URL(request.url, "http://fake");
    const path = url.pathname;
    const method = request.method;
    const body = json<Record<string, unknown>>(request.body) ?? {};
    if (process.env.E2E_VERBOSE) console.log(`[fake github] ${method} ${path}`);
    if (path.startsWith("/__fake/")) {
      const [status, result] = await control(model, method, path, body, events);
      return send(response, status, result);
    }
    if (request.headers.authorization !== `Bearer ${FAKE_GITHUB_TOKEN}`)
      return send(response, 401, { message: "Bad credentials" });
    if (!path.startsWith("/api/v3/"))
      return send(response, 404, { message: "Not Found" });
    const rest = path.slice("/api/v3".length);
    if (method === "GET" && rest === "/user")
      return send(response, 200, { login: "lictory-bot" });
    if (method === "GET" && rest === "/user/repos")
      return send(response, 200, [...model.repos.values()].map(repoView));
    let parts = split(rest, /^\/repositories\/(\d+)$/);
    if (method === "GET" && parts) {
      const repo = model.repo(parts[0]!);
      return repo
        ? send(response, 200, repoView(repo))
        : send(response, 404, { message: "Not Found" });
    }
    parts = split(rest, /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    if (!parts) return send(response, 404, { message: "Not Found" });
    const repo = model.repo(parts[0]!);
    if (!repo) return send(response, 404, { message: "Not Found" });
    model.syncGit(repo);
    const sub = parts[1] ?? "";
    if (method === "GET" && sub === "")
      return send(response, 200, repoView(repo));
    if (method === "GET" && sub === "/branches")
      return send(
        response,
        200,
        [...repo.branches].map(([name, sha]) => ({ name, commit: { sha } })),
      );
    let m: RegExpExecArray | null;
    if (method === "GET" && (m = /^\/git\/ref\/heads\/(.+)$/.exec(sub))) {
      const name = decodeURIComponent(m[1]!);
      const sha = repo.branches.get(name);
      return sha
        ? send(response, 200, { ref: `refs/heads/${name}`, object: { sha } })
        : send(response, 404, { message: "Not Found" });
    }
    if (method === "POST" && sub === "/git/refs") {
      const name = String(body.ref).replace(/^refs\/heads\//, "");
      if (repo.branches.has(name))
        return send(response, 422, { message: "Reference already exists" });
      repo.branches.set(name, String(body.sha));
      return send(response, 201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (method === "GET" && sub === "/pulls") {
      const head = url.searchParams.get("head")?.split(":")[1];
      const state = url.searchParams.get("state") ?? "open";
      return send(
        response,
        200,
        [...repo.pulls.values()]
          .filter(
            (p) =>
              (state === "all" ||
                (state === "open") === (p.state === "open")) &&
              (!head || p.head === head),
          )
          .map((p) => pullView(repo, p)),
      );
    }
    if (method === "POST" && sub === "/pulls") {
      if (!repo.branches.has(String(body.head)))
        return send(response, 422, {
          message: "Validation Failed",
          errors: [
            {
              message: `No commits between ${String(body.base)} and ${String(body.head)}`,
            },
          ],
        });
      const pull = model.openPull(repo, {
        head: String(body.head),
        base: String(body.base),
        title: String(body.title),
        body: typeof body.body === "string" ? body.body : "",
        author: "lictory-bot",
      });
      void events.pull(repo, pull, "opened");
      return send(response, 201, pullView(repo, pull));
    }
    if ((m = /^\/pulls\/(\d+)(\/[a-z_]+)?$/.exec(sub))) {
      const pull = repo.pulls.get(Number(m[1]));
      if (!pull) return send(response, 404, { message: "Not Found" });
      const tail = m[2] ?? "";
      if (method === "GET" && tail === "")
        return send(response, 200, pullView(repo, pull));
      if (method === "PATCH" && tail === "") {
        pull.state = body.state === "closed" ? "closed" : "open";
        pull.updated = model.tick();
        void events.pull(
          repo,
          pull,
          String(body.state === "closed" ? "closed" : "reopened"),
        );
        return send(response, 200, pullView(repo, pull));
      }
      if (method === "GET" && tail === "/reviews")
        return send(
          response,
          200,
          pull.approvals.map((login) => ({
            user: { login },
            state: "APPROVED",
          })),
        );
      if (method === "GET" && tail === "/files")
        return send(response, 200, [
          {
            filename: "src/refunds.ts",
            status: "modified",
            additions: 3,
            deletions: 1,
            patch:
              '@@ -1,3 +1,5 @@\n export function refund() {\n-  throw new Error("todo");\n+  const id = original.transactionId;\n+  return provider.refund(id);\n+  // PAY-1\n }',
          },
        ]);
      if (method === "POST" && tail === "/requested_reviewers") {
        pull.reviewers.push(...((body.reviewers as string[]) ?? []));
        pull.updated = model.tick();
        return send(response, 201, pullView(repo, pull));
      }
      if (method === "PUT" && tail === "/merge") {
        if (pull.state !== "open")
          return send(response, 405, {
            message: "Pull Request is not mergeable",
          });
        if (body.sha && body.sha !== pull.sha)
          return send(response, 409, {
            message:
              "Head branch was modified. Review and try the merge again.",
          });
        pull.state = "merged";
        pull.mergedAt = model.tick();
        pull.updated = pull.mergedAt;
        void events.pull(repo, pull, "closed");
        return send(response, 200, {
          sha: model.sha(),
          merged: true,
          message: "Pull Request successfully merged",
        });
      }
    }
    if ((m = /^\/commits\/([0-9a-f]+)\/(check-runs|status)$/.exec(sub))) {
      const checks = repo.checks.get(m[1]!) ?? [];
      if (m[2] === "status") return send(response, 200, { statuses: [] });
      return send(response, 200, {
        check_runs: checks.map((c, i) => ({
          id: i + 1,
          name: c.name,
          status: c.state === "pending" ? "in_progress" : "completed",
          conclusion: c.state === "pending" ? null : c.state,
          html_url: `${site}/${repo.fullName}/runs/${i + 1}`,
          started_at: new Date().toISOString(),
        })),
      });
    }
    if (method === "GET" && sub === "/issues") return send(response, 200, []);
    if (method === "GET" && sub === "/commits") return send(response, 200, []);
    if ((m = /^\/issues\/(\d+)\/comments$/.exec(sub))) {
      const pull = repo.pulls.get(Number(m[1]));
      if (!pull) return send(response, 404, { message: "Not Found" });
      if (method === "GET")
        return send(
          response,
          200,
          pull.comments.map((c) => ({
            id: c.id,
            body: c.body,
            html_url: null,
          })),
        );
      const comment = { id: model.next(), body: String(body.body) };
      pull.comments.push(comment);
      return send(response, 201, {
        ...comment,
        html_url: `${site}/${repo.fullName}/pull/${pull.number}#comment-${comment.id}`,
      });
    }
    return send(response, 404, { message: "Not Found" });
  });
}

// ------------------------------------------------------------------ GitLab

export async function startFakeGitLab(port: number) {
  const model = createModel();
  const site = FAKE_GITLAB_SITE;
  const projectView = (r: Repo) => ({
    id: r.id,
    path_with_namespace: r.fullName,
    default_branch: r.defaultBranch,
    web_url: `${site}/${r.fullName}`,
    http_url_to_repo: `${site}/${r.fullName}.git`,
    visibility: "private",
    archived: false,
  });
  const mrView = (r: Repo, p: PullRequest) => ({
    id: p.id,
    iid: p.number,
    title: p.title,
    description: p.body,
    state: p.state === "open" ? "opened" : p.state,
    draft: p.draft,
    author: { username: p.author, bot: false },
    source_branch: p.head,
    target_branch: p.base,
    sha: p.sha,
    reviewers: p.reviewers.map((username) => ({ username })),
    detailed_merge_status: "mergeable",
    web_url: `${site}/${r.fullName}/-/merge_requests/${p.number}`,
    merged_at: p.mergedAt?.toISOString() ?? null,
    merge_user: p.mergedAt ? { username: "lictory-bot" } : null,
    closed_at: null,
    created_at: p.created.toISOString(),
    updated_at: p.updated.toISOString(),
  });
  const headers = (event: string) => (_body: string, secret: string) => ({
    "X-Gitlab-Event": event,
    "X-Gitlab-Token": secret,
    "X-Gitlab-Event-UUID": randomUUID(),
  });
  const events = {
    pull: (repo: Repo, pull: PullRequest) =>
      model.deliver(headers("Merge Request Hook"), {
        object_kind: "merge_request",
        project: projectView(repo),
        object_attributes: { iid: pull.number },
      }),
    checks: (repo: Repo, sha: string, pull: PullRequest) =>
      model.deliver(headers("Pipeline Hook"), {
        object_kind: "pipeline",
        project: projectView(repo),
        object_attributes: { sha },
        merge_request: { iid: pull.number },
      }),
  };
  return listen(port, async (request, response) => {
    const url = new URL(request.url, "http://fake");
    const path = url.pathname;
    const method = request.method;
    const body = json<Record<string, unknown>>(request.body) ?? {};
    if (path.startsWith("/__fake/")) {
      const [status, result] = await control(model, method, path, body, events);
      return send(response, status, result);
    }
    if (request.headers["private-token"] !== FAKE_GITLAB_TOKEN)
      return send(response, 401, { message: "401 Unauthorized" });
    const rest = path.replace(/^\/api\/v4/, "");
    if (method === "GET" && rest === "/user")
      return send(response, 200, { username: "lictory-bot" });
    if (method === "GET" && rest === "/projects")
      return send(response, 200, [...model.repos.values()].map(projectView));
    const parts = split(rest, /^\/projects\/([^/]+)(\/.*)?$/);
    const repo = parts && model.repo(parts[0]!);
    if (!repo) return send(response, 404, { message: "404 Project Not Found" });
    const sub = parts[1] ?? "";
    let m: RegExpExecArray | null;
    if (method === "GET" && sub === "")
      return send(response, 200, projectView(repo));
    if (method === "GET" && sub === "/repository/branches")
      return send(
        response,
        200,
        [...repo.branches].map(([name, id]) => ({ name, commit: { id } })),
      );
    if ((m = /^\/repository\/branches\/(.+)$/.exec(sub)) && method === "GET") {
      const sha = repo.branches.get(decodeURIComponent(m[1]!));
      return sha
        ? send(response, 200, {
            name: decodeURIComponent(m[1]!),
            commit: { id: sha },
          })
        : send(response, 404, { message: "404 Branch Not Found" });
    }
    if (method === "POST" && sub === "/repository/branches") {
      const name = url.searchParams.get("branch")!;
      if (repo.branches.has(name))
        return send(response, 400, { message: "Branch already exists" });
      repo.branches.set(name, url.searchParams.get("ref")!);
      return send(response, 201, {
        name,
        commit: { id: repo.branches.get(name) },
      });
    }
    if (method === "GET" && sub === "/merge_requests") {
      const state = url.searchParams.get("state");
      const source = url.searchParams.get("source_branch");
      return send(
        response,
        200,
        [...repo.pulls.values()]
          .filter(
            (p) =>
              (state !== "opened" || p.state === "open") &&
              (!source || p.head === source),
          )
          .map((p) => mrView(repo, p)),
      );
    }
    if (method === "POST" && sub === "/merge_requests") {
      const pull = model.openPull(repo, {
        head: String(body.source_branch),
        base: String(body.target_branch),
        title: String(body.title),
        body: typeof body.description === "string" ? body.description : "",
        author: "lictory-bot",
      });
      void events.pull(repo, pull);
      return send(response, 201, mrView(repo, pull));
    }
    if ((m = /^\/merge_requests\/(\d+)(\/[a-z_]+)?$/.exec(sub))) {
      const pull = repo.pulls.get(Number(m[1]));
      if (!pull) return send(response, 404, { message: "404 Not found" });
      const tail = m[2] ?? "";
      if (method === "GET" && tail === "")
        return send(response, 200, mrView(repo, pull));
      if (method === "PUT" && tail === "") {
        if (body.state_event)
          pull.state = body.state_event === "close" ? "closed" : "open";
        pull.updated = model.tick();
        void events.pull(repo, pull);
        return send(response, 200, mrView(repo, pull));
      }
      if (method === "GET" && tail === "/approvals")
        return send(response, 200, {
          approvals_left: pull.approvals.length ? 0 : 1,
          approved_by: pull.approvals.map((username) => ({
            user: { username },
          })),
        });
      if (method === "GET" && tail === "/reviewers")
        return send(response, 200, []);
      if (method === "GET" && tail === "/diffs")
        return send(response, 200, [
          {
            old_path: "src/refunds.ts",
            new_path: "src/refunds.ts",
            diff: "@@ -1 +1 @@\n-old\n+new",
          },
        ]);
      if (tail === "/notes") {
        if (method === "GET") return send(response, 200, pull.comments);
        const note = { id: model.next(), body: String(body.body) };
        pull.comments.push(note);
        return send(response, 201, note);
      }
      if (method === "PUT" && tail === "/merge") {
        if (body.sha !== pull.sha)
          return send(response, 409, {
            message: "SHA does not match HEAD of source branch",
          });
        pull.state = "merged";
        pull.mergedAt = model.tick();
        pull.updated = pull.mergedAt;
        void events.pull(repo, pull);
        return send(response, 200, {
          ...mrView(repo, pull),
          merge_commit_sha: model.sha(),
        });
      }
    }
    if ((m = /^\/repository\/commits\/([0-9a-f]+)\/statuses$/.exec(sub)))
      return send(
        response,
        200,
        (repo.checks.get(m[1]!) ?? []).map((c, i) => ({
          id: i + 1,
          name: c.name,
          status:
            c.state === "failure"
              ? "failed"
              : c.state === "pending"
                ? "running"
                : "success",
          target_url: null,
        })),
      );
    if (
      method === "GET" &&
      (sub === "/issues" || sub === "/repository/commits")
    )
      return send(response, 200, []);
    return send(response, 404, { message: "404 Not Found" });
  });
}

// --------------------------------------------------------------- Bitbucket

export async function startFakeBitbucket(port: number) {
  const model = createModel();
  const web = "https://bitbucket.org";
  const repoView = (r: Repo) => ({
    uuid: r.uuid,
    full_name: r.fullName,
    mainbranch: { name: r.defaultBranch },
    is_private: true,
    links: {
      html: { href: `${web}/${r.fullName}` },
      clone: [
        {
          name: "https",
          href: `https://lictory-bot@bitbucket.org/${r.fullName}.git`,
        },
      ],
    },
  });
  const prView = (r: Repo, p: PullRequest) => ({
    id: p.number,
    title: p.title,
    description: p.body,
    state:
      p.state === "open"
        ? "OPEN"
        : p.state === "merged"
          ? "MERGED"
          : "DECLINED",
    draft: p.draft,
    author: { nickname: p.author, type: "user" },
    source: { branch: { name: p.head }, commit: { hash: p.sha.slice(0, 12) } },
    destination: { branch: { name: p.base } },
    reviewers: p.reviewers.map((nickname) => ({ nickname })),
    participants: p.approvals.map((nickname) => ({
      user: { nickname },
      approved: true,
      state: "approved",
    })),
    links: { html: { href: `${web}/${r.fullName}/pull-requests/${p.number}` } },
    created_on: p.created.toISOString(),
    updated_on: p.updated.toISOString(),
  });
  const headers = (event: string) => (body: string, secret: string) => ({
    "X-Event-Key": event,
    "X-Request-UUID": randomUUID(),
    "X-Hub-Signature": hmac(secret, body),
  });
  const events = {
    pull: (repo: Repo, pull: PullRequest) =>
      model.deliver(headers("pullrequest:updated"), {
        repository: repoView(repo),
        pullrequest: prView(repo, pull),
      }),
    checks: (repo: Repo, sha: string) =>
      model.deliver(headers("repo:commit_status_updated"), {
        repository: repoView(repo),
        commit_status: { commit: { hash: sha } },
      }),
  };
  const page = (values: unknown[]) => ({ values, pagelen: values.length });
  return listen(port, async (request, response) => {
    const url = new URL(request.url, "http://fake");
    const path = url.pathname;
    const method = request.method;
    const body = json<Record<string, unknown>>(request.body) ?? {};
    if (path.startsWith("/__fake/")) {
      const [status, result] = await control(model, method, path, body, events);
      return send(response, status, result);
    }
    if (request.headers.authorization !== `Bearer ${FAKE_BITBUCKET_TOKEN}`)
      return send(response, 401, {
        type: "error",
        error: { message: "Unauthorized" },
      });
    const rest = path.replace(/^\/2\.0/, "");
    if (method === "GET" && rest === "/user")
      return send(response, 200, { nickname: "lictory-bot" });
    if (method === "GET" && rest === "/repositories")
      return send(response, 200, page([...model.repos.values()].map(repoView)));
    const parts = split(rest, /^\/repositories\/([^/]+\/[^/]+)(\/.*)?$/);
    const repo = parts && model.repo(parts[0]!);
    if (!repo)
      return send(response, 404, {
        type: "error",
        error: { message: "Repository not found" },
      });
    const sub = parts[1] ?? "";
    let m: RegExpExecArray | null;
    if (method === "GET" && sub === "")
      return send(response, 200, repoView(repo));
    if (method === "GET" && sub === "/refs/branches")
      return send(
        response,
        200,
        page(
          [...repo.branches].map(([name, hash]) => ({
            name,
            target: { hash },
          })),
        ),
      );
    if ((m = /^\/refs\/branches\/(.+)$/.exec(sub)) && method === "GET") {
      const hash = repo.branches.get(decodeURIComponent(m[1]!));
      return hash
        ? send(response, 200, {
            name: decodeURIComponent(m[1]!),
            target: { hash },
          })
        : send(response, 404, {
            type: "error",
            error: { message: "Branch not found" },
          });
    }
    if (method === "POST" && sub === "/refs/branches") {
      const name = String(body.name);
      if (repo.branches.has(name))
        return send(response, 400, {
          type: "error",
          error: { message: "Branch already exists" },
        });
      repo.branches.set(name, String((body.target as { hash: string }).hash));
      return send(response, 201, { name, target: body.target });
    }
    if (method === "GET" && sub === "/pullrequests") {
      const q = url.searchParams.get("q") ?? "";
      const source = /source\.branch\.name = "([^"]+)"/.exec(q)?.[1];
      return send(
        response,
        200,
        page(
          [...repo.pulls.values()]
            .filter((p) => !source || (p.head === source && p.state === "open"))
            .map((p) => prView(repo, p)),
        ),
      );
    }
    if (method === "POST" && sub === "/pullrequests") {
      const pull = model.openPull(repo, {
        head: String((body.source as { branch: { name: string } }).branch.name),
        base: String(
          (body.destination as { branch: { name: string } }).branch.name,
        ),
        title: String(body.title),
        body: typeof body.description === "string" ? body.description : "",
        author: "lictory-bot",
      });
      void events.pull(repo, pull);
      return send(response, 201, prView(repo, pull));
    }
    if ((m = /^\/pullrequests\/(\d+)(\/[a-z]+)?$/.exec(sub))) {
      const pull = repo.pulls.get(Number(m[1]));
      if (!pull)
        return send(response, 404, {
          type: "error",
          error: { message: "Not found" },
        });
      const tail = m[2] ?? "";
      if (method === "GET" && tail === "")
        return send(response, 200, prView(repo, pull));
      if (method === "PUT" && tail === "")
        return send(response, 200, prView(repo, pull));
      if (method === "GET" && tail === "/diffstat")
        return send(
          response,
          200,
          page([
            {
              status: "modified",
              new: { path: "src/refunds.ts" },
              lines_added: 1,
              lines_removed: 1,
            },
          ]),
        );
      if (method === "GET" && tail === "/diff") {
        response
          .writeHead(200, { "Content-Type": "text/plain" })
          .end(
            "diff --git a/src/refunds.ts b/src/refunds.ts\n@@ -1 +1 @@\n-old\n+new\n",
          );
        return;
      }
      if (tail === "/comments") {
        if (method === "GET")
          return send(
            response,
            200,
            page(
              pull.comments.map((c) => ({
                id: c.id,
                content: { raw: c.body },
              })),
            ),
          );
        const comment = {
          id: model.next(),
          body: String((body.content as { raw: string }).raw),
        };
        pull.comments.push(comment);
        return send(response, 201, {
          id: comment.id,
          content: { raw: comment.body },
        });
      }
      if (method === "POST" && tail === "/merge") {
        pull.state = "merged";
        pull.mergedAt = model.tick();
        pull.updated = pull.mergedAt;
        void events.pull(repo, pull);
        return send(response, 200, {
          ...prView(repo, pull),
          merge_commit: { hash: model.sha() },
        });
      }
      if (method === "POST" && tail === "/decline") {
        pull.state = "closed";
        pull.updated = model.tick();
        void events.pull(repo, pull);
        return send(response, 200, prView(repo, pull));
      }
    }
    if ((m = /^\/commit\/([0-9a-f]+)\/statuses$/.exec(sub))) {
      const checks =
        [...repo.checks].find(
          ([sha]) =>
            sha.startsWith(m![1]!) || m![1]!.startsWith(sha.slice(0, 12)),
        )?.[1] ?? [];
      return send(
        response,
        200,
        page(
          checks.map((c) => ({
            name: c.name,
            state:
              c.state === "success"
                ? "SUCCESSFUL"
                : c.state === "pending"
                  ? "INPROGRESS"
                  : "FAILED",
            url: null,
          })),
        ),
      );
    }
    if (method === "GET" && (sub === "/issues" || sub.startsWith("/commits")))
      return send(response, 200, page([]));
    return send(response, 404, {
      type: "error",
      error: { message: "Not found" },
    });
  });
}
