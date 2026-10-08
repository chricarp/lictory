export type Bump = "none" | "patch" | "minor" | "major";
const types = new Set([
  "feat",
  "fix",
  "perf",
  "docs",
  "chore",
  "ci",
  "test",
  "refactor",
  "style",
  "build",
  "revert",
]);

export function stableParts(version: string): [bigint, bigint, bigint] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error(`Invalid stable SemVer: ${version}`);
  return version.split(".").map((part) => BigInt(part)) as [
    bigint,
    bigint,
    bigint,
  ];
}

export function compareStable(a: string, b: string): number {
  const left = stableParts(a);
  const right = stableParts(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i]! < right[i]! ? -1 : 1;
  }
  return 0;
}

export function conventionalTitle(title: string) {
  const match = /^([a-z]+)(?:\(([^()\r\n]+)\))?(!)?: ([^\r\n]+)$/.exec(title);
  if (!match || !types.has(match[1]!) || !match[4]!.trim())
    throw new Error(`PR title must use Conventional Commits: ${title}`);
  const type = match[1]!;
  const breaking = Boolean(match[3]);
  const bump: Bump = breaking
    ? "major"
    : type === "feat"
      ? "minor"
      : type === "fix" || type === "perf"
        ? "patch"
        : "none";
  return {
    type,
    scope: match[2] ?? null,
    breaking,
    description: match[4]!.trim(),
    bump,
  };
}

export function predictedStable(
  baseline: string,
  titles: string[],
  declareStableApi = false,
): { version: string; bump: Bump } {
  const priority: Record<Bump, number> = {
    none: 0,
    patch: 1,
    minor: 2,
    major: 3,
  };
  const bump = titles
    .map((title) => conventionalTitle(title).bump)
    .reduce<Bump>(
      (highest, next) => (priority[next] > priority[highest] ? next : highest),
      "none",
    );
  const [major, minor, patch] = stableParts(baseline);
  if (declareStableApi && bump !== "major")
    throw new Error("A stable API declaration requires a breaking PR title.");
  // Before 1.0, breaking changes advance the minor train, never silently declare stability.
  const version =
    bump === "major"
      ? major === 0n && !declareStableApi
        ? `0.${minor + 1n}.0`
        : `${major + 1n}.0.0`
      : bump === "minor"
        ? `${major}.${minor + 1n}.0`
        : bump === "patch"
          ? `${major}.${minor}.${patch + 1n}`
          : baseline;
  stableParts(version);
  return { version, bump };
}

export function nightlyVersion(
  stable: string,
  createdAt: string,
  runNumber: number,
): string {
  stableParts(stable);
  if (!Number.isSafeInteger(runNumber) || runNumber < 1)
    throw new Error("Invalid nightly run number.");
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Invalid nightly run date.");
  return `${stable}-nightly.${date.toISOString().slice(0, 10).replaceAll("-", "")}.${runNumber}`;
}

export function parseNightly(version: string) {
  const match =
    /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-nightly\.([1-9]\d{7})\.([1-9]\d*)$/.exec(
      version,
    );
  if (!match) throw new Error(`Invalid nightly SemVer: ${version}`);
  const date = match[2]!;
  const createdAt = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00.000Z`;
  const runNumber = Number(match[3]);
  if (nightlyVersion(match[1]!, createdAt, runNumber) !== version)
    throw new Error("Invalid nightly date or sequence.");
  return { stable: match[1]!, date, runNumber };
}

export function assertBuildVersion(version: string): void {
  if (version.includes("-")) parseNightly(version);
  else stableParts(version);
}
