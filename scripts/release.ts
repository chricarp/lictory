import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  GitHub,
  deploymentPayloadSchema,
  runSchema,
} from "@lictory/core/release/github";
import {
  assertImages,
  buildImages,
  imageNames,
  imagesId,
  type BuildConfiguration,
} from "@lictory/core/release/images";
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
  planNightly,
  planProduction,
} from "@lictory/core/release/plan";
import { executeRelease, type Build } from "@lictory/core/release/pipeline";
import { git } from "@lictory/core/release/repository";
import {
  matchesRelease,
  Server,
  sshRemote,
  type Environment,
} from "@lictory/core/release/server";

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
function server(environment: Environment, registry: string) {
  return new Server(
    { environment, registry },
    sshRemote(required("DEPLOY_SSH_TARGET"), {
      knownHostsFile: optional("DEPLOY_SSH_KNOWN_HOSTS_FILE"),
      identityFile: optional("DEPLOY_SSH_KEY_FILE"),
    }),
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

async function latestNightlyProxy(github: GitHub, registry: string) {
  const records = await github.deployments("nightly");
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
    siteUrl: required("SITE_URL"),
    platformUrl: required("PLATFORM_URL"),
    sourceUrl: `https://github.com/${required("GITHUB_REPOSITORY")}`,
    posthogProjectToken: optional("POSTHOG_PROJECT_TOKEN"),
    posthogHost: optional("POSTHOG_HOST"),
    legal: {
      name: optional("LICTORY_LEGAL_NAME"),
      address: optional("LICTORY_LEGAL_ADDRESS"),
      email: optional("LICTORY_LEGAL_EMAIL"),
      registration: optional("LICTORY_LEGAL_REGISTRATION"),
    },
    previousProxyImage,
    cacheRegistry: optional("IMAGE_CACHE_REGISTRY"),
  };
}

async function deploy(
  github: GitHub,
  graphRoot: string,
  root: string,
  manifest: Manifest,
  runId: number,
) {
  if ((await git(root, "rev-parse", "HEAD")) !== manifest.sha)
    throw new Error("Source checkout is not the selected release commit.");
  const registry = required("IMAGE_REGISTRY");
  const production =
    manifest.channel === "stable" ? server("production", registry) : undefined;
  const validate = async () => {
    if (!production) return;
    const current = await planProduction(
      github,
      graphRoot,
      manifest.sourceNightly!,
      registry,
      bootstrap(),
    );
    sameManifest(current, manifest);
    await production.assertOrder(manifest);
  };
  await injectVersion(root, manifest.version);
  const build = await executeRelease(manifest, {
    validate,
    active: async () => {
      const journaled = await journaledBuild(github, manifest, registry);
      if (!production) return journaled;
      const status = await production.status();
      if (!status.version || !matchesRelease(manifest, status))
        return undefined;
      if (
        !journaled ||
        imageNames.some(
          (name) => status.images?.[name] !== journaled.images[name],
        )
      )
        throw new Error(
          "Active release lacks the deployment journal needed for safe recovery.",
        );
      return journaled;
    },
    build: async () => {
      const previousProxyImage = production
        ? (await production.status()).images?.proxy
        : await latestNightlyProxy(github, registry);
      const images = await buildImages(
        root,
        manifest,
        buildConfiguration(registry, previousProxyImage),
      );
      return { id: imagesId(images), url: required("PLATFORM_URL"), images };
    },
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
    migrate: async (build) => {
      if (!production)
        throw new Error("Nightly releases never migrate production.");
      await production.prepare(manifest, build.images);
      await production.migrate(manifest);
    },
    reserve: async () => {
      await github.reserve(manifest);
    },
    promote: async (build) => {
      if (!production)
        throw new Error("Nightly images cannot be activated in production.");
      await production.activate(manifest, build);
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

// Optional: runs a published nightly on the staging server (migrations included).
async function stage(github: GitHub, manifest: Manifest) {
  if (manifest.channel !== "nightly")
    throw new Error("Only nightlies are staged.");
  const registry = required("IMAGE_REGISTRY");
  const build = await journaledBuild(github, manifest, registry);
  if (!build) throw new Error(`${manifest.tag} has no journaled image build.`);
  const staging = server("staging", registry);
  await staging.prepare(manifest, build.images);
  await staging.migrate(manifest);
  await staging.activate(manifest, build);
  console.log(`${manifest.tag} is active on staging.`);
}

try {
  const [command, planPath, sourcePath, ...extra] = process.argv.slice(2);
  if (!command || !planPath || extra.length)
    throw new Error(
      "Usage: bun run release <plan-nightly|plan-production|deploy|stage> <plan.json> [source-directory]",
    );
  const graphRoot = resolve(import.meta.dirname, "..");
  const github = new GitHub(
    required("GITHUB_REPOSITORY"),
    required("GH_TOKEN"),
  );
  const runId = Number(required("GITHUB_RUN_ID"));
  if (command === "plan-nightly") {
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
  } else if (command === "plan-production") {
    if (
      process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    )
      throw new Error(
        "Production must be intentionally dispatched from protected main.",
      );
    const intent =
      process.env.GITHUB_WORKFLOW === "Release to Production"
        ? await github.releaseIntent("stable", runId)
        : undefined;
    const manifest = await planProduction(
      github,
      graphRoot,
      intent?.sourceNightly ??
        (process.env.NIGHTLY_TAG?.trim()
          ? process.env.NIGHTLY_TAG.trim()
          : undefined),
      required("IMAGE_REGISTRY"),
      bootstrap(),
    );
    if (intent) sameManifest(intent, manifest);
    if (process.env.GITHUB_WORKFLOW === "Release to Production")
      await github.keepReleaseIntent(runId, manifest);
    await savePlan(manifest, planPath);
  } else if (command === "deploy" || command === "stage") {
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(planPath, "utf8")),
    );
    if (manifest.repository !== github.repository)
      throw new Error("Release plan belongs to another repository.");
    if (command === "stage") {
      await stage(github, manifest);
    } else {
      if (!sourcePath)
        throw new Error(
          "Deployment needs the exact source checkout directory.",
        );
      if (
        manifest.channel === "stable" &&
        (process.env.GITHUB_REF !== "refs/heads/main" ||
          process.env.GITHUB_EVENT_NAME !== "workflow_dispatch")
      )
        throw new Error(
          "Only Release to Production on main can access production activation.",
        );
      if (manifest.channel === "nightly") {
        const run = runSchema.parse(
          await github.request(`/actions/runs/${runId}`),
        );
        assertRun(manifest, run, false);
        if (
          manifest.run.id !== runId ||
          run.head_sha !== manifest.sha ||
          !["push", "repository_dispatch"].includes(run.event)
        )
          throw new Error(
            "Nightly deployment does not belong to this exact triggering run.",
          );
      }
      if (manifest.channel === "stable") {
        const run = runSchema.parse(
          await github.request(`/actions/runs/${runId}`),
        );
        if (
          run.path.split("@")[0] !==
            ".github/workflows/deploy-production.yml" ||
          run.event !== "workflow_dispatch" ||
          run.head_branch !== "main" ||
          (await git(graphRoot, "rev-parse", "HEAD")) !== run.head_sha
        )
          throw new Error(
            "Only the protected Release to Production workflow can activate production.",
          );
      }
      await deploy(github, graphRoot, resolve(sourcePath), manifest, runId);
    }
  } else throw new Error(`Unknown release command: ${command}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Release automation failed.",
  );
  if (error instanceof Error && error.cause instanceof Error)
    console.error(error.cause.message);
  process.exitCode = 1;
}
