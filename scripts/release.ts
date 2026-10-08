import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  GitHub,
  deploymentPayloadSchema,
  runSchema,
} from "../src/release/github";
import {
  baselineSchema,
  fingerprint,
  manifestSchema,
  sameManifest,
  type Manifest,
} from "../src/release/model";
import { injectVersion } from "../src/release/build";
import { assertRun, planNightly, planProduction } from "../src/release/plan";
import { executeRelease } from "../src/release/pipeline";
import { git } from "../src/release/repository";
import { matchesDeployment, Vercel } from "../src/release/vercel";

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Configure ${name} before running release automation.`);
  return value;
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
async function migrate(root: string, manifest: Manifest) {
  if (manifest.channel !== "stable")
    throw new Error("Preview releases cannot run migrations.");
  const target = "production";
  // Only the dedicated administrative secret reaches the migration runner.
  if (process.env.DATABASE_MIGRATION_TARGET !== target)
    throw new Error("Migration channel does not match release channel.");
  for (const flag of ["--status", ""]) {
    const child = spawn(
      "bun",
      [resolve(root, "scripts", "migrate.ts"), ...(flag ? [flag] : [])],
      {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: "", DATABASE_URL_UNPOOLED: "" },
      },
    );
    const code = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
    if (code)
      throw new Error("Migration failed; deployment activation is blocked.");
  }
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
  const vercel = new Vercel(
    {
      token: required("VERCEL_TOKEN"),
      orgId: required("VERCEL_ORG_ID"),
      projectId: required("VERCEL_PROJECT_ID"),
      bootstrapDeploymentId: process.env.RELEASE_BOOTSTRAP_DEPLOYMENT_ID,
      productionDatabaseHost:
        manifest.channel === "stable"
          ? required("PRODUCTION_DATABASE_HOST")
          : undefined,
      databaseUrl:
        manifest.channel === "stable" ? required("DATABASE_URL") : undefined,
      directDatabaseUrl:
        manifest.channel === "stable"
          ? required("DATABASE_URL_UNPOOLED")
          : undefined,
      migrationDatabaseUrl:
        manifest.channel === "stable"
          ? required("DATABASE_MIGRATION_URL")
          : undefined,
    },
    root,
  );
  const validate = async () => {
    await vercel.validateProject(manifest);
    if (manifest.channel === "stable") {
      const current = await planProduction(
        github,
        graphRoot,
        manifest.sourceNightly!,
        required("VERCEL_PROJECT_ID"),
        bootstrap(),
      );
      sameManifest(current, manifest);
      await vercel.assertProductionOrder(manifest);
    }
  };
  await injectVersion(root, manifest.version);
  const build = await executeRelease(manifest, {
    validate,
    active: async () => {
      if (manifest.channel === "nightly") {
        for (const record of await github.deployments("nightly")) {
          const payload = deploymentPayloadSchema.safeParse(record.payload);
          if (
            !payload.success ||
            record.sha !== manifest.sha ||
            payload.data.manifestHash !== fingerprint(manifest) ||
            payload.data.projectId !== required("VERCEL_PROJECT_ID")
          )
            continue;
          const preview = await vercel.inspect(
            payload.data.vercelId,
            "nightly",
          );
          if (!matchesDeployment(manifest, preview))
            throw new Error("Preview journal source mismatch.");
          return { id: preview.id, url: `https://${preview.url}` };
        }
        return undefined;
      }
      const current = await vercel.current();
      if (!current || !matchesDeployment(manifest, current)) return undefined;
      const records = await github.deployments(
        manifest.channel === "stable" ? "production" : "nightly",
      );
      if (
        !records.some((record) => {
          const payload = deploymentPayloadSchema.safeParse(record.payload);
          return (
            record.sha === manifest.sha &&
            payload.success &&
            payload.data.manifestHash === fingerprint(manifest) &&
            payload.data.vercelId === current.id
          );
        })
      )
        throw new Error(
          "Active build lacks the deployment journal needed for safe recovery.",
        );
      return { id: current.id, url: `https://${current.url}` };
    },
    build: () => vercel.build(manifest),
    record: async (build) =>
      (
        await github.recordDeployment(manifest, {
          runId,
          projectId: required("VERCEL_PROJECT_ID"),
          vercelId: build.id,
          url: build.url,
        })
      ).id,
    status: (id, state, build) =>
      github.deploymentStatus(id, state, build.url, runId),
    migrate: () => migrate(root, manifest),
    reserve: async () => {
      await github.reserve(manifest);
    },
    promote: (build) => vercel.promote(manifest, build),
    publish: async () => {
      await github.publish(manifest);
      if (manifest.channel === "stable")
        await github.request("/dispatches", "POST", {
          event_type: "stable-published",
          client_payload: { tag: manifest.tag, sha: manifest.sha },
        });
    },
  });
  console.log(`${manifest.tag}: ${build.url}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Published **${manifest.tag}**. [Immutable deployment](${build.url}).\n`,
    );
}

try {
  const [command, planPath, sourcePath, ...extra] = process.argv.slice(2);
  if (!command || !planPath || extra.length)
    throw new Error(
      "Usage: bun run release <plan-nightly|plan-production|deploy> <plan.json> [source-directory]",
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
      required("VERCEL_PROJECT_ID"),
      bootstrap(),
    );
    if (intent) sameManifest(intent, manifest);
    if (process.env.GITHUB_WORKFLOW === "Release to Production")
      await github.keepReleaseIntent(runId, manifest);
    await savePlan(manifest, planPath);
  } else if (command === "deploy") {
    if (!sourcePath)
      throw new Error("Deployment needs the exact source checkout directory.");
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(planPath, "utf8")),
    );
    if (manifest.repository !== github.repository)
      throw new Error("Release plan belongs to another repository.");
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
        run.path.split("@")[0] !== ".github/workflows/deploy-production.yml" ||
        run.event !== "workflow_dispatch" ||
        run.head_branch !== "main" ||
        (await git(graphRoot, "rev-parse", "HEAD")) !== run.head_sha
      )
        throw new Error(
          "Only the protected Release to Production workflow can activate production.",
        );
    }
    await deploy(github, graphRoot, resolve(sourcePath), manifest, runId);
  } else throw new Error(`Unknown release command: ${command}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Release automation failed.",
  );
  if (error instanceof Error && error.cause instanceof Error)
    console.error(error.cause.message);
  process.exitCode = 1;
}
