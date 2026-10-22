import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fingerprint } from "@lictory/core/release/model";
import { GitHubFixture, nightly, stable } from "@lictory/core/release/fixtures.test-helper";
import {
  assertDatabases,
  assertProject,
  matchesDeployment,
  Vercel,
  type VercelConfiguration,
  type VercelDeployment,
} from "@lictory/core/release/vercel";

const config: VercelConfiguration = {
  token: "test",
  orgId: "org",
  projectId: "night-project",
  productionDatabaseHost: "ep-prod.example.test",
  databaseUrl:
    "postgresql://test:test@ep-prod-pooler.example.test/production?sslmode=require",
  directDatabaseUrl:
    "postgresql://test:test@ep-prod.example.test/production?sslmode=require",
  migrationDatabaseUrl:
    "postgresql://owner:test@ep-prod.example.test/production?sslmode=require",
};
const deployed = (candidate = nightly()): VercelDeployment => ({
  id: "dpl_valid",
  projectId: "night-project",
  url: "valid.vercel.app",
  readyState: "READY",
  target: candidate.channel === "nightly" ? null : "production",
  meta: {
    releaseTag: candidate.tag,
    releaseSha: candidate.sha,
    releaseVersion: candidate.version,
    releaseChannel: candidate.channel,
    releaseManifest: fingerprint(candidate),
    releaseRunNumber: String(candidate.run.number),
  },
});

void test("one project supports previews while production retains domain and database validation", () => {
  assertProject(nightly(), config, ["lictory.com", "www.lictory.com"]);
  assertDatabases(nightly(), { ...config, databaseUrl: undefined });
  assertDatabases(stable(), config);
  assert.throws(
    () => assertProject(stable(), config, ["other.example"]),
    /validation/,
  );
  assert.throws(
    () =>
      assertDatabases(stable(), {
        ...config,
        migrationDatabaseUrl: config.migrationDatabaseUrl!.replace(
          "ep-prod",
          "ep-other",
        ),
      }),
    /validation/,
  );
  assert.throws(
    () =>
      assertDatabases(stable(), {
        ...config,
        databaseUrl: config.databaseUrl!.replace(
          "sslmode=require",
          "sslmode=disable",
        ),
      }),
    /validation/,
  );
});

void test("nightly inspection rejects production targets and another project, and promotion is forbidden", async () => {
  let current = deployed();
  const fetcher: typeof fetch = async () => Response.json(current);
  const provider = new Vercel(config, "/tmp", fetcher);
  assert.equal((await provider.inspect(current.id, "nightly")).id, current.id);
  current = { ...current, target: "production" };
  await assert.rejects(provider.inspect(current.id, "nightly"), /environment/);
  current = { ...current, target: null, projectId: "other-project" };
  await assert.rejects(provider.inspect(current.id, "nightly"), /environment/);
  await assert.rejects(
    provider.promote(nightly(), { id: current.id, url: current.url }),
    /cannot be promoted/,
  );
  assert.equal(
    matchesDeployment(nightly(), { ...deployed(), meta: {} }),
    false,
  );
});

void test("production recovery reads the traffic alias, never a staged production target", async () => {
  const current = deployed(stable());
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    ).pathname;
    requests.push(path);
    if (path === "/v4/aliases/lictory.com")
      return Response.json({
        projectId: config.projectId,
        deploymentId: current.id,
      });
    if (path === `/v13/deployments/${current.id}`)
      return Response.json(current);
    throw new Error("Unexpected request to a staged production target");
  };
  assert.equal(
    (await new Vercel(config, "/tmp", fetcher).current())?.id,
    current.id,
  );
  assert.ok(!requests.some((path) => path.startsWith("/v9/projects/")));
});

void test("production rejects downgrade, source reuse, and unpublished activation while allowing exact retries", async () => {
  const candidate = stable();
  const prodConfig = { ...config, projectId: "prod-project" };
  let current = { ...deployed(candidate), projectId: "prod-project" };
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    ).pathname;
    return Response.json(
      path.startsWith("/v4/aliases/")
        ? { projectId: "prod-project", deploymentId: current.id }
        : current,
    );
  };
  const provider = new Vercel(prodConfig, "/tmp", fetcher);
  await provider.assertProductionOrder(candidate);
  current = { ...current, meta: { ...current.meta, releaseVersion: "2.0.0" } };
  await assert.rejects(provider.assertProductionOrder(candidate), /older/);
  current.meta.releaseVersion = "1.5.0";
  current.meta.releaseSha = "c".repeat(40);
  await assert.rejects(provider.assertProductionOrder(candidate), /reuse/);
  current.meta.releaseVersion = "1.4.3";
  await assert.rejects(
    provider.assertProductionOrder(candidate),
    /publication/,
  );
});

void test("manual production intent remains frozen when retries happen after a newer nightly", async () => {
  const fixture = new GitHubFixture();
  const selected = stable();
  await fixture.github.keepReleaseIntent(2000, selected);
  fixture.add(nightly("c".repeat(40), 143));
  const recorded = await fixture.github.releaseIntent("stable", 2000);
  assert.equal(recorded?.sourceNightly, selected.sourceNightly);
  assert.equal(recorded?.sha, selected.sha);
  const writes = fixture.writes.length;
  await fixture.github.keepReleaseIntent(2000, selected);
  assert.equal(fixture.writes.length, writes);
  await assert.rejects(
    fixture.github.keepReleaseIntent(
      2000,
      stable(nightly("c".repeat(40), 143)),
    ),
    /collision/,
  );
});

type Step = {
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency?: { "cancel-in-progress": boolean | string; queue?: string };
  jobs: Record<
    string,
    {
      needs?: string[];
      uses?: string;
      with?: Record<string, string>;
      environment?: string;
      permissions?: Record<string, string>;
      env?: Record<string, string>;
      steps?: Step[];
    }
  >;
};
function workflow(name: string): Workflow {
  const path = new URL(`../../../../.github/workflows/${name}.yml`, import.meta.url)
    .pathname;
  // Bun's built-in parser avoids a new YAML dependency in the application.
  return JSON.parse(
    execFileSync(
      "bun",
      [
        "-e",
        "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))",
        path,
      ],
      { encoding: "utf8" },
    ),
  ) as Workflow;
}

void test("workflow channels, source checkout, secrets, and retained queues remain separated", () => {
  const production = workflow("deploy-production");
  const nightly = workflow("nightly");
  assert.deepEqual(Object.keys(production.on), ["workflow_dispatch"]);
  assert.equal(production.concurrency?.queue, "max");
  assert.equal(production.concurrency?.["cancel-in-progress"], false);
  assert.equal(nightly.concurrency?.queue, "max");
  assert.equal(production.jobs.verify!.uses, "./.github/workflows/ci.yml");
  assert.equal(
    production.jobs.verify!.with?.ref,
    "${{ needs.plan.outputs.sha }}",
  );
  assert.deepEqual(production.jobs.deploy!.needs, ["plan", "verify"]);
  for (const flow of [production, nightly]) {
    const source = flow.jobs.deploy!.steps!.find(
      (step) => step.with?.path === "source",
    );
    assert.equal(source?.with?.ref, "${{ needs.plan.outputs.sha }}");
    assert.equal(
      flow.jobs.plan!.permissions?.contents ?? flow.permissions.contents,
      "read",
    );
    assert.ok(!JSON.stringify(flow.jobs.plan).includes("secrets."));
    assert.equal(flow.jobs.deploy!.permissions?.contents, "write");
  }
  assert.equal(nightly.jobs.deploy!.environment, "Production");
  assert.equal(
    nightly.jobs.deploy!.env?.VERCEL_TOKEN,
    "${{ secrets.VERCEL_TOKEN }}",
  );
  assert.equal(nightly.jobs.deploy!.env?.DATABASE_MIGRATION_URL, undefined);
  assert.equal(nightly.jobs.deploy!.env?.DATABASE_URL, undefined);
  assert.equal(production.jobs.deploy!.environment, "Production");
  assert.equal(nightly.jobs.deploy!.env?.DATABASE_MIGRATION_TARGET, undefined);
  assert.equal(
    production.jobs.deploy!.env?.DATABASE_MIGRATION_TARGET,
    "production",
  );
  assert.ok(!Object.hasOwn(nightly.on, "pull_request"));
});

void test("pushes deploy nightlies without re-verifying; PR and manual CI remain available", () => {
  const ci = workflow("ci");
  const nightly = workflow("nightly");
  const production = workflow("deploy-production");
  assert.deepEqual(Object.keys(ci.on).sort(), [
    "pull_request",
    "workflow_call",
    "workflow_dispatch",
  ]);
  assert.deepEqual(nightly.on.push, { branches: ["main", "release/*"] });
  assert.equal(nightly.jobs.verify, undefined);
  assert.deepEqual(nightly.jobs.deploy!.needs, ["plan"]);
  assert.equal(
    production.jobs.verify!.with?.release_version,
    "${{ needs.plan.outputs.version }}",
  );
});

void test("PR title enforcement never checks out or runs untrusted PR code", () => {
  const title = workflow("pr-title");
  assert.ok(Object.hasOwn(title.on, "pull_request_target"));
  const steps = title.jobs.title!.steps!;
  assert.ok(steps.every((step) => !step.uses?.includes("checkout")));
  assert.match(
    steps[0]!.uses!,
    /^amannn\/action-semantic-pull-request@[a-f0-9]{40}$/,
  );
  assert.equal(title.permissions.contents, "read");
  assert.equal(title.permissions["pull-requests"], "read");
});

void test("the minimal CI verification sequence and package-sourced version display are preserved", async () => {
  const jobs = workflow("ci").jobs;
  assert.deepEqual(Object.keys(jobs), ["verify"]);
  const runs = jobs.verify!.steps!.flatMap((step) =>
    step.run ? [step.run] : [],
  );
  assert.match(runs[0]!, /inject-release-version/);
  assert.deepEqual(runs.slice(1), [
    "bun install --frozen-lockfile",
    "bun run typecheck",
    "bun run db:check",
  ]);
  const config = await readFile(
    new URL("../../../../apps/marketing/next.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(config, /import \{ version \} from "\.\/package\.json"/);
  assert.match(config, /NEXT_PUBLIC_APP_VERSION: version/);
});

void test("nightly CLI builds use Preview settings without production flags or database overrides", async () => {
  const candidate = nightly();
  const commands: string[][] = [];
  const provider = new Vercel(
    config,
    "/tmp",
    async () => Response.json(deployed(candidate)),
    async (args) => {
      commands.push([...args]);
      return "https://valid.vercel.app";
    },
  );
  assert.equal((await provider.build(candidate)).id, "dpl_valid");
  const args = commands[0]!;
  assert.ok(args.includes("--target=preview"));
  assert.ok(!args.includes("--prod"));
  assert.ok(!args.includes("--skip-domain"));
  assert.ok(!args.some((arg) => /DATABASE|BETTER_AUTH_URL|promote/.test(arg)));
  assert.ok(args.includes("LICTORY_RELEASE_CHANNEL=nightly"));
});
