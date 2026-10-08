import { type GitHub, runSchema, type Release } from "./github";
import {
  fingerprint,
  manifestSchema,
  sameManifest,
  type Baseline,
  type Manifest,
} from "./model";
import { ancestor, collectChanges, git, latestBaseline } from "./repository";
import {
  compareStable,
  conventionalTitle,
  nightlyVersion,
  parseNightly,
  predictedStable,
  stableParts,
} from "./version";

class IneligibleNightly extends Error {}

export function assertRun(
  manifest: Manifest,
  run: ReturnType<typeof runSchema.parse>,
  verified: boolean,
) {
  if (
    run.id !== manifest.run.id ||
    run.run_number !== manifest.run.number ||
    run.head_sha !== manifest.sha ||
    run.head_branch !== manifest.sourceBranch ||
    run.created_at !== manifest.run.createdAt ||
    run.path.split("@")[0] !== ".github/workflows/nightly.yml" ||
    !["push", "repository_dispatch"].includes(run.event) ||
    (verified && run.conclusion !== "success")
  )
    throw new IneligibleNightly(
      "Nightly provenance does not match a successful trusted nightly workflow run.",
    );
}

export async function planNightly(
  github: GitHub,
  root: string,
  sha: string,
  branch: string,
  runId: number,
  bootstrap: Baseline,
): Promise<Manifest> {
  const run = runSchema.parse(await github.request(`/actions/runs/${runId}`));
  const intent = await github.releaseIntent("nightly", runId);
  if (intent) {
    assertRun(intent, run, false);
    if (intent.sha !== sha || intent.sourceBranch !== branch)
      throw new Error("Retry source changed.");
    return intent;
  }
  // Retries preserve an already reserved/published candidate, even after a stable promotion.
  const existing = (await github.releases()).filter(
    (release) =>
      release.tag_name.includes("-nightly.") &&
      release.tag_name.endsWith(`.${run.run_number}`),
  );
  if (existing.length > 1)
    throw new Error(
      "Multiple releases claim this nightly run; refusing ambiguous retry.",
    );
  if (existing.length) {
    const manifest = await github.manifest(existing[0]!);
    assertRun(manifest, run, false);
    if (manifest.sha !== sha || manifest.sourceBranch !== branch)
      throw new Error("Retry source changed.");
    return manifest;
  }
  const baseline = await latestBaseline(github, bootstrap);
  const changes = await collectChanges(github, root, baseline, sha);
  const next = predictedStable(
    baseline.version,
    changes.map((change) => change.title),
    changes.some((change) => change.stableApi),
  );
  if (branch !== "main") {
    const [major, minor] = stableParts(baseline.version);
    if (
      branch !== `release/${major}.${minor}` ||
      changes.some((change) => conventionalTitle(change.title).type === "feat")
    )
      throw new Error(
        "Maintenance nightlies must be fixes or maintenance on the current stable release/<major>.<minor> branch; feature PRs are excluded.",
      );
  }
  const head = await git(root, "rev-parse", `refs/remotes/origin/${branch}`);
  if (!(await ancestor(root, sha, head)))
    throw new Error("Nightly source is not on its protected branch.");
  const version = nightlyVersion(next.version, run.created_at, run.run_number);
  let nightlyNotes: Manifest["nightlyNotes"] = null;
  const previous = (await github.releases())
    .filter(
      (release) =>
        !release.draft &&
        release.prerelease &&
        release.tag_name.includes("-nightly."),
    )
    .sort(
      (a, b) =>
        parseNightly(b.tag_name.slice(1)).runNumber -
        parseNightly(a.tag_name.slice(1)).runNumber,
    );
  for (const release of previous) {
    const prior = await github.manifest(release);
    if (
      prior.sourceBranch === branch &&
      prior.run.number < run.run_number &&
      (await ancestor(root, prior.sha, sha))
    ) {
      nightlyNotes = {
        tag: prior.tag,
        sha: prior.sha,
        changes: await collectChanges(
          github,
          root,
          { ...baseline, sha: prior.sha },
          sha,
        ),
      };
      break;
    }
  }
  const manifest = manifestSchema.parse({
    schema: 1,
    repository: github.repository,
    channel: "nightly",
    version,
    tag: `v${version}`,
    stableVersion: next.version,
    sha,
    sourceBranch: branch,
    baseline,
    changes,
    run: { id: run.id, number: run.run_number, createdAt: run.created_at },
    sourceNightly: null,
    nightlyNotes,
  });
  assertRun(manifest, run, false);
  return manifest;
}

export async function verifiedNightly(
  github: GitHub,
  release: Release,
  projectId: string,
): Promise<Manifest> {
  if (
    release.draft ||
    !release.prerelease ||
    !release.published_at ||
    release.author.login !== "github-actions[bot]"
  )
    throw new IneligibleNightly(
      "Select a published nightly prerelease created by the release workflow.",
    );
  parseNightly(release.tag_name.slice(1));
  const manifest = await github.manifest(release);
  if (manifest.channel !== "nightly")
    throw new IneligibleNightly(
      "A stable release cannot be selected as a nightly.",
    );
  assertRun(
    manifest,
    runSchema.parse(await github.request(`/actions/runs/${manifest.run.id}`)),
    true,
  );
  const deployments = await github.successfulDeployments(
    "nightly",
    (record, payload) =>
      record.sha === manifest.sha &&
      payload.tag === manifest.tag &&
      payload.manifestHash === fingerprint(manifest) &&
      payload.projectId === projectId &&
      payload.runId === manifest.run.id,
  );
  if (
    !deployments.some(
      ({ record, payload }) =>
        record.sha === manifest.sha &&
        payload.tag === manifest.tag &&
        payload.manifestHash === fingerprint(manifest) &&
        payload.projectId === projectId &&
        payload.runId === manifest.run.id,
    )
  )
    throw new IneligibleNightly(
      "Nightly has no successful, matching isolated deployment.",
    );
  return manifest;
}

export function assertPromotion(
  nightly: Manifest,
  baseline: Baseline,
  changes: Manifest["changes"],
) {
  if (
    nightly.baseline.sha !== baseline.sha ||
    nightly.baseline.version !== baseline.version ||
    nightly.baseline.tag !== baseline.tag
  )
    throw new IneligibleNightly(
      "Nightly is stale after a stable release. Select a new nightly derived from the current stable baseline.",
    );
  const next = predictedStable(
    baseline.version,
    changes.map((change) => change.title),
    changes.some((change) => change.stableApi),
  );
  if (
    next.bump === "none" ||
    compareStable(next.version, baseline.version) <= 0
  )
    throw new IneligibleNightly(
      "This nightly has no release-worthy PRs; there is no new stable version to publish.",
    );
  if (
    next.version !== nightly.stableVersion ||
    JSON.stringify(changes) !== JSON.stringify(nightly.changes)
  )
    throw new IneligibleNightly(
      "Nightly's reviewed PR metadata or predicted stable version changed. Generate a fresh nightly instead of relabeling this candidate.",
    );
}

export async function planProduction(
  github: GitHub,
  root: string,
  tag: string | undefined,
  projectId: string,
  bootstrap: Baseline,
): Promise<Manifest> {
  const releases = await github.releases();
  const choices = tag
    ? releases.filter((release) => release.tag_name === tag)
    : releases
        .filter(
          (release) =>
            !release.draft &&
            release.prerelease &&
            release.tag_name.includes("-nightly."),
        )
        .sort(
          (a, b) =>
            parseNightly(b.tag_name.slice(1)).runNumber -
            parseNightly(a.tag_name.slice(1)).runNumber,
        );
  if (!choices.length)
    throw new Error(
      "No nightly release is available. Wait for the automatic nightly workflow to succeed.",
    );
  const baseline = await latestBaseline(github, bootstrap);
  for (const choice of choices) {
    try {
      const nightly = await verifiedNightly(github, choice, projectId);
      const stable = manifestSchema.parse({
        ...nightly,
        channel: "stable",
        version: nightly.stableVersion,
        tag: `v${nightly.stableVersion}`,
        sourceNightly: nightly.tag,
        nightlyNotes: null,
      });
      if (
        baseline.version === stable.version &&
        baseline.sha === stable.sha &&
        baseline.tag === stable.tag
      ) {
        const published = await github.release(stable.tag);
        if (!published || published.draft || published.prerelease)
          throw new Error("Stable publication is inconsistent.");
        const original = await github.manifest(published);
        if (!tag || original.sourceNightly !== nightly.tag)
          throw new IneligibleNightly(
            "This nightly has no new release-worthy version; that stable release is already published.",
          );
        sameManifest(original, stable);
        return stable; // Idempotent publication retry, never choose another version.
      }
      if (compareStable(stable.version, baseline.version) <= 0)
        throw new IneligibleNightly(
          "Selected nightly would duplicate or downgrade the current stable version.",
        );
      assertPromotion(nightly, baseline, nightly.changes);
      const changes = await collectChanges(github, root, baseline, nightly.sha);
      assertPromotion(nightly, baseline, changes);
      const collision = await github.tagSha(stable.tag);
      if (collision && collision !== stable.sha)
        throw new Error(
          "Stable tag is reserved for another commit; retry that release instead.",
        );
      return stable;
    } catch (error) {
      if (tag || !(error instanceof IneligibleNightly)) throw error;
      // The newest published run may be stale, failed on retry, or maintenance-only.
      // Default selection chooses the newest eligible verified candidate.
    }
  }
  throw new Error(
    "No verified nightly is eligible against the current stable baseline.",
  );
}
