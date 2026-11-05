import { z } from "zod";
import type { GitHub } from "@lictory/core/release/github";

/**
 * Nightly retention: a published nightly GitHub Release is deleted once it is
 * older than this and a newer nightly exists. Git tags are never deleted, so
 * compare links and `git checkout <tag>` keep working.
 */
export const nightlyRetentionDays = 14;

/**
 * A stable release run can wait for approval and be re-run for this long; the
 * nightly it promotes is re-read by its publish job and by every re-run.
 */
export const promotionWindowDays = 30;

const day = 24 * 60 * 60 * 1000;

/**
 * The tag shape `lictory upgrade` and `get.sh` accept as a nightly (keep the
 * three in step). Prerelease and published are checked separately.
 */
const nightlyTag = /^v[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]{8}\.[0-9]+$/;

export const prunableReleaseSchema = z.object({
  id: z.number(),
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
});
export type PrunableRelease = z.infer<typeof prunableReleaseSchema>;

/** A published nightly: what the nightly channel of `lictory upgrade` can install. */
export function isPublishedNightly(release: PrunableRelease): boolean {
  return (
    !release.draft &&
    release.prerelease &&
    release.published_at !== null &&
    nightlyTag.test(release.tag_name)
  );
}

function instant(value: string, what: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${what} has no valid date.`);
  return time;
}

/**
 * The nightly releases to delete, oldest first: published more than
 * `retentionDays` before `now` (exactly at the boundary is kept) **and**
 * older than the newest published nightly. The newest nightly, by publication
 * date as `lictory upgrade` orders them, always survives however old it is;
 * nightlies sharing its publication instant survive with it. Stable releases,
 * drafts and anything not shaped like a nightly are never selected, and
 * neither is a protected tag.
 */
export function nightliesToPrune<T extends PrunableRelease>(
  releases: readonly T[],
  now: Date,
  {
    retentionDays = nightlyRetentionDays,
    protectedTags = new Set<string>(),
  }: { retentionDays?: number; protectedTags?: ReadonlySet<string> } = {},
): T[] {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime))
    throw new Error("The current time has no valid date.");
  const nightlies = releases.filter(isPublishedNightly).map((release) => ({
    release,
    published: instant(release.published_at!, release.tag_name),
  }));
  if (!nightlies.length) return [];
  const newest = Math.max(...nightlies.map(({ published }) => published));
  const cutoff = nowTime - retentionDays * day;
  return nightlies
    .filter(
      ({ release, published }) =>
        published < cutoff &&
        published < newest &&
        !protectedTags.has(release.tag_name),
    )
    .sort((a, b) => a.published - b.published)
    .map(({ release }) => release);
}

const intentRecordSchema = z.object({
  id: z.number(),
  created_at: z.string(),
  payload: z.unknown(),
});
export type IntentRecord = z.infer<typeof intentRecordSchema>;
const intentPayloadSchema = z.object({
  kind: z.literal("lictory-release-intent"),
  manifest: z.object({ tag: z.string(), sourceNightly: z.string() }),
});

/**
 * Nightlies a stable release run may still need: the source of every stable
 * release intent recorded within the promotion window. Its publish job
 * re-validates that nightly's GitHub Release, and a whole-run retry promotes
 * the same one again. An intent this cannot read fails closed.
 */
export function promotionSources(
  intents: readonly IntentRecord[],
  now: Date,
  windowDays = promotionWindowDays,
): Set<string> {
  const since = now.getTime() - windowDays * day;
  const sources = new Set<string>();
  for (const record of intents) {
    if (instant(record.created_at, `Release intent ${record.id}`) < since)
      continue;
    const payload = intentPayloadSchema.safeParse(record.payload);
    if (!payload.success)
      throw new Error(
        `Release intent ${record.id} does not say which nightly it promotes; nothing was deleted.`,
      );
    sources.add(payload.data.manifest.sourceNightly);
  }
  return sources;
}

export type PruneReport = {
  /** Every published nightly found. */
  nightlies: number;
  newest: string | undefined;
  protectedTags: string[];
  selected: PrunableRelease[];
  deleted: PrunableRelease[];
  failure?: { release: PrunableRelease; error: string };
};

const age = (release: PrunableRelease, now: Date) =>
  Math.floor((now.getTime() - Date.parse(release.published_at!)) / day);

/**
 * Lists every release and every recent stable release intent, then deletes
 * the selected nightly releases one at a time, oldest first, stopping at the
 * first failure. Nothing is deleted unless both listings were read
 * completely. A dry run only reads.
 */
export async function pruneNightlies(
  github: GitHub,
  now: Date,
  dryRun: boolean,
  log: (line: string) => void = console.log,
): Promise<PruneReport> {
  const releases = await github.completeList(
    "/releases",
    prunableReleaseSchema,
  );
  const intents = await github.completeList(
    "/deployments?environment=production-intent",
    intentRecordSchema,
  );
  const protectedTags = promotionSources(intents, now);
  const nightlies = releases.filter(isPublishedNightly);
  const newest = nightlies.reduce<PrunableRelease | undefined>(
    (best, release) =>
      !best ||
      Date.parse(release.published_at!) > Date.parse(best.published_at!)
        ? release
        : best,
    undefined,
  );
  const selected = nightliesToPrune(releases, now, { protectedTags });
  const report: PruneReport = {
    nightlies: nightlies.length,
    newest: newest?.tag_name,
    protectedTags: [...protectedTags].sort(),
    selected,
    deleted: [],
  };
  log(
    `${releases.length} releases, ${nightlies.length} published nightlies. Newest nightly (always kept): ${newest ? `${newest.tag_name}, published ${newest.published_at}` : "none"}.`,
  );
  for (const tag of report.protectedTags)
    log(`Kept ${tag}: a stable release run promotes it.`);
  log(
    `${selected.length} nightly releases are older than ${nightlyRetentionDays} days and have a newer nightly${dryRun ? " (dry run: nothing is deleted)" : ""}.`,
  );
  for (const release of selected) {
    const line = `${release.tag_name} (published ${release.published_at}, ${age(release, now)} days ago)`;
    if (dryRun) {
      log(`Would delete ${line}`);
      continue;
    }
    try {
      // Deletes the GitHub Release only; its Git tag stays.
      await github.request(`/releases/${release.id}`, "DELETE");
    } catch (error) {
      report.failure = {
        release,
        error: error instanceof Error ? error.message : String(error),
      };
      log(`Failed to delete ${line}: ${report.failure.error}`);
      break;
    }
    report.deleted.push(release);
    log(`Deleted ${line}`);
  }
  return report;
}
