import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  checksums,
  checksumsName,
  clientAssets,
  desktopInstallers,
  parseUpdateInfo,
  runnerAsset,
  runnerInstallers,
  runnerTargets,
  writeChecksums,
} from "@lictory/core/release/clients";
import {
  GitHubFixture,
  stable,
} from "@lictory/core/release/fixtures.test-helper";

const version = "1.5.0";
const scratch = await mkdtemp(join(tmpdir(), "lictory-clients-"));
after(() => rm(scratch, { recursive: true, force: true }));

const sha512 = (body: string) =>
  createHash("sha512").update(body).digest("base64");
// latest*.yml as electron-builder 26 writes it.
const updateInfo = (files: string[], body: (name: string) => string) =>
  [
    `version: ${version}`,
    "files:",
    ...files.flatMap((name) => [
      `  - url: ${name}`,
      `    sha512: ${sha512(body(name))}`,
      `    size: ${Buffer.byteLength(body(name))}`,
      ...(name.endsWith(".AppImage") ? ["    blockMapSize: 125124"] : []),
    ]),
    `path: ${files[0]}`,
    `sha512: ${sha512(body(files[0]!))}`,
    "releaseDate: '2026-11-24T02:35:40.372Z'",
    "",
  ].join("\n");

let directories = 0;
/** A complete set of client downloads, as the build jobs leave them. */
async function downloads() {
  const directory = await mkdtemp(join(scratch, `set-${++directories}-`));
  const body = (name: string) => `contents of ${name}\n`;
  const files: Record<string, string> = {};
  for (const target of runnerTargets)
    files[runnerAsset(target)] = body(runnerAsset(target));
  for (const name of Object.keys(runnerInstallers)) files[name] = body(name);
  for (const [update, installers] of Object.entries(
    desktopInstallers(version),
  )) {
    for (const name of installers) files[name] = body(name);
    // The DMG is downloaded by people, not by updates.
    files[update] = updateInfo(
      installers.filter((name) => !name.endsWith(".dmg")),
      body,
    );
  }
  files[`Lictory-${version}-windows-setup.exe.blockmap`] = "blockmap";
  for (const [name, content] of Object.entries(files))
    await writeFile(join(directory, name), content);
  return directory;
}

void test("client downloads have contract names that the dialog and installers use", () => {
  assert.deepEqual(runnerTargets.map(runnerAsset), [
    "lictory-runner-linux-x64",
    "lictory-runner-linux-arm64",
    "lictory-runner-darwin-x64",
    "lictory-runner-darwin-arm64",
    "lictory-runner-windows-x64.exe",
    "lictory-runner-windows-arm64.exe",
  ]);
  assert.deepEqual(Object.keys(runnerInstallers), [
    "lictory-runner-install.sh",
    "lictory-runner-install.ps1",
  ]);
  // GitHub renames asset names with spaces; none has one.
  for (const names of Object.values(desktopInstallers("1.5.0-nightly.1.2")))
    for (const name of names) assert.match(name, /^[\w.+-]+$/, name);
});

void test("SHA256SUMS lists every download in sha256sum's format", async () => {
  const directory = await downloads();
  const assets = await writeChecksums(directory, version);
  assert.equal(assets.length, 6 + 2 + 4 + 7 + 1);
  const written = await readFile(join(directory, checksumsName), "utf8");
  assert.equal(written, checksums(assets));
  // `sha256sum -c` accepts it: the installers and operators check with it.
  execFileSync("sha256sum", ["--check", "--strict", "--quiet", checksumsName], {
    cwd: directory,
  });
  // Read again (publication), it must still describe the files exactly.
  assert.deepEqual(await clientAssets(directory, version), assets);
  await writeFile(join(directory, "lictory-runner-linux-x64"), "changed");
  await assert.rejects(
    clientAssets(directory, version),
    /SHA256SUMS does not list the client files as they are/,
  );
});

void test("incomplete, unexpected or mismatched downloads block the release", async () => {
  const missing = await downloads();
  await unlink(join(missing, "lictory-runner-windows-arm64.exe"));
  await unlink(join(missing, "latest-mac.yml"));
  await assert.rejects(
    writeChecksums(missing, version),
    /incomplete; missing: lictory-runner-windows-arm64\.exe, latest-mac\.yml/,
  );

  const extra = await downloads();
  await writeFile(join(extra, "builder-debug.yml"), "x");
  await writeFile(join(extra, "orphan.zip.blockmap"), "x");
  await assert.rejects(
    writeChecksums(extra, version),
    /Unexpected client files for 1\.5\.0: builder-debug\.yml, orphan\.zip\.blockmap/,
  );

  // Installed apps compare versions: metadata of another build is refused.
  const other = await downloads();
  const mac = join(other, "latest-mac.yml");
  await writeFile(
    mac,
    (await readFile(mac, "utf8")).replace(
      `version: ${version}`,
      "version: 1.4.9",
    ),
  );
  await assert.rejects(
    writeChecksums(other, version),
    /latest-mac\.yml is for 1\.4\.9, not 1\.5\.0/,
  );

  // An updater file whose SHA-512 is not the installer's would make every
  // installed app fail its update.
  const rebuilt = await downloads();
  await writeFile(
    join(rebuilt, `Lictory-${version}-linux-arm64.AppImage`),
    "rebuilt",
  );
  await assert.rejects(
    writeChecksums(rebuilt, version),
    /latest-linux-arm64\.yml does not describe Lictory-1\.5\.0-linux-arm64\.AppImage as built/,
  );
});

void test("update metadata is read as electron-builder writes it", () => {
  const info = parseUpdateInfo(
    [
      "version: 1.5.0-nightly.20261124.150",
      "files:",
      "  - url: Lictory-1.5.0-nightly.20261124.150-linux-arm64.AppImage",
      "    sha512: zOM6m0NP6l+LK/Jd==",
      "    size: 118084304",
      "    blockMapSize: 125124",
      "  - url: lictory_1.5.0-nightly.20261124.150_arm64.deb",
      "    sha512: axKovrTUw9x3==",
      "    size: 96092672",
      "path: Lictory-1.5.0-nightly.20261124.150-linux-arm64.AppImage",
      "sha512: zOM6m0NP6l+LK/Jd==",
      "releaseDate: '2026-11-24T02:35:40.372Z'",
    ].join("\n"),
  );
  assert.deepEqual(info, {
    version: "1.5.0-nightly.20261124.150",
    path: "Lictory-1.5.0-nightly.20261124.150-linux-arm64.AppImage",
    sha512: "zOM6m0NP6l+LK/Jd==",
    files: [
      {
        url: "Lictory-1.5.0-nightly.20261124.150-linux-arm64.AppImage",
        sha512: "zOM6m0NP6l+LK/Jd==",
        size: 118084304,
      },
      {
        url: "lictory_1.5.0-nightly.20261124.150_arm64.deb",
        sha512: "axKovrTUw9x3==",
        size: 96092672,
      },
    ],
  });
});

void test("binary downloads attach once, and a re-run's rebuild replaces them only in a draft", async () => {
  const fixture = new GitHubFixture();
  const manifest = stable();
  const reserved = await fixture.github.reserve(manifest);
  const name = "lictory-runner-linux-x64";
  const attach = (bytes: Uint8Array<ArrayBuffer>, replaceInDraft = false) =>
    fixture.github.attach(
      manifest,
      name,
      bytes,
      reserved,
      "application/octet-stream",
      { replaceInDraft },
    );
  const uploads = () =>
    fixture.writes.filter((write) => write.includes("/assets")).length;
  const first = new Uint8Array([0, 1, 2, 255]);
  await attach(first);
  const asset = () =>
    fixture.releases
      .find((release) => release.id === reserved.id)!
      .assets.filter((value) => value.name === name);
  assert.deepEqual(fixture.files.get(asset()[0]!.id), first);
  const afterFirst = uploads();
  // The same bytes again (a retry of the failed job): nothing uploaded.
  await attach(new Uint8Array(first));
  assert.equal(uploads(), afterFirst);
  // Other bytes: refused, unless rebuilt while the release is a draft.
  const second = new Uint8Array([9, 9]);
  await assert.rejects(attach(second), /already has a different/);
  await attach(second, true);
  assert.equal(asset().length, 1);
  assert.deepEqual(fixture.files.get(asset()[0]!.id), second);
  // GitHub's recorded digest decides without downloading the asset.
  asset()[0]!.digest = `sha256:${createHash("sha256").update(second).digest("hex")}`;
  fixture.files.delete(asset()[0]!.id);
  await attach(second);
  // A published release is immutable: never replaced.
  await fixture.github.publish(manifest);
  await assert.rejects(attach(first, true), /already has a different/);
});
