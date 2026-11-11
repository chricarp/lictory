import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  GitHubFixture,
  images,
  registry,
  stable,
} from "@lictory/core/release/fixtures.test-helper";
import {
  attestationSubjects,
  licenseAssets,
  sbomAssets,
} from "@lictory/core/release/attestations";
import { buildImages, imageNames } from "@lictory/core/release/images";

const spdx = (reference: string, platform: string) => ({
  spdxVersion: "SPDX-2.3",
  name: `${reference} ${platform}`,
  packages: [{ name: "zod" }],
});
// `imagetools inspect --format '{{json .SBOM}}'` of a multi-platform index.
const inspected = (reference: string) =>
  Object.fromEntries(
    ["linux/amd64", "linux/arm64"].map((platform) => [
      platform,
      { SPDX: spdx(reference, platform) },
    ]),
  );

void test("signatures and attestations name each image by repository and index digest", () => {
  const subjects = attestationSubjects(images());
  assert.deepEqual(Object.keys(subjects), [...imageNames]);
  for (const name of imageNames) {
    assert.equal(subjects[name].name, `${registry}/lictory-${name}`);
    assert.equal(
      `${subjects[name].name}@${subjects[name].digest}`,
      images()[name],
    );
  }
});

void test("a release carries the SPDX SBOM of every image on both platforms", async () => {
  const inspectedReferences: string[] = [];
  const assets = await sbomAssets(images(), async (reference) => {
    inspectedReferences.push(reference);
    return inspected(reference);
  });
  // The digests installations pull, nothing resolved by tag.
  assert.deepEqual(
    inspectedReferences,
    imageNames.map((name) => images()[name]),
  );
  assert.deepEqual(
    assets.map((asset) => asset.name),
    imageNames.flatMap((name) => [
      `lictory-${name}-linux-amd64.spdx.json`,
      `lictory-${name}-linux-arm64.spdx.json`,
    ]),
  );
  const api = JSON.parse(assets[1]!.body) as { name: string };
  assert.equal(api.name, `${images().api} linux/arm64`);
  // Retries attach the same bytes (an attached asset never changes).
  assert.deepEqual(
    await sbomAssets(images(), async (reference) => inspected(reference)),
    assets,
  );
});

void test("images built without SBOM attestations block the release with what to do", async () => {
  await assert.rejects(
    sbomAssets(images(), async (reference) =>
      reference.includes("lictory-proxy")
        ? { "linux/amd64": inspected(reference)["linux/amd64"] }
        : inspected(reference),
    ),
    /proxy image has no SBOM attestation for linux\/arm64.*new candidate/,
  );
  await assert.rejects(
    sbomAssets(images(), async () => ({})),
    /api image has no SBOM attestation for linux\/amd64/,
  );
});

void test("the license report is attached under release names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lictory-licenses-"));
  try {
    await writeFile(join(directory, "inventory.json"), '{"packages":[]}\n');
    await writeFile(join(directory, "THIRD_PARTY_NOTICES.txt"), "notices\n");
    assert.deepEqual(await licenseAssets(directory), [
      { name: "third-party-licenses.json", body: '{"packages":[]}\n' },
      { name: "THIRD_PARTY_NOTICES.txt", body: "notices\n" },
    ]);
    await rm(join(directory, "inventory.json"));
    await assert.rejects(licenseAssets(directory), /inventory\.json/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("evidence assets are attached once with their exact bytes", async () => {
  const fixture = new GitHubFixture();
  const manifest = stable();
  const reserved = await fixture.github.reserve(manifest);
  const [sbom] = await sbomAssets(images(), async (reference) =>
    inspected(reference),
  );
  const attach = (body: string) =>
    fixture.github.attach(
      manifest,
      sbom!.name,
      body,
      reserved,
      "application/json",
    );
  await attach(sbom!.body);
  const uploads = () =>
    fixture.writes.filter((write) => write.includes("/assets")).length;
  const afterFirst = uploads();
  await attach(sbom!.body);
  assert.equal(uploads(), afterFirst);
  await assert.rejects(
    attach(`${sbom!.body} `),
    /already has a different lictory-api-linux-amd64\.spdx\.json/,
  );
});

void test("release builds record an SBOM and full provenance even for older bake files", async () => {
  const calls: string[][] = [];
  const result = await buildImages(
    "/source",
    stable(),
    {
      registry,
      sourceUrl: "https://github.com/example/lictory",
      architecture: "amd64",
    },
    async (command, args) => {
      calls.push([command, ...args]);
      const metadata = args[args.indexOf("--metadata-file") + 1]!;
      await writeFile(
        metadata,
        JSON.stringify(
          Object.fromEntries(
            imageNames.map((name) => [
              name,
              {
                "containerimage.digest": images()[name].split("@")[1],
                "image.name": `${registry}/lictory-${name}:1.5.0-amd64`,
              },
            ]),
          ),
        ),
      );
    },
  );
  assert.deepEqual(result, images());
  const [call] = calls;
  assert.deepEqual(call!.slice(0, 4), ["docker", "buildx", "bake", "--file"]);
  assert.ok(call!.includes("--push"));
  assert.ok(call!.includes("--sbom=true"));
  assert.ok(call!.includes("--provenance=mode=max"));
});
