import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fingerprint } from "./model";
import { GitHubFixture, nightly, stable } from "./fixtures.test-helper";
import {
  assertDatabases,
  assertProject,
  matchesDeployment,
  mayAdvanceNightly,
  Vercel,
  type VercelConfiguration,
  type VercelDeployment,
} from "./vercel";

const config: VercelConfiguration = {
  token: "test",
  orgId: "org",
  projectId: "night-project",
  nightlyProjectId: "night-project",
  productionProjectId: "prod-project",
  nightlyDatabaseHost: "ep-night.example.test",
  productionDatabaseHost: "ep-prod.example.test",
  databaseUrl:
    "postgresql://test:test@ep-night-pooler.example.test/nightly?sslmode=require",
  directDatabaseUrl:
    "postgresql://test:test@ep-night.example.test/nightly?sslmode=require",
  migrationDatabaseUrl:
    "postgresql://owner:test@ep-night.example.test/nightly?sslmode=require",
};
const deployed = (candidate = nightly()): VercelDeployment => ({
  id: "dpl_valid",
  projectId: "night-project",
  url: "valid.vercel.app",
  readyState: "READY",
  target: "production",
  meta: {
    releaseTag: candidate.tag,
    releaseSha: candidate.sha,
    releaseVersion: candidate.version,
    releaseChannel: candidate.channel,
    releaseManifest: fingerprint(candidate),
    releaseRunNumber: String(candidate.run.number),
  },
});

void test("nightly domain and database guards reject production configuration", () => {
  assertProject(nightly(), config, ["nightly.lictory.com"]);
  assertDatabases(nightly(), config);
  assert.throws(
    () =>
      assertProject(nightly(), { ...config, projectId: "prod-project" }, [
        "lictory.com",
      ]),
    /isolation/,
  );
  assert.throws(
    () =>
      assertProject(nightly(), config, ["nightly.lictory.com", "lictory.com"]),
    /isolation/,
  );
  assert.throws(
    () =>
      assertProject(
        nightly(),
        { ...config, nightlyProjectId: "prod-project" },
        ["nightly.lictory.com"],
      ),
    /distinct/,
  );
  assert.throws(
    () =>
      assertDatabases(nightly(), {
        ...config,
        databaseUrl: config.databaseUrl.replace("ep-night", "ep-prod"),
      }),
    /isolation/,
  );
  assert.throws(
    () =>
      assertDatabases(nightly(), {
        ...config,
        migrationDatabaseUrl: config.migrationDatabaseUrl.replace(
          "ep-night",
          "ep-prod",
        ),
      }),
    /isolation/,
  );
});

void test("out-of-order runs and maintenance branches never regress the shared nightly alias", () => {
  const candidate = nightly();
  assert.equal(
    mayAdvanceNightly(candidate, deployed(nightly(candidate.sha, 141)), true),
    true,
  );
  assert.equal(
    mayAdvanceNightly(candidate, deployed(nightly(candidate.sha, 143)), true),
    false,
  );
  assert.equal(
    mayAdvanceNightly(candidate, deployed(nightly(candidate.sha, 141)), false),
    false,
  );
  assert.equal(
    mayAdvanceNightly(
      { ...candidate, sourceBranch: "release/1.4" },
      undefined,
      true,
    ),
    false,
  );
  assert.throws(
    () => mayAdvanceNightly(candidate, { ...deployed(), meta: {} }, true),
    /untracked/,
  );
  assert.equal(
    matchesDeployment(candidate, {
      ...deployed(candidate),
      meta: {
        ...deployed(candidate).meta,
        releaseVersion: candidate.stableVersion,
      },
    }),
    false,
  );
});

void test("activation recovery reads the traffic alias, never a staged production target", async () => {
  const current = deployed();
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
    if (path === "/v4/aliases/nightly.lictory.com")
      return Response.json({
        projectId: "night-project",
        deploymentId: current.id,
      });
    if (path === `/v13/deployments/${current.id}`)
      return Response.json(current);
    throw new Error("Unexpected request to a staged production target");
  };
  assert.equal(
    (await new Vercel(config, "/tmp", "/tmp", fetcher).current())?.id,
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
  const provider = new Vercel(prodConfig, "/tmp", "/tmp", fetcher);
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
  const path = new URL(`../../.github/workflows/${name}.yml`, import.meta.url)
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
  for (const flow of [production, nightly]) {
    assert.equal(flow.jobs.verify!.uses, "./.github/workflows/ci.yml");
    assert.equal(flow.jobs.verify!.with?.ref, "${{ needs.plan.outputs.sha }}");
    assert.deepEqual(flow.jobs.deploy!.needs, ["plan", "verify"]);
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
  assert.equal(nightly.jobs.deploy!.environment, "nightly");
  assert.equal(
    nightly.jobs.deploy!.env?.VERCEL_TOKEN,
    "${{ secrets.NIGHTLY_VERCEL_TOKEN }}",
  );
  assert.equal(
    nightly.jobs.deploy!.env?.DATABASE_MIGRATION_URL,
    "${{ secrets.NIGHTLY_DATABASE_MIGRATION_URL }}",
  );
  assert.equal(production.jobs.deploy!.environment, "production");
  assert.equal(nightly.jobs.deploy!.env?.DATABASE_MIGRATION_TARGET, "nightly");
  assert.equal(
    production.jobs.deploy!.env?.DATABASE_MIGRATION_TARGET,
    "production",
  );
  assert.ok(!Object.hasOwn(nightly.on, "pull_request"));
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

void test("the complete CI verification sequence and package-sourced version display are preserved", async () => {
  const runs = workflow("ci").jobs.verify!.steps!.flatMap((step) =>
    step.run ? [step.run] : [],
  );
  assert.deepEqual(runs.slice(1), [
    "bun install --frozen-lockfile",
    "bun audit --audit-level=high",
    "bun run check",
    "bun run db:check",
    "bun run db:migrate",
    "bun test src",
    "bunx playwright install --with-deps chromium",
    "bun run test:e2e",
  ]);
  const config = await readFile(
    new URL("../../next.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(config, /import \{ version \} from "\.\/package\.json"/);
  assert.match(config, /NEXT_PUBLIC_APP_VERSION: version/);
});
