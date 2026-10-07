export function parseVersion(version: string): [number, number, number] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(
      `Expected a stable major.minor.patch version, got ${version}.`,
    );
  }
  const parts = version.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error("Version numbers must be safe integers.");
  }
  return parts as [number, number, number];
}

export function nextVersion(version: string, kind: string): string {
  const [major, minor, patch] = parseVersion(version);
  let next: string;
  switch (kind) {
    case "major":
      next = `${major + 1}.0.0`;
      break;
    case "minor":
      next = `${major}.${minor + 1}.0`;
      break;
    case "patch":
    case "hotfix":
      next = `${major}.${minor}.${patch + 1}`;
      break;
    default:
      throw new Error("Choose major, minor, patch, or hotfix.");
  }
  parseVersion(next);
  return next;
}

function section(changelog: string, heading: string): string {
  const lines = changelog.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0 || lines.lastIndexOf(heading) !== start) {
    throw new Error(`Changelog must contain exactly one ${heading} section.`);
  }
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("## "),
  );
  const notes = lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
  if (!/^- \S/m.test(notes)) {
    throw new Error(`Add user-facing release notes under ${heading} first.`);
  }
  return notes;
}

export function prepareChangelog(
  changelog: string,
  version: string,
  date: string,
): string {
  parseVersion(version);
  const heading = "## [Unreleased]";
  section(changelog, heading);
  if (
    changelog.split("\n").some((line) => line.startsWith(`## [${version}]`))
  ) {
    throw new Error(`Changelog already contains version ${version}.`);
  }
  const lines = changelog.split("\n");
  lines.splice(lines.indexOf(heading) + 1, 0, "", `## [${version}] - ${date}`);
  return lines.join("\n");
}

export function releaseNotes(
  version: string,
  tag: string,
  changelog: string,
): string {
  parseVersion(version);
  if (tag !== `v${version}`) {
    throw new Error(
      `Release tag ${tag} must match package.json version v${version}.`,
    );
  }
  const headings = changelog
    .split("\n")
    .filter((line) => line.startsWith(`## [${version}]`));
  if (
    headings.length !== 1 ||
    !/^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/.test(headings[0]!)
  ) {
    throw new Error(
      `Expected one dated changelog entry for ${version}. Run release:prepare first.`,
    );
  }
  return section(changelog, headings[0]!);
}
