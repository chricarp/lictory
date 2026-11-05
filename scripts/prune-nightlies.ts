// Deletes nightly GitHub Releases older than the retention period, always
// keeping the newest nightly and any nightly a stable release run promotes.
// Git tags stay. Run by .github/workflows/prune-nightlies.yml; see
// docs/operations/releases.md ("Nightly retention").
//
//   DRY_RUN=true|false GH_TOKEN=… GITHUB_REPOSITORY=owner/repo bun scripts/prune-nightlies.ts
import { appendFile } from "node:fs/promises";
import { GitHub } from "@lictory/core/release/github";
import {
  nightlyRetentionDays,
  pruneNightlies,
} from "@lictory/core/release/prune";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Configure ${name} before pruning nightlies.`);
  return value;
}

async function summary(text: string) {
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

try {
  const mode = required("DRY_RUN");
  if (mode !== "true" && mode !== "false")
    throw new Error(`DRY_RUN must be true or false, not ${mode}.`);
  const dryRun = mode === "true";
  // A dry run cannot write, whatever the token allows.
  const fetcher: typeof fetch = dryRun
    ? (input, init) => {
        if ((init?.method ?? "GET") !== "GET")
          throw new Error("A dry run only reads from GitHub.");
        return fetch(input, init);
      }
    : fetch;
  const github = new GitHub(
    required("GITHUB_REPOSITORY"),
    required("GH_TOKEN"),
    fetcher,
  );
  const report = await pruneNightlies(github, new Date(), dryRun);
  const pending = report.selected.filter(
    (release) => !report.deleted.includes(release),
  );
  const lines = [
    `## Nightly retention${dryRun ? " (dry run)" : ""}`,
    "",
    `Rule: delete a nightly GitHub Release older than ${nightlyRetentionDays} days when a newer nightly exists. Tags stay.`,
    `Newest nightly, always kept: ${report.newest ?? "none"}.`,
    ...(report.protectedTags.length
      ? [`Kept for a stable release run: ${report.protectedTags.join(", ")}.`]
      : []),
    dryRun
      ? `Would delete ${report.selected.length} of ${report.nightlies} nightly releases.`
      : `Deleted ${report.deleted.length} of ${report.selected.length} selected nightly releases (${report.nightlies} found).`,
    "",
    ...(dryRun ? report.selected : report.deleted).map(
      (release) => `- ${release.tag_name} (published ${release.published_at})`,
    ),
  ];
  if (report.failure)
    lines.push(
      "",
      `**Stopped:** deleting ${report.failure.release.tag_name} failed: ${report.failure.error}`,
      `Not deleted: ${pending.map((release) => release.tag_name).join(", ")}.`,
      "Re-run the workflow to continue; it recomputes the selection from the current releases.",
    );
  await summary(lines.join("\n"));
  if (report.failure) {
    console.error(
      `Deleted ${report.deleted.length} of ${report.selected.length}; stopped at ${report.failure.release.tag_name}: ${report.failure.error}. ${pending.length} not deleted; re-run to continue.`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Pruning nightlies failed.";
  console.error(`${message} Nothing was deleted.`);
  await summary(
    `Nightly retention failed before deleting anything: ${message}`,
  );
  process.exitCode = 1;
}
