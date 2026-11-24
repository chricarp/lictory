import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceResponse } from "@lictory/core/factory/protocol";
import { run } from "@lictory/runner/process";

// Each session works in its own git worktree of a shared, bare cache of the
// repository. Credentials brokered for a session are passed to git as an
// HTTP header for one command at a time; they are never written to a git
// configuration, a remote URL or the disk.

type Repository = NonNullable<WorkspaceResponse["repository"]>;

export type Workspace = {
  path: string;
  // Where session files go (ignored by git).
  scratch: string;
  repository: Repository | null;
  // The commit the session started from.
  baseCommit: string | null;
  cache: string | null;
};

const locks = new Map<string, Promise<unknown>>();
// Serializes work on one cache (fetches, worktree changes).
async function locked<T>(key: string, work: () => Promise<T>) {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

function authArgs(repository: Repository) {
  if (!repository.auth) return [];
  const basic = Buffer.from(
    `${repository.auth.username}:${repository.auth.password}`,
  ).toString("base64");
  return ["-c", `http.extraHeader=Authorization: Basic ${basic}`];
}

async function git(args: string[], cwd?: string, timeoutMs = 10 * 60_000) {
  const result = await run("git", args, {
    cwd,
    timeoutMs,
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.code !== 0)
    throw new Error(
      `git ${args
        .filter((a) => !a.startsWith("http.extraHeader"))
        .slice(0, 3)
        .join(
          " ",
        )} failed: ${(result.stderr || result.stdout).trim().slice(0, 1000)}`,
    );
  return result.stdout.trim();
}

// Hides credentials from error messages.
const redact = (message: string, repository: Repository | null) =>
  repository?.auth
    ? message.replaceAll(repository.auth.password, "***")
    : message;

async function ignoreScratch(gitDirectory: string) {
  const exclude = join(gitDirectory, "info", "exclude");
  await mkdir(join(gitDirectory, "info"), { recursive: true });
  const current = await readFile(exclude, "utf8").catch(() => "");
  if (!current.split("\n").includes("/.lictory/"))
    await appendFile(
      exclude,
      `${current.endsWith("\n") || !current ? "" : "\n"}/.lictory/\n`,
    );
}

async function defaultBranch(repository: Repository) {
  const output = await git([
    ...authArgs(repository),
    "ls-remote",
    "--symref",
    repository.url,
    "HEAD",
  ]);
  return /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(output)?.[1] ?? "main";
}

export async function prepareWorkspace(
  workDir: string,
  sessionId: string,
  repository: Repository | null,
): Promise<Workspace> {
  const path = join(workDir, "sessions", sessionId);
  await rm(path, { recursive: true, force: true });
  if (!repository) {
    // No repository: an empty scratch repository, so harnesses that expect
    // git still work.
    await mkdir(path, { recursive: true });
    await git(["init", "--quiet", "--initial-branch", "main"], path);
    await ignoreScratch(join(path, ".git"));
    const scratch = join(path, ".lictory");
    await mkdir(scratch, { recursive: true, mode: 0o700 });
    return { path, scratch, repository: null, baseCommit: null, cache: null };
  }
  const cache = join(
    workDir,
    "repositories",
    `${createHash("sha256").update(repository.url).digest("hex").slice(0, 24)}.git`,
  );
  try {
    return await locked(cache, async () => {
      await mkdir(cache, { recursive: true });
      await git(["init", "--quiet", "--bare"], cache).catch(() => undefined);
      await git(
        [
          ...authArgs(repository),
          "fetch",
          "--quiet",
          "--prune",
          repository.url,
          "+refs/heads/*:refs/remotes/origin/*",
        ],
        cache,
      );
      const base = repository.baseBranch ?? (await defaultBranch(repository));
      // A retried session continues from its branch if an earlier attempt
      // pushed it.
      const existing = await git(
        [
          "rev-parse",
          "--verify",
          "--quiet",
          `refs/remotes/origin/${repository.branch}`,
        ],
        cache,
      ).catch(() => "");
      const start = existing
        ? `refs/remotes/origin/${repository.branch}`
        : `refs/remotes/origin/${base}`;
      await git(["worktree", "prune"], cache);
      await git(
        ["worktree", "add", "--force", "-B", repository.branch, path, start],
        cache,
      );
      await ignoreScratch(cache);
      const baseCommit = await git(["rev-parse", "HEAD"], path);
      const scratch = join(path, ".lictory");
      await mkdir(scratch, { recursive: true, mode: 0o700 });
      return { path, scratch, repository, baseCommit, cache };
    });
  } catch (error) {
    throw new Error(
      redact(
        error instanceof Error ? error.message : String(error),
        repository,
      ),
    );
  }
}

export type Delivered = {
  // The branch that was pushed, when the session changed something.
  branch: string | null;
  commits: number;
  files: { path: string; kind: "add" | "modify" | "delete" | "rename" }[];
};

const kinds: Record<string, Delivered["files"][number]["kind"]> = {
  A: "add",
  M: "modify",
  D: "delete",
  R: "rename",
};

// Commits what the agent left uncommitted and pushes the session's branch.
export async function deliverWorkspace(
  workspace: Workspace,
  author: { name: string; email: string },
  message: string,
  fresh?: Repository | null,
): Promise<Delivered> {
  const { path } = workspace;
  const identity = [
    "-c",
    `user.name=${author.name}`,
    "-c",
    `user.email=${author.email}`,
  ];
  await git(["add", "--all"], path);
  const staged = await git(["diff", "--cached", "--name-only"], path);
  if (staged)
    await git([...identity, "commit", "--quiet", "--message", message], path);
  if (!workspace.repository || !workspace.baseCommit)
    return { branch: null, commits: 0, files: [] };
  const commits = Number(
    await git(["rev-list", "--count", `${workspace.baseCommit}..HEAD`], path),
  );
  const changed = await git(
    ["diff", "--name-status", `${workspace.baseCommit}..HEAD`],
    path,
  );
  const files = changed
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status = "M", ...rest] = line.split("\t");
      return { path: rest.at(-1) ?? "", kind: kinds[status[0]!] ?? "modify" };
    });
  if (!commits) return { branch: null, commits, files };
  const repository = fresh ?? workspace.repository;
  try {
    await git(
      [
        ...authArgs(repository),
        "push",
        "--quiet",
        repository.url,
        `HEAD:refs/heads/${workspace.repository.branch}`,
      ],
      path,
    );
  } catch (error) {
    throw new Error(
      redact(
        error instanceof Error ? error.message : String(error),
        repository,
      ),
    );
  }
  return { branch: workspace.repository.branch, commits, files };
}

export async function removeWorkspace(workspace: Workspace) {
  if (workspace.cache)
    await locked(workspace.cache, async () => {
      await run("git", ["worktree", "remove", "--force", workspace.path], {
        cwd: workspace.cache!,
      });
      await run("git", ["worktree", "prune"], { cwd: workspace.cache! });
    });
  await rm(workspace.path, { recursive: true, force: true });
}
