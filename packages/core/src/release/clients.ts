import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  checksumsName,
  checksumsSignatureName,
  latestDesktopInstallers,
  runnerAsset,
  runnerInstallers,
  runnerTargets,
} from "@lictory/core/release/downloads";

// The client downloads of a release, next to its images: the lictory-runner
// binaries with their installers, and the desktop app's installers with the
// latest*.yml files electron-updater reads. The release workflows build them
// (.github/workflows/release-clients.yml), the publishing job writes
// SHA256SUMS over them (`bun run release clients`), signs and attests it,
// and `release publish` attaches them to the draft before publishing.
//
// Their names are a contract (downloads.ts): the add-runner dialog and the
// installers download `releases/<tag>/download/<name>`, installed desktop
// apps find their update through latest*.yml, and lictory.com/download links
// to `releases/latest/download/<name>` of the version-free installer copies.
// See docs/operations/releases.md.

/** The desktop installers of one version, by the file names package.mjs gives them. */
export function desktopInstallers(version: string) {
  return {
    "latest-mac.yml": [
      `Lictory-${version}-mac-universal.zip`,
      `Lictory-${version}-mac-universal.dmg`,
    ],
    "latest.yml": [`Lictory-${version}-windows-setup.exe`],
    "latest-linux.yml": [
      `Lictory-${version}-linux-x86_64.AppImage`,
      `lictory_${version}_amd64.deb`,
    ],
    "latest-linux-arm64.yml": [
      `Lictory-${version}-linux-arm64.AppImage`,
      `lictory_${version}_arm64.deb`,
    ],
  } as const;
}

// The files each updater file must name (what an installed app downloads).
const updates: Record<string, RegExp> = {
  "latest-mac.yml": /-mac-universal\.zip$/,
  "latest.yml": /-windows-setup\.exe$/,
  "latest-linux.yml": /-linux-x86_64\.AppImage$/,
  "latest-linux-arm64.yml": /-linux-arm64\.AppImage$/,
};

export type ClientAsset = { name: string; path: string; sha256: string };

// SHA-256 (SHA256SUMS), SHA-512 (latest*.yml) and size in one read: the
// desktop installers run to hundreds of megabytes.
async function digests(path: string) {
  const sha256 = createHash("sha256");
  const sha512 = createHash("sha512");
  let size = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    sha256.update(chunk);
    sha512.update(chunk);
    size += chunk.byteLength;
  }
  return {
    sha256: sha256.digest("hex"),
    sha512: sha512.digest("base64"),
    size,
  };
}

type UpdateInfo = {
  version?: string;
  path?: string;
  sha512?: string;
  files: { url?: string; sha512?: string; size?: number }[];
};

/**
 * The fields electron-updater reads from a latest*.yml file, which
 * electron-builder writes as plain block YAML: `version`, `path`, `sha512`
 * and the `files` list of `url`, `sha512` and `size`.
 */
export function parseUpdateInfo(text: string): UpdateInfo {
  const info: UpdateInfo = { files: [] };
  let inFiles = false;
  const unquote = (value: string) =>
    value.trim().replace(/^(['"])(.*)\1$/, "$2");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const top = /^([A-Za-z]\w*):\s*(.*)$/.exec(line);
    if (top) {
      inFiles = top[1] === "files";
      const [, key, value] = top;
      if (key === "version" || key === "path" || key === "sha512")
        info[key] = unquote(value!);
      continue;
    }
    const item = /^\s+(-\s+)?(\w+):\s*(.*)$/.exec(line);
    if (!inFiles || !item) continue;
    const [, dash, key, raw] = item;
    if (dash) info.files.push({});
    const file = info.files.at(-1);
    if (!file) continue;
    const value = unquote(raw!);
    if (key === "url" || key === "sha512") file[key] = value;
    if (key === "size") file.size = Number(value);
  }
  return info;
}

/**
 * Every client download of `version` in `directory`, checked before
 * anything is signed or attached: all six runner binaries and both
 * installers, every desktop installer under its contract name and its
 * version-free copy, latest*.yml
 * files of this version whose files exist with the SHA-512 and size they
 * state, and nothing else (block maps only next to their installer). An
 * existing SHA256SUMS must list exactly these files.
 */
export async function clientAssets(
  directory: string,
  version: string,
  checkExisting = true,
): Promise<ClientAsset[]> {
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name !== checksumsName && name !== checksumsSignatureName)
    .sort();
  const present = new Set(names);
  const installers = desktopInstallers(version);
  const expected = [
    ...runnerTargets.map(runnerAsset),
    ...Object.keys(runnerInstallers),
    ...Object.entries(installers).flatMap(([update, files]) => [
      update,
      ...files,
    ]),
    ...Object.keys(latestDesktopInstallers),
  ];
  const missing = expected.filter((name) => !present.has(name));
  if (missing.length)
    throw new Error(
      `The client downloads of ${version} are incomplete; missing: ${missing.join(", ")}. Retry the failed build job.`,
    );
  const unexpected = names.filter(
    (name) =>
      !expected.includes(name) &&
      !(name.endsWith(".blockmap") && present.has(name.slice(0, -9))),
  );
  if (unexpected.length)
    throw new Error(
      `Unexpected client files for ${version}: ${unexpected.join(", ")}.`,
    );

  const assets: ClientAsset[] = [];
  const built = new Map<string, { sha512: string; size: number }>();
  for (const name of names) {
    const path = join(directory, name);
    const { sha256, ...rest } = await digests(path);
    built.set(name, rest);
    assets.push({ name, path, sha256 });
  }
  // A version-free name serves the newest stable release's installer from
  // `releases/latest/download/`; it must be exactly this version's file.
  const sha256 = new Map(assets.map((asset) => [asset.name, asset.sha256]));
  for (const [name, versioned] of Object.entries(latestDesktopInstallers))
    if (sha256.get(name) !== sha256.get(versioned(version)))
      throw new Error(
        `${name} is not a copy of ${versioned(version)}; rebuild ${version}'s desktop app.`,
      );
  for (const [update, pattern] of Object.entries(updates)) {
    const info = parseUpdateInfo(
      await readFile(join(directory, update), "utf8"),
    );
    if (info.version !== version)
      throw new Error(
        `${update} is for ${info.version ?? "no version"}, not ${version}.`,
      );
    if (!info.files.some((file) => file.url && pattern.test(file.url)))
      throw new Error(`${update} names no ${pattern.source} file.`);
    for (const file of info.files) {
      const content = file.url ? built.get(file.url) : undefined;
      if (!content)
        throw new Error(`${update} names ${file.url}, which is not built.`);
      if (file.sha512 !== content.sha512 || file.size !== content.size)
        throw new Error(
          `${update} does not describe ${file.url} as built (SHA-512 or size differ); rebuild ${version}'s desktop app.`,
        );
    }
  }

  const existing = checkExisting
    ? await readFile(join(directory, checksumsName), "utf8").catch(
        () => undefined,
      )
    : undefined;
  if (existing !== undefined && existing !== checksums(assets))
    throw new Error(
      `${checksumsName} does not list the client files as they are; recreate it with \`bun run release clients\`.`,
    );
  return assets;
}

/** SHA256SUMS in the format of `sha256sum`, which `sha256sum -c` checks. */
export function checksums(assets: ClientAsset[]): string {
  return [...assets]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((asset) => `${asset.sha256}  ${asset.name}\n`)
    .join("");
}

/** Checks the downloads and writes their SHA256SUMS, the subject list signing reads. */
export async function writeChecksums(directory: string, version: string) {
  const assets = await clientAssets(directory, version, false);
  await writeFile(join(directory, checksumsName), checksums(assets));
  return assets;
}
