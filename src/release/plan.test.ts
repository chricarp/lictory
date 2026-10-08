import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { GitHubFixture, change, nightly, stable } from "./fixtures.test-helper";
import {
  accountForCommits,
  collectChanges,
  git,
  latestBaseline,
  reviewedChange,
} from "./repository";
import { planNightly, planProduction, verifiedNightly } from "./plan";
import { nightlyVersion, predictedStable } from "./version";
import type { Manifest } from "./model";

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "lictory-release-graph-"));
  await git(root, "init", "--quiet", "--initial-branch=main");
  await git(root, "config", "user.name", "Release tests");
  await git(root, "config", "user.email", "release@example.test");
  await git(
    root,
    "commit",
    "--allow-empty",
    "-m",
    "Not a Conventional Commit baseline",
  );
  const base = await git(root, "rev-parse", "HEAD");
  await git(
    root,
    "commit",
    "--allow-empty",
    "-m",
    "Git subject deliberately differs from its feature PR",
  );
  const feature = await git(root, "rev-parse", "HEAD");
  await git(
    root,
    "commit",
    "--allow-empty",
    "-m",
    "Git subject deliberately differs from its fix PR",
  );
  const fix = await git(root, "rev-parse", "HEAD");
  await git(root, "update-ref", "refs/remotes/origin/main", fix);
  const baseline = { version: "1.4.2", tag: null, sha: base };
  const fixture = new GitHubFixture();
  const changes = [
    change("feat(editor): edit offline", feature, 1),
    change("fix(editor): recover drafts", fix, 2),
  ];
  fixture.associate(feature, [changes[0]!]);
  fixture.associate(fix, [changes[1]!]);
  const candidate = (
    sha = feature,
    number = 142,
    included = [changes[0]!],
  ): Manifest => ({ ...nightly(sha, number, included), baseline });
  return { root, base, feature, fix, baseline, fixture, changes, candidate };
}

void test("stable selection pins an older verified nightly, excluding newer main PRs", async () => {
  const repo = await repository();
  try {
    const older = repo.candidate();
    const newer = repo.candidate(repo.fix, 143, repo.changes);
    repo.fixture.add(older);
    repo.fixture.add(newer);
    const selected = await planProduction(
      repo.fixture.github,
      repo.root,
      older.tag,
      "night-project",
      repo.baseline,
    );
    assert.equal(selected.sha, repo.feature);
    assert.equal(selected.version, "1.5.0");
    assert.deepEqual(
      selected.changes.map((value) => value.number),
      [1],
    );
    assert.equal(
      (
        await planProduction(
          repo.fixture.github,
          repo.root,
          undefined,
          "night-project",
          repo.baseline,
        )
      ).sha,
      repo.fix,
    );
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

void test("nightly calculation uses actual PRs and the stable baseline, not commit subjects or prior nightlies", async () => {
  const repo = await repository();
  try {
    for (const candidate of [
      repo.candidate(),
      repo.candidate(repo.fix, 143, repo.changes),
    ]) {
      repo.fixture.responses.set(`/actions/runs/${candidate.run.id}`, {
        id: candidate.run.id,
        run_number: candidate.run.number,
        head_sha: candidate.sha,
        head_branch: "main",
        event: "push",
        path: ".github/workflows/nightly.yml",
        created_at: candidate.run.createdAt,
        conclusion: null,
      });
      const plan = await planNightly(
        repo.fixture.github,
        repo.root,
        candidate.sha,
        "main",
        candidate.run.id,
        repo.baseline,
      );
      assert.equal(plan.stableVersion, "1.5.0");
      assert.equal(plan.version, candidate.version);
      assert.equal(plan.changes.length, candidate.changes.length);
      repo.fixture.add(plan);
    }
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

void test("a nightly requires a matching tag, successful workflow, and isolated deployment", async () => {
  const fixture = new GitHubFixture();
  const candidate = nightly();
  const release = fixture.add(candidate);
  await verifiedNightly(fixture.github, release, "night-project");
  await assert.rejects(
    verifiedNightly(fixture.github, release, "prod-project"),
    /deployment/,
  );
  const run = fixture.responses.get(
    `/actions/runs/${candidate.run.id}`,
  ) as Record<string, unknown>;
  run.conclusion = "failure";
  await assert.rejects(
    verifiedNightly(fixture.github, release, "night-project"),
    /workflow run/,
  );
  run.conclusion = "success";
  run.head_sha = "c".repeat(40);
  await assert.rejects(
    verifiedNightly(fixture.github, release, "night-project"),
    /workflow run/,
  );
  run.head_sha = candidate.sha;
  fixture.tags.set(candidate.tag, "c".repeat(40));
  await assert.rejects(
    verifiedNightly(fixture.github, release, "night-project"),
    /tag/,
  );
});

void test("stable publication retry retains the exact version/source and old nightlies become stale", async () => {
  const repo = await repository();
  try {
    const older = repo.candidate();
    const newer = repo.candidate(repo.fix, 143, repo.changes);
    repo.fixture.add(older);
    repo.fixture.add(newer);
    const published = stable(older);
    repo.fixture.add(published);
    const retry = await planProduction(
      repo.fixture.github,
      repo.root,
      older.tag,
      "night-project",
      repo.baseline,
    );
    assert.equal(retry.sha, older.sha);
    assert.equal(retry.tag, published.tag);
    await assert.rejects(
      planProduction(
        repo.fixture.github,
        repo.root,
        newer.tag,
        "night-project",
        repo.baseline,
      ),
      /duplicate|downgrade|stale/,
    );
    const fresh = {
      ...newer,
      baseline: { version: "1.5.0", tag: "v1.5.0", sha: repo.feature },
      stableVersion: "1.5.1",
      version: nightlyVersion("1.5.1", newer.run.createdAt, 144),
      run: { ...newer.run, id: 1144, number: 144 },
      changes: [repo.changes[1]!],
    };
    fresh.tag = `v${fresh.version}`;
    repo.fixture.add(fresh);
    assert.equal(
      (
        await planProduction(
          repo.fixture.github,
          repo.root,
          fresh.tag,
          "night-project",
          repo.baseline,
        )
      ).version,
      "1.5.1",
    );
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

void test("edited merged PR metadata and stable tag collisions block promotion", async () => {
  const repo = await repository();
  try {
    const candidate = repo.candidate();
    repo.fixture.add(candidate);
    repo.fixture.associate(repo.feature, [
      change("feat!: change API contract", repo.feature),
    ]);
    await assert.rejects(
      planProduction(
        repo.fixture.github,
        repo.root,
        candidate.tag,
        "night-project",
        repo.baseline,
      ),
      /metadata|version/,
    );
    repo.fixture.associate(repo.feature, [repo.changes[0]!]);
    repo.fixture.tags.set("v1.5.0", repo.fix);
    await assert.rejects(
      planProduction(
        repo.fixture.github,
        repo.root,
        candidate.tag,
        "night-project",
        repo.baseline,
      ),
      /reserved/,
    );
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

void test("rebase merges count their PR once across all rewritten commits", async () => {
  const repo = await repository();
  try {
    const rebased = change("fix(editor): fix two related failures", repo.fix);
    repo.fixture.associate(repo.feature, [rebased]);
    repo.fixture.associate(repo.fix, [rebased]);
    const changes = await collectChanges(
      repo.fixture.github,
      repo.root,
      repo.baseline,
      repo.fix,
    );
    assert.equal(changes.length, 1);
    assert.equal(
      predictedStable(
        repo.baseline.version,
        changes.map((value) => value.title),
      ).version,
      "1.4.3",
    );
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

void test("direct pushes fail closed until a reviewed recovery PR explicitly accounts for exact SHAs", () => {
  const sha = "d".repeat(40);
  const changes = [change()];
  assert.throws(
    () => accountForCommits([sha], new Map(), changes),
    /direct commits/,
  );
  const pull = {
    number: 1,
    title: "fix(recovery): account for an emergency repair",
    body: `Release-Commit: ${sha}`,
    merged_at: changes[0]!.mergedAt,
    merge_commit_sha: changes[0]!.mergeSha,
    base: { ref: "main" },
    user: { login: "alex" },
    labels: [] as { name: string }[],
  };
  assert.throws(() => reviewedChange(pull), /label/);
  const reviewed = reviewedChange({
    ...pull,
    labels: [{ name: "release:direct-push" }],
  });
  accountForCommits(
    [sha, reviewed.mergeSha],
    new Map([[reviewed.mergeSha, [1]]]),
    [reviewed],
  );
  assert.throws(
    () => accountForCommits([reviewed.mergeSha], new Map(), [reviewed]),
    /outside/,
  );
});

void test("maintenance-only candidates cannot silently republish an existing stable version", async () => {
  const repo = await repository();
  try {
    const released = repo.candidate();
    repo.fixture.add(released);
    repo.fixture.add(stable(released));
    const maintenance = {
      ...repo.candidate(repo.feature, 144, []),
      baseline: { version: "1.5.0", tag: "v1.5.0", sha: repo.feature },
    };
    repo.fixture.add(maintenance);
    await assert.rejects(
      planProduction(
        repo.fixture.github,
        repo.root,
        maintenance.tag,
        "night-project",
        repo.baseline,
      ),
      /release-worthy/,
    );
    await assert.rejects(
      planProduction(
        repo.fixture.github,
        repo.root,
        undefined,
        "night-project",
        repo.baseline,
      ),
      /No verified nightly/,
    );
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

void test("an entire nightly retry retains its original baseline after stable publication", async () => {
  const repo = await repository();
  try {
    const candidate = repo.candidate();
    await repo.fixture.github.keepReleaseIntent(candidate.run.id, candidate);
    repo.fixture.add(candidate);
    repo.fixture.add(stable(candidate));
    const retry = await planNightly(
      repo.fixture.github,
      repo.root,
      candidate.sha,
      "main",
      candidate.run.id,
      repo.baseline,
    );
    assert.equal(retry.version, candidate.version);
    assert.equal(retry.baseline.version, "1.4.2");
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});

void test("hotfixes omit unfinished main changes and subsequent releases preserve the stable ancestry", async () => {
  const repo = await repository();
  try {
    await git(repo.root, "switch", "-c", "release/1.4", repo.base);
    await git(
      repo.root,
      "commit",
      "--allow-empty",
      "-m",
      "Emergency patch subject",
    );
    const hotfixSha = await git(repo.root, "rev-parse", "HEAD");
    const hotfixChange = change(
      "fix(auth): close a security defect",
      hotfixSha,
      3,
    );
    repo.fixture.associate(hotfixSha, [hotfixChange]);
    const hotfix = {
      ...repo.candidate(hotfixSha, 144, [hotfixChange]),
      sourceBranch: "release/1.4",
      stableVersion: "1.4.3",
      version: nightlyVersion("1.4.3", "2026-10-08T01:42:00Z", 144),
    };
    hotfix.tag = `v${hotfix.version}`;
    repo.fixture.add(hotfix);
    const selected = await planProduction(
      repo.fixture.github,
      repo.root,
      hotfix.tag,
      "night-project",
      repo.baseline,
    );
    assert.equal(selected.version, "1.4.3");
    assert.deepEqual(
      selected.changes.map((value) => value.number),
      [3],
    );
    repo.fixture.add(selected);
    const newBaseline = await latestBaseline(
      repo.fixture.github,
      repo.baseline,
    );
    await assert.rejects(
      collectChanges(repo.fixture.github, repo.root, newBaseline, repo.fix),
      /hotfix history/,
    );
    await git(repo.root, "switch", "main");
    await git(
      repo.root,
      "merge",
      "--no-ff",
      "release/1.4",
      "-m",
      "Merge released maintenance history",
    );
    const merged = await git(repo.root, "rev-parse", "HEAD");
    repo.fixture.associate(merged, [
      change("chore(release): merge the published hotfix", merged, 4),
    ]);
    const changes = await collectChanges(
      repo.fixture.github,
      repo.root,
      newBaseline,
      merged,
    );
    assert.ok(!changes.some((value) => value.number === 3));
    assert.equal(
      predictedStable(
        newBaseline.version,
        changes.map((value) => value.title),
      ).version,
      "1.5.0",
    );
  } finally {
    await rm(repo.root, { recursive: true, force: true });
  }
});
