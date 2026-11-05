// Which browser test files a run executes, and how CI splits them into shards.
//
// Playwright's own --shard balances by test count, but one platform workflow
// takes as long as twenty website checks, so count-balanced shards finish
// minutes apart. Shards here are balanced by recorded duration instead
// (`scripts/test-timings/browser.json`, the format `bun test --timings` uses):
// the longest files are placed first, each on the shard with the least work.
// Every shard computes the same assignment from the same inputs. A file
// without a recorded duration is estimated from its number of tests, so stale
// timings only make shards less even, never skip a file.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const timingsPath = "scripts/test-timings/browser.json";
const estimatePerTest = 6_000;

type Report = { suites?: Suite[] };
type Suite = {
  specs?: {
    file?: string;
    tests?: { projectName?: string; results?: { duration?: number }[] }[];
  }[];
  suites?: Suite[];
};
export type TestFile = { tests: number; projects: Set<string>; ms: number };

function files(report: Report) {
  const found = new Map<string, TestFile>();
  const visit = (suite: Suite) => {
    for (const spec of suite.specs ?? []) {
      if (!spec.file) continue;
      const entry = found.get(spec.file) ?? {
        tests: 0,
        projects: new Set<string>(),
        ms: 0,
      };
      for (const test of spec.tests ?? []) {
        entry.tests += 1;
        if (test.projectName) entry.projects.add(test.projectName);
        // The first attempt: a retry's duration says nothing about the file.
        entry.ms += test.results?.[0]?.duration ?? 0;
      }
      found.set(spec.file, entry);
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return found;
}

/**
 * The test files (relative to the repository) that `playwright test <args>`
 * would run, without running them. Null when listing fails.
 */
export async function listTests(
  args: string[],
): Promise<Map<string, TestFile> | null> {
  const child = spawn(
    "bunx",
    ["playwright", "test", ...args, "--list", "--reporter=json"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number | null>((resolve) =>
    child.on("exit", resolve),
  );
  if (code !== 0) return null;
  try {
    return files(JSON.parse(output) as Report);
  } catch {
    return null;
  }
}

export function parseShard(value: string | undefined) {
  if (!value?.trim()) return null;
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || index < 1 || total < 1 || index > total)
    throw new Error(`E2E_SHARD must look like 2/4, not "${value}".`);
  return { index, total };
}

function readTimings(): Record<string, number> {
  if (!existsSync(timingsPath)) return {};
  return (
    (
      JSON.parse(readFileSync(timingsPath, "utf8")) as {
        files?: Record<string, number>;
      }
    ).files ?? {}
  );
}

/** The files of shard `index` (1-based) out of `total`. */
export function shardFiles(
  tests: Map<string, TestFile>,
  index: number,
  total: number,
  timings = readTimings(),
) {
  const weighted = [...tests]
    .map(([file, { tests: count }]) => ({
      file,
      weight: timings[file] ?? count * estimatePerTest,
    }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
  const shards = Array.from({ length: total }, () => ({
    weight: 0,
    files: [] as string[],
  }));
  for (const { file, weight } of weighted) {
    const lightest = shards.reduce((min, shard) =>
      shard.weight < min.weight ? shard : min,
    );
    lightest.weight += weight;
    lightest.files.push(file);
  }
  return shards[index - 1]!.files;
}

/**
 * Records the measured duration of every file in a Playwright JSON report,
 * keeping the other entries and dropping files that no longer exist.
 */
export function updateTimings(reportPath: string) {
  const measured = files(
    JSON.parse(readFileSync(reportPath, "utf8")) as Report,
  );
  const merged: Record<string, number> = {};
  for (const [file, ms] of Object.entries(readTimings()))
    if (existsSync(file)) merged[file] = ms;
  for (const [file, { ms }] of measured)
    if (ms > 0) merged[file] = Math.round(ms);
  const sorted = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(
    timingsPath,
    `${JSON.stringify({ version: 1, files: sorted }, null, 2)}\n`,
  );
  console.log(`Recorded ${measured.size} file durations in ${timingsPath}.`);
}
