import { appendFile, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  mergeArchitectureBuilds,
  releaseArchitectures,
} from "@lictory/core/release/parallel-images";
import { resolve } from "node:path";
import {
  GitHub,
  deploymentPayloadSchema,
  runSchema,
} from "@lictory/core/release/github";
import {
  assertImages,
  runCommand,
  buildImages,
  imageNames,
  imagesId,
  imagesSchema,
  releaseFile,
  type BuildConfiguration,
  type Images,
} from "@lictory/core/release/images";
import {
  attestationSubjects,
  licenseAssets,
  sbomAssets,
} from "@lictory/core/release/attestations";
import {
  baselineSchema,
  fingerprint,
  manifestSchema,
  sameManifest,
  type Manifest,
} from "@lictory/core/release/model";
import { injectVersion } from "@lictory/core/release/build";
import {
  assertRun,
  nightlyDue,
  nightlyEvents,
  planNightly,
  planProduction,
} from "@lictory/core/release/plan";
import { executeRelease, type Build } from "@lictory/core/release/pipeline";
import {
  changedPaths,
  collectChanges,
  git,
  latestBaseline,
} from "@lictory/core/release/repository";
import { touchesSite, type Site } from "@lictory/core/release/paths";
import { predictedStable } from "@lictory/core/release/version";

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Configure ${name} before running release automation.`);
  return value;
}
function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}
function bootstrap() {
  let configured = process.env.RELEASE_BOOTSTRAP_VERSION?.trim() ?? "0.1.0";
  if (configured === "") configured = "0.1.0";
  return baselineSchema.parse({
    version: configured,
    sha: required("RELEASE_BOOTSTRAP_SHA"),
    tag: null,
  });
}
async function savePlan(manifest: Manifest, path: string) {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `sha=${manifest.sha}\nversion=${manifest.version}\ntag=${manifest.tag}\n`,
    );
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Selected **${manifest.tag}** from \`${manifest.sha}\`. Baseline: ${manifest.baseline.version}.\n`,
    );
}
// The journaled image build of exactly this manifest, if any.
async function journaledBuild(
  github: GitHub,
  manifest: Manifest,
  registry: string,
): Promise<Build | undefined> {
  const environment = manifest.channel === "stable" ? "production" : "nightly";
  const [match] = await github.successfulDeployments(
    environment,
    (record, payload) =>
      record.sha === manifest.sha &&
      payload.tag === manifest.tag &&
      payload.manifestHash === fingerprint(manifest) &&
      payload.registry === registry,
  );
  if (!match) return undefined;
  return {
    id: imagesId(match.payload.images),
    url: match.payload.url,
    images: assertImages(match.payload.images, registry),
  };
}

/** The proxy image of the newest journaled build of a channel (its assets are kept). */
async function latestProxy(
  github: GitHub,
  registry: string,
  channel: Manifest["channel"],
) {
  const records = await github.deployments(
    channel === "stable" ? "production" : "nightly",
  );
  for (const record of records) {
    const payload = deploymentPayloadSchema.safeParse(record.payload);
    if (payload.success && payload.data.registry === registry)
      return payload.data.images.proxy;
  }
  return undefined;
}

function buildConfiguration(
  registry: string,
  previousProxyImage: string | undefined,
): BuildConfiguration {
  return {
    registry,
    sourceUrl: `https://github.com/${required("GITHUB_REPOSITORY")}`,
    previousProxyImage,
    cacheRegistry: optional("IMAGE_CACHE_REGISTRY"),
  };
}

// A stable candidate must still be the one the plan selected.
async function validateCandidate(
  github: GitHub,
  graphRoot: string,
  manifest: Manifest,
  registry: string,
) {
  if (manifest.channel !== "stable") return;
  const current = await planProduction(
    github,
    graphRoot,
    manifest.sourceNightly!,
    registry,
    bootstrap(),
  );
  sameManifest(current, manifest);
}

async function inspectImage(reference: string, format: string) {
  return JSON.parse(
    (
      await promisify(execFile)(
        "docker",
        ["buildx", "imagetools", "inspect", reference, "--format", format],
        { maxBuffer: 256 * 1024 * 1024 },
      )
    ).stdout,
  ) as unknown;
}

/**
 * The multi-platform images of this release: the journaled build when a
 * retry finds one, otherwise the native builds joined in the registry (or,
 * without native builds, one multi-platform build). These are the digests
 * the workflow signs before `publish` releases them.
 */
async function assemble(
  github: GitHub,
  graphRoot: string,
  root: string,
  manifest: Manifest,
): Promise<Images> {
  if ((await git(root, "rev-parse", "HEAD")) !== manifest.sha)
    throw new Error("Source checkout is not the selected release commit.");
  const registry = required("IMAGE_REGISTRY");
  await validateCandidate(github, graphRoot, manifest, registry);
  const journaled = await journaledBuild(github, manifest, registry);
  if (journaled) return journaled.images;
  const previousProxyImage = await latestProxy(
    github,
    registry,
    manifest.channel,
  );
  const directory = optional("NATIVE_BUILDS_DIRECTORY");
  if (directory)
    return mergeArchitectureBuilds(
      await Promise.all(
        releaseArchitectures.map(
          async (arch) =>
            JSON.parse(
              await readFile(resolve(directory, `${arch}.json`), "utf8"),
            ) as unknown,
        ),
      ),
      manifest,
      registry,
      previousProxyImage,
      runCommand,
      root,
      async (tag) =>
        z
          .object({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) })
          .parse(await inspectImage(tag, "{{json .Manifest}}")).digest,
    );
  await injectVersion(root, manifest.version);
  return buildImages(
    root,
    manifest,
    buildConfiguration(registry, previousProxyImage),
  );
}

async function publish(
  github: GitHub,
  graphRoot: string,
  root: string,
  manifest: Manifest,
  runId: number,
) {
  const registry = required("IMAGE_REGISTRY");
  // The images the workflow signed and attested (`assemble`); without them,
  // assembled here (unsigned: local and fork runs).
  const signed = optional("RELEASE_IMAGES");
  const assembled = signed
    ? assertImages(imagesSchema.parse(JSON.parse(signed)), registry)
    : await assemble(github, graphRoot, root, manifest);
  if ((await git(root, "rev-parse", "HEAD")) !== manifest.sha)
    throw new Error("Source checkout is not the selected release commit.");
  const licenses = optional("LICENSE_REPORT_DIRECTORY");
  const releaseUrl = `https://github.com/${github.repository}/releases/tag/${manifest.tag}`;
  const build = await executeRelease(manifest, {
    validate: () => validateCandidate(github, graphRoot, manifest, registry),
    active: async () => {
      const journaled = await journaledBuild(github, manifest, registry);
      if (journaled && journaled.id !== imagesId(assembled))
        throw new Error(
          `${manifest.tag} already published other images than the ones signed in this run; retry the whole workflow.`,
        );
      return journaled;
    },
    build: async () => ({
      id: imagesId(assembled),
      url: releaseUrl,
      images: assembled,
    }),
    record: async (build) =>
      (
        await github.recordDeployment(manifest, {
          runId,
          registry,
          images: build.images,
          url: build.url,
        })
      ).id,
    status: (id, state, build) =>
      github.deploymentStatus(id, state, build.url, runId),
    reserve: async (build) => {
      const reserved = await github.reserve(manifest);
      // What self-hosted installations pull: the exact digests of this release.
      await github.attach(
        manifest,
        "release.env",
        releaseFile(manifest, build.images),
        reserved,
      );
      // Copies of the evidence in the registry, for review without Docker.
      const assets = [
        ...(await sbomAssets(build.images, (reference) =>
          inspectImage(reference, "{{json .SBOM}}"),
        )),
        ...(licenses ? await licenseAssets(licenses) : []),
      ];
      for (const asset of assets)
        await github.attach(
          manifest,
          asset.name,
          asset.body,
          reserved,
          asset.name.endsWith(".json")
            ? "application/json"
            : "text/plain; charset=utf-8",
        );
    },
    publish: async () => {
      await github.publish(manifest);
      if (manifest.channel === "stable")
        await github.request("/dispatches", "POST", {
          event_type: "stable-published",
          client_payload: { tag: manifest.tag, sha: manifest.sha },
        });
    },
  });
  console.log(`${manifest.tag}: ${build.images.api}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Published **${manifest.tag}**.\n\n${imageNames.map((name) => `- ${name}: \`${build.images[name]}\``).join("\n")}\n`,
    );
}

/** The commit a website was last deployed from (its deployment journal). */
async function lastSiteDeployment(github: GitHub, site: Site) {
  for (const record of await github.deployments(`${site}-site`)) {
    const statuses = z
      .array(z.object({ state: z.string() }))
      .parse(await github.request(`/deployments/${record.id}/statuses`));
    if (statuses[0]?.state === "success") return record.sha;
  }
  return undefined;
}

/**
 * What one press of Release ships: the platform when it has release-worthy
 * changes (as a stable promotion of a verified nightly), and each website when
 * its sources changed since its last deployment. Retries keep the platform
 * decision of their first attempt.
 */
async function planRelease(
  github: GitHub,
  graphRoot: string,
  runId: number,
  planPath: string,
) {
  const head = required("GITHUB_SHA");
  const registry = required("IMAGE_REGISTRY");
  const intent = await github.releaseIntent("stable", runId);
  const requested = optional("NIGHTLY_TAG");
  let manifest: Manifest | undefined;
  const baseline = await latestBaseline(github, bootstrap());
  if (intent || requested) {
    manifest = await planProduction(
      github,
      graphRoot,
      intent?.sourceNightly ?? requested,
      registry,
      bootstrap(),
    );
  } else {
    const pending = await collectChanges(github, graphRoot, baseline, head);
    const next = predictedStable(
      baseline.version,
      pending.map((change) => change.title),
      pending.some((change) => change.stableApi),
    );
    if (next.bump !== "none")
      // Throws when the platform changed but no verified nightly carries it.
      manifest = await planProduction(
        github,
        graphRoot,
        undefined,
        registry,
        bootstrap(),
      );
  }
  if (manifest) {
    if (intent) sameManifest(intent, manifest);
    await github.keepReleaseIntent(runId, manifest);
    await savePlan(manifest, planPath);
  }
  const force = process.env.REDEPLOY_WEBSITES === "true";
  const sites: Record<Site, boolean> = { marketing: false, docs: false };
  for (const site of Object.keys(sites) as Site[]) {
    const last = await lastSiteDeployment(github, site);
    sites[site] =
      force ||
      !last ||
      touchesSite(site, await changedPaths(graphRoot, last, head)) ||
      // The website shows the current stable version.
      (site === "marketing" && !!manifest);
  }
  const stableTag = manifest?.tag ?? baseline.tag ?? "";
  const lines = [
    `platform=${!!manifest}`,
    `marketing=${sites.marketing}`,
    `docs=${sites.docs}`,
    `stable_tag=${stableTag}`,
  ];
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      [
        manifest
          ? `Platform: **${manifest.tag}** from \`${manifest.sha}\` (${manifest.sourceNightly}).`
          : `Platform: no release-worthy changes since ${baseline.version}; nothing to publish.`,
        `Marketing website: ${sites.marketing ? "deploy" : "unchanged"}.`,
        `Documentation website: ${sites.docs ? "deploy" : "unchanged"}.`,
        "",
      ].join("\n\n"),
    );
}

try {
  const [command, planPath, sourcePath, ...extra] = process.argv.slice(2);
  if (!command || !planPath || extra.length)
    throw new Error(
      "Usage: bun run release <plan-nightly|plan-release|build|assemble|publish> <plan.json> [source-directory]",
    );
  const graphRoot = resolve(import.meta.dirname, "..");
  const github = new GitHub(
    required("GITHUB_REPOSITORY"),
    required("GH_TOKEN"),
  );
  const runId = Number(required("GITHUB_RUN_ID"));
  if (command === "plan-nightly") {
    const due = await nightlyDue(
      github,
      graphRoot,
      required("GITHUB_SHA"),
      required("GITHUB_REF_NAME"),
      runId,
    );
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `due=${due}\n`);
    if (!due) {
      console.log(
        "The platform has not changed since the newest nightly; skipping.",
      );
      if (process.env.GITHUB_STEP_SUMMARY)
        await appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          "No nightly: the platform has not changed since the newest nightly.\n",
        );
    } else {
      const manifest = await planNightly(
        github,
        graphRoot,
        required("GITHUB_SHA"),
        required("GITHUB_REF_NAME"),
        runId,
        bootstrap(),
      );
      await github.keepReleaseIntent(runId, manifest);
      await savePlan(manifest, planPath);
    }
  } else if (command === "plan-release") {
    if (
      process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    )
      throw new Error(
        "Releases are intentionally dispatched from protected main.",
      );
    await planRelease(github, graphRoot, runId, planPath);
  } else if (command === "build") {
    if (!sourcePath)
      throw new Error("Native build requires a source checkout.");
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(planPath, "utf8")),
    );
    const root = resolve(sourcePath);
    if (
      manifest.repository !== github.repository ||
      (await git(root, "rev-parse", "HEAD")) !== manifest.sha
    )
      throw new Error(
        "Native build source does not match the selected release.",
      );
    const architecture = process.env.BUILD_ARCHITECTURE;
    if (architecture !== "amd64" && architecture !== "arm64")
      throw new Error("BUILD_ARCHITECTURE must be amd64 or arm64.");
    const registry = required("IMAGE_REGISTRY");
    const previousProxyImage = await latestProxy(
      github,
      registry,
      manifest.channel,
    );
    // Older eligible nightlies stamped package.json before invoking Docker.
    // New Dockerfiles stamp only version-sensitive stages, preserving install caches.
    if (
      !(await readFile(resolve(root, "Dockerfile"), "utf8")).includes(
        "bun scripts/inject-release-version.ts",
      )
    )
      await injectVersion(root, manifest.version);
    const images = await buildImages(root, manifest, {
      ...buildConfiguration(registry, previousProxyImage),
      architecture,
    });
    await writeFile(
      required("NATIVE_BUILD_OUTPUT"),
      JSON.stringify({
        architecture,
        manifestHash: fingerprint(manifest),
        previousProxyImage,
        images,
      }),
    );
  } else if (command === "assemble" || command === "publish") {
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(planPath, "utf8")),
    );
    if (manifest.repository !== github.repository)
      throw new Error("Release plan belongs to another repository.");
    if (!sourcePath)
      throw new Error("Publication needs the exact source checkout directory.");
    const run = runSchema.parse(await github.request(`/actions/runs/${runId}`));
    if (manifest.channel === "nightly") {
      assertRun(manifest, run, false);
      if (
        manifest.run.id !== runId ||
        run.head_sha !== manifest.sha ||
        !nightlyEvents.includes(run.event)
      )
        throw new Error(
          "Nightly publication does not belong to this exact triggering run.",
        );
    } else if (
      run.path.split("@")[0] !== ".github/workflows/release.yml" ||
      run.event !== "workflow_dispatch" ||
      run.head_branch !== "main" ||
      (await git(graphRoot, "rev-parse", "HEAD")) !== run.head_sha
    )
      throw new Error(
        "Only the protected Release workflow on main can publish a stable release.",
      );
    if (command === "assemble") {
      const images = await assemble(
        github,
        graphRoot,
        resolve(sourcePath),
        manifest,
      );
      // `images` for publish, `subjects` (repository and digest per image)
      // for signing and attestation.
      if (process.env.GITHUB_OUTPUT)
        await appendFile(
          process.env.GITHUB_OUTPUT,
          `images=${JSON.stringify(images)}\nsubjects=${JSON.stringify(attestationSubjects(images))}\n`,
        );
      console.log(JSON.stringify(images, null, 2));
    } else
      await publish(github, graphRoot, resolve(sourcePath), manifest, runId);
  } else throw new Error(`Unknown release command: ${command}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Release automation failed.",
  );
  if (error instanceof Error && error.cause instanceof Error)
    console.error(error.cause.message);
  process.exitCode = 1;
}
