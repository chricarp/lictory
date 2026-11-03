import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { type GitHub } from "@lictory/core/release/github";
import { touchesPlatform } from "@lictory/core/release/paths";
import {
  baselineSchema,
  changeSchema,
  shaSchema,
  type Baseline,
  type Change,
} from "@lictory/core/release/model";
import {
  compareStable,
  conventionalTitle,
  stableParts,
} from "@lictory/core/release/version";

const execute = promisify(execFile);
export async function git(root: string, ...args: string[]): Promise<string> {
  return (
    await execute("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 })
  ).stdout.trim();
}
export async function ancestor(
  root: string,
  base: string,
  head: string,
): Promise<boolean> {
  shaSchema.parse(base);
  shaSchema.parse(head);
  try {
    await git(root, "merge-base", "--is-ancestor", base, head);
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 1) return false;
    throw error;
  }
}

/**
 * Files each first-parent commit of `base..head` changed (a merge commit
 * against its first parent, so it carries its whole pull request).
 */
export async function changedFiles(
  root: string,
  base: string,
  head: string,
): Promise<Map<string, string[]>> {
  shaSchema.parse(base);
  shaSchema.parse(head);
  const log = await git(
    root,
    "log",
    "--first-parent",
    "--diff-merges=first-parent",
    "--name-only",
    "--format=%x00%H",
    `${base}..${head}`,
  );
  const files = new Map<string, string[]>();
  for (const entry of log.split("\0").filter(Boolean)) {
    const [commit, ...paths] = entry.trim().split("\n");
    files.set(commit!, paths.filter(Boolean));
  }
  return files;
}

/** Every file changed in `base..head`. */
export async function changedPaths(
  root: string,
  base: string,
  head: string,
): Promise<string[]> {
  shaSchema.parse(base);
  shaSchema.parse(head);
  const diff = await git(root, "diff", "--name-only", base, head);
  return diff ? diff.split("\n") : [];
}

export async function latestBaseline(
  github: GitHub,
  bootstrap: Baseline,
): Promise<Baseline> {
  const stable = (await github.releases()).filter(
    (release) =>
      !release.draft &&
      !release.prerelease &&
      /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(
        release.tag_name,
      ),
  );
  stable.sort((a, b) =>
    compareStable(b.tag_name.slice(1), a.tag_name.slice(1)),
  );
  if (!stable.length) {
    stableParts(bootstrap.version);
    return baselineSchema.parse(bootstrap);
  }
  const latest = z
    .object({ tag_name: z.string() })
    .parse(await github.request("/releases/latest"));
  if (latest.tag_name !== stable[0]!.tag_name)
    throw new Error(
      "Latest stable release does not match the highest published version; repair release history before continuing.",
    );
  const tag = latest.tag_name;
  const sha = await github.tagSha(tag);
  if (!sha) throw new Error("Published stable release has no Git tag.");
  return { tag, sha, version: tag.slice(1) };
}

const pullSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  merged_at: z.string().nullable(),
  merge_commit_sha: z.string().nullable(),
  base: z.object({ ref: z.string() }),
  user: z.object({ login: z.string() }),
  labels: z.array(z.object({ name: z.string() })),
});

export function reviewedChange(pull: z.infer<typeof pullSchema>): Change {
  const title = conventionalTitle(pull.title);
  const stableApi = pull.labels.some(
    (label) => label.name === "release:stable-api",
  );
  if (stableApi && !title.breaking)
    throw new Error("release:stable-api requires a breaking PR title.");
  if (!pull.merged_at || !pull.merge_commit_sha)
    throw new Error("Release changes must come from merged PRs.");
  const body = pull.body ?? "";
  const directCommits = [
    ...body.matchAll(/^Release-Commit: ([a-f0-9]{40})\s*$/gm),
  ].map((match) => match[1]!);
  if (
    directCommits.length &&
    !pull.labels.some((label) => label.name === "release:direct-push")
  )
    throw new Error(
      "Direct-push recovery requires the release:direct-push label on its reviewed PR.",
    );
  const notes =
    /^## Release notes\s*\n([\s\S]*?)(?=\n## |$)/m.exec(body)?.[1]?.trim() ??
    "";
  return changeSchema.parse({
    number: pull.number,
    title: pull.title,
    notes,
    mergedAt: pull.merged_at,
    mergeSha: pull.merge_commit_sha,
    author: pull.user.login,
    directCommits,
    stableApi,
  });
}

export function accountForCommits(
  commits: string[],
  associations: Map<string, number[]>,
  changes: Change[],
): void {
  const included = new Set(changes.map((change) => change.number));
  const acknowledged = new Set(
    changes.flatMap((change) => change.directCommits),
  );
  if ([...acknowledged].some((sha) => !commits.includes(sha)))
    throw new Error(
      "Recovery PR acknowledges a commit outside this release range.",
    );
  const unknown = commits.filter(
    (sha) =>
      !(associations.get(sha) ?? []).some((number) => included.has(number)) &&
      !acknowledged.has(sha),
  );
  if (unknown.length)
    throw new Error(
      `Unattributed direct commits block release: ${unknown.join(", ")}. Merge a reviewed Conventional Commit PR with release:direct-push and Release-Commit footers to account for them.`,
    );
}

export async function collectChanges(
  github: GitHub,
  root: string,
  baseline: Baseline,
  sha: string,
): Promise<Change[]> {
  if (!(await ancestor(root, baseline.sha, sha)))
    throw new Error(
      "Candidate does not contain the latest stable commit. Merge released hotfix history into main with a merge commit before releasing.",
    );
  const range = await git(
    root,
    "rev-list",
    "--reverse",
    "--topo-order",
    `${baseline.sha}..${sha}`,
  );
  const commits = range ? range.split("\n") : [];
  const associations = new Map<string, number[]>();
  const pulls = new Map<number, z.infer<typeof pullSchema>>();
  // Bounded batches avoid an unbounded API fan-out for a large release range.
  for (let start = 0; start < commits.length; start += 6) {
    await Promise.all(
      commits.slice(start, start + 6).map(async (commit) => {
        const associated = await github.list(
          `/commits/${commit}/pulls`,
          pullSchema,
        );
        associations.set(
          commit,
          associated.map((pull) => pull.number),
        );
        for (const pull of associated) {
          // Stacked PRs can retain a feature branch as their base after reaching
          // main. Their merge commit's presence in this range proves inclusion.
          if (
            pull.merged_at &&
            pull.merge_commit_sha &&
            commits.includes(pull.merge_commit_sha)
          )
            pulls.set(pull.number, pull);
        }
      }),
    );
  }
  const changes = [...pulls.values()]
    .map(reviewedChange)
    .sort(
      (a, b) => a.mergedAt.localeCompare(b.mergedAt) || a.number - b.number,
    );
  accountForCommits(commits, associations, changes);
  // Pull requests that only changed the websites, maintainer documentation or
  // CI are not platform changes: no version bump and no platform release note.
  const files = await changedFiles(root, baseline.sha, sha);
  const pullFiles = new Map<number, string[]>();
  for (const [commit, numbers] of associations)
    for (const number of numbers)
      pullFiles.set(number, [
        ...(pullFiles.get(number) ?? []),
        ...(files.get(commit) ?? []),
      ]);
  return changes.filter((change) =>
    touchesPlatform(pullFiles.get(change.number) ?? []),
  );
}
