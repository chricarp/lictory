import assert from "node:assert/strict";
import { test } from "node:test";
import {
  images,
  registry,
  stable,
} from "@lictory/core/release/fixtures.test-helper";
import { fingerprint } from "@lictory/core/release/model";
import {
  bakeEnvironment,
  imageNames,
  imagesSchema,
  releaseFile,
} from "@lictory/core/release/images";
import {
  mergeArchitectureBuilds,
  releaseArchitectures,
} from "@lictory/core/release/parallel-images";

const manifest = stable();
const builds = () =>
  releaseArchitectures.map((architecture, index) => ({
    architecture,
    manifestHash: fingerprint(manifest),
    images: images(index ? "b" : "a"),
  }));

void test("native build caches and temporary tags are isolated by architecture and channel", () => {
  const config = {
    registry,
    sourceUrl: "https://github.com/test/lictory",
    architecture: "arm64" as const,
  };
  const env = bakeEnvironment(manifest, config);
  assert.equal(env.PLATFORMS, "linux/arm64");
  assert.equal(env.TAG_SUFFIX, "-arm64");
  assert.equal(env.CACHE_SCOPE, "stable-arm64");
  assert.equal(env.CACHE_REGISTRY, `${registry}/lictory-cache`);
});

void test("assembly joins the amd64 and arm64 builds of every image and returns only pinned digests", async () => {
  const calls: string[][] = [];
  const result = await mergeArchitectureBuilds(
    builds(),
    manifest,
    registry,
    undefined,
    async (_, args) => {
      calls.push([...args]);
    },
    "/tmp",
    async () => `sha256:${"c".repeat(64)}`,
  );
  assert.equal(calls.length, 4);
  for (const name of imageNames) {
    const reference = result[name];
    assert.equal(
      reference,
      `${registry}/lictory-${name}@sha256:${"c".repeat(64)}`,
    );
    const call = calls.find((args) =>
      args.includes(`${registry}/lictory-${name}:${manifest.version}`),
    )!;
    for (const build of builds()) assert.ok(call.includes(build.images[name]));
  }
});

void test("incomplete, mixed-source, foreign-registry and stale-asset builds fail before any publication", async () => {
  for (const metadata of [
    [],
    [builds()[0]],
    [builds()[1]],
    [builds()[1], builds()[1]],
    [...builds(), builds()[0]],
    [builds()[0], { ...builds()[1], manifestHash: "another-plan" }],
    [builds()[0], { ...builds()[1], previousProxyImage: images().proxy }],
    [
      builds()[0],
      {
        ...builds()[1],
        images: { ...images(), api: `other/repo@sha256:${"a".repeat(64)}` },
      },
    ],
  ]) {
    let calls = 0;
    await assert.rejects(
      mergeArchitectureBuilds(
        metadata,
        manifest,
        registry,
        undefined,
        async () => {
          calls++;
        },
        "/tmp",
        async () => "",
      ),
    );
    assert.equal(calls, 0);
  }
});

void test("Cloudflare releases omit the website image while retaining old server and journal compatibility", () => {
  const current = images();
  assert.equal(current.marketing, undefined);
  assert.match(
    releaseFile(manifest, current),
    new RegExp(`MARKETING_IMAGE=${current.api}`),
  );
  const legacy = {
    ...current,
    marketing: `${registry}/lictory-marketing@sha256:${"b".repeat(64)}`,
  };
  assert.deepEqual(imagesSchema.parse(legacy), legacy);
  assert.ok(
    releaseFile(manifest, legacy).includes(
      `MARKETING_IMAGE=${legacy.marketing}`,
    ),
  );
});
