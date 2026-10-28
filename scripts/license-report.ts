// Collect installed dependency metadata and shipped notices without consulting
// a registry. This is evidence for artifact review, not a compatibility verdict.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

type PackageGroup = {
  paths: string[];
};
type Manifest = { name: string; version: string; license?: unknown };

const destination = process.argv[2];
if (!destination) {
  throw new Error("Usage: bun run licenses:report /absolute/output/directory");
}
const output = resolve(destination);
const root = process.cwd();
if (output === root || !relative(root, output).startsWith("..")) {
  throw new Error("Keep generated license reports outside the repository.");
}
const groups = JSON.parse(
  execFileSync(process.execPath, ["pm", "licenses", "--json"], {
    encoding: "utf8",
  }),
) as Record<string, PackageGroup[]>;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function notices(directory: string, base = directory) {
  const result: { file: string; text: string; sha256: string }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      result.push(...(await notices(path, base)));
    } else if (
      entry.isFile() &&
      /^(?:(?:third|3rd)[-_ ]?party[-_ ]?)?(?:licen[cs]es?|copying|notices?(?:text)?|copyright(?:notice)?s?)(?:[._-].*)?$/i.test(
        entry.name,
      )
    ) {
      const text = await readFile(path, "utf8");
      result.push({ file: relative(base, path), text, sha256: hash(text) });
    }
  }
  return result.sort((a, b) => a.file.localeCompare(b.file, "en"));
}

const packages = [];
const seen = new Set<string>();
for (const [declaredLicense, entries] of Object.entries(groups)) {
  for (const entry of entries) {
    for (const path of entry.paths) {
      const manifest = JSON.parse(
        await readFile(join(path, "package.json"), "utf8"),
      ) as Manifest;
      if (manifest.name.startsWith("@lictory/") || manifest.name === "lictory")
        continue;
      const id = `${manifest.name}@${manifest.version}`;
      if (seen.has(id)) continue;
      seen.add(id);
      packages.push({
        name: manifest.name,
        version: manifest.version,
        declaredLicense,
        notices: await notices(path),
      });
    }
  }
}
packages.sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"),
);
const missingNotices = packages
  .filter((entry) => entry.notices.length === 0)
  .map((entry) => `${entry.name}@${entry.version}`);
const report = {
  scope:
    "Installed dependencies including development tooling. Platform variants not installed, container OS packages and bundled application assets require separate review. Metadata is not a compatibility verdict.",
  lockfileSha256: hash(await readFile("bun.lock", "utf8")),
  platform: process.platform,
  arch: process.arch,
  missingNotices,
  packages: packages.map(({ notices: texts, ...entry }) => ({
    ...entry,
    notices: texts.map(({ file, sha256 }) => ({ file, sha256 })),
  })),
};
await mkdir(output, { recursive: true });
await writeFile(
  join(output, "inventory.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(
  join(output, "THIRD_PARTY_NOTICES.txt"),
  [
    report.scope,
    `Lockfile SHA-256: ${report.lockfileSha256}`,
    ...packages.map(
      (entry) =>
        `\n${"=".repeat(72)}\n${entry.name}@${entry.version}\nDeclared license: ${entry.declaredLicense}\n` +
        (entry.notices.length
          ? entry.notices
              .map((notice) => `\n--- ${notice.file} ---\n${notice.text}`)
              .join("\n")
          : "No license/notice text shipped in this installed package; review upstream before distribution.\n"),
    ),
  ].join("\n"),
);
console.log(
  `Collected ${packages.length} installed package versions; ${missingNotices.length} have no shipped notice file. Reports: ${output}`,
);
