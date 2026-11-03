import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  GitHubFixture,
  images,
  nightly,
  registry,
  stable,
} from "@lictory/core/release/fixtures.test-helper";
import {
  assertImages,
  bakeEnvironment,
  imagesFromBakeMetadata,
  imagesId,
  releaseFile,
} from "@lictory/core/release/images";
import {
  Server,
  sshRemote,
  type Environment,
  type ServerStatus,
} from "@lictory/core/release/server";

function fakeServer(
  environment: Environment,
  initial: ServerStatus | { version: null },
  published: (version: string, sha: string) => Promise<boolean> = async () =>
    false,
) {
  let status: ServerStatus = { environment, ...initial };
  const calls: string[] = [];
  const inputs: string[] = [];
  const server = new Server(
    { environment, registry },
    async (args, input) => {
      calls.push(args.join(" "));
      if (input) inputs.push(input);
      if (args[1] === "status") return JSON.stringify(status);
      if (args[1] === "prepare")
        return `${input?.match(/^LICTORY_VERSION=(.*)$/m)?.[1]}\n`;
      return "";
    },
    published,
  );
  return {
    server,
    calls,
    inputs,
    set: (next: Partial<ServerStatus>) => {
      status = { ...status, ...next };
    },
  };
}
const running = (candidate = stable(), set = images("b")): ServerStatus => ({
  environment: "production",
  version: candidate.version,
  sha: candidate.sha,
  channel: candidate.channel,
  images: set,
  healthy: true,
});

void test("production moves forward only and accepts exact retries and a first launch", async () => {
  const candidate = stable();
  await fakeServer("production", { version: null }).server.assertOrder(
    candidate,
  );
  await fakeServer("production", running(candidate)).server.assertOrder(
    candidate,
  );
  const baseline = {
    ...running(candidate),
    version: candidate.baseline.version,
    sha: candidate.baseline.sha,
  };
  await fakeServer("production", baseline).server.assertOrder(candidate);
  await assert.rejects(
    fakeServer("production", {
      ...baseline,
      version: "2.0.0",
    }).server.assertOrder(candidate),
    /older/,
  );
  await assert.rejects(
    fakeServer("production", {
      ...running(candidate),
      sha: "c".repeat(40),
    }).server.assertOrder(candidate),
    /reuse/,
  );
  await assert.rejects(
    fakeServer("production", {
      ...baseline,
      version: "1.4.3",
    }).server.assertOrder(candidate),
    /publication/,
  );
  await assert.rejects(
    fakeServer("production", {
      ...baseline,
      channel: "nightly",
    }).server.assertOrder(candidate),
    /non-stable/,
  );
  // An operator rollback to an older published release does not block.
  const rolledBack = { ...baseline, version: "1.4.1", sha: "d".repeat(40) };
  await fakeServer(
    "production",
    rolledBack,
    async (version, sha) => version === "1.4.1" && sha === "d".repeat(40),
  ).server.assertOrder(candidate);
  await assert.rejects(
    fakeServer("production", rolledBack).server.assertOrder(candidate),
    /publication/,
  );
});

void test("production runs only stable images and staging only nightlies", async () => {
  const production = fakeServer("production", { version: null });
  await assert.rejects(
    production.server.prepare(nightly(), images()),
    /only runs stable/,
  );
  await assert.rejects(
    production.server.migrate(nightly()),
    /only runs stable/,
  );
  const staging = fakeServer("staging", { version: null });
  await assert.rejects(
    staging.server.prepare(stable(), images()),
    /only runs nightly/,
  );
  await staging.server.prepare(nightly(), images());
  assert.deepEqual(staging.calls, ["staging prepare"]);
  assert.match(staging.inputs[0]!, /^LICTORY_CHANNEL=nightly$/m);
});

void test("activation is proven by the server reporting the exact release and digests", async () => {
  const candidate = stable();
  const build = {
    id: imagesId(images("b")),
    url: "https://app.lictory.com",
    images: images("b"),
  };
  const fixture = fakeServer("production", { version: null });
  const remote = fixture.server;
  await assert.rejects(remote.activate(candidate, build), /did not activate/);
  fixture.set(running(candidate, images("c")));
  await assert.rejects(remote.activate(candidate, build), /did not activate/);
  fixture.set({ ...running(candidate), healthy: false });
  await assert.rejects(remote.activate(candidate, build), /did not activate/);
  fixture.set(running(candidate));
  await remote.activate(candidate, build);
  assert.ok(fixture.calls.includes(`production activate ${candidate.version}`));
});

void test("releases are pinned by digest in the configured registry", () => {
  assert.deepEqual(assertImages(images(), registry), images());
  assert.throws(
    () =>
      assertImages(
        { ...images(), api: `${registry}/lictory-api:1.5.0` },
        registry,
      ),
    /not a digest/,
  );
  assert.throws(
    () => assertImages(images("a", "ghcr.io/other"), registry),
    /not a digest/,
  );
  const metadata = Object.fromEntries(
    Object.entries(images()).map(([name, reference]) => [
      name,
      {
        "containerimage.digest": reference.split("@")[1],
        "image.name": `${registry}/lictory-${name}:1.5.0,${registry}/lictory-${name}:sha-x-stable`,
      },
    ]),
  );
  assert.deepEqual(imagesFromBakeMetadata(metadata, registry), images());
  assert.throws(
    () => imagesFromBakeMetadata({ ...metadata, ops: undefined }, registry),
    /ops/,
  );
  assert.throws(
    () =>
      imagesFromBakeMetadata(
        {
          ...metadata,
          api: { ...metadata.api!, "image.name": "docker.io/x/lictory-api:1" },
        },
        registry,
      ),
    /unexpected repository/,
  );
  const file = releaseFile(stable(), images());
  assert.match(file, /^LICTORY_VERSION=1\.5\.0$/m);
  assert.match(file, /^LICTORY_CHANNEL=stable$/m);
  assert.equal(file.trim().split("\n").length, 8);
});

void test("builds embed the release version and no installation origins", () => {
  const config = {
    registry,
    sourceUrl: "https://github.com/example/lictory",
  };
  const environment = bakeEnvironment(stable(), config);
  assert.equal(environment.VERSION, "1.5.0");
  assert.equal(environment.CHANNEL, "stable");
  assert.equal(environment.PREVIOUS_PROXY_IMAGE, "no-previous-assets");
  assert.equal(environment.VERSION, bakeEnvironment(stable(), config).VERSION);
  assert.match(bakeEnvironment(nightly(), config).VERSION!, /-nightly\./);
  // Domains and analytics are runtime settings: one image runs anywhere.
  for (const name of ["SITE_URL", "PLATFORM_URL", "POSTHOG_PROJECT_TOKEN"])
    assert.equal(environment[name], undefined);
  assert.throws(
    () =>
      bakeEnvironment(stable(), { ...config, previousProxyImage: "caddy:2" }),
    /not a digest/,
  );
  assert.throws(() => sshRemote("deploy@host; rm -rf /"), /DEPLOY_SSH_TARGET/);
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
  const path = new URL(
    `../../../../.github/workflows/${name}.yml`,
    import.meta.url,
  ).pathname;
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
  assert.deepEqual(production.jobs.deploy!.needs, ["plan", "verify", "build"]);
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
    assert.equal(flow.jobs.deploy!.permissions?.packages, "write");
  }
  // Databases are only reachable on the server; no workflow holds a database URL.
  for (const name of ["deploy-production", "nightly", "migrate", "backfill"])
    assert.ok(!JSON.stringify(workflow(name)).includes("DATABASE_"), name);
  // Nightly images are built without any deployment credential.
  assert.equal(nightly.jobs.deploy!.environment, undefined);
  assert.ok(!JSON.stringify(nightly.jobs.deploy).includes("secrets."));
  assert.equal(nightly.jobs.stage!.environment, "staging");
  assert.equal(production.jobs.deploy!.environment, "Production");
  assert.ok(
    JSON.stringify(production.jobs.deploy).includes("secrets.DEPLOY_SSH_KEY"),
  );
  assert.ok(!Object.hasOwn(nightly.on, "pull_request"));
});

void test("pushes build nightlies without re-verifying; PR and manual CI remain available", () => {
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
  assert.deepEqual(nightly.jobs.build!.needs, ["plan"]);
  assert.deepEqual(nightly.jobs.deploy!.needs, ["plan", "build"]);
  assert.deepEqual(nightly.jobs.stage!.needs, ["plan", "deploy"]);
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

void test("third-party actions are pinned to commits", () => {
  for (const name of [
    "ci",
    "nightly",
    "deploy-production",
    "migrate",
    "backfill",
    "pr-title",
  ])
    for (const job of Object.values(workflow(name).jobs))
      for (const step of job.steps ?? [])
        if (step.uses && !step.uses.startsWith("./"))
          assert.match(step.uses, /@[a-f0-9]{40}$/, `${name}: ${step.uses}`);
});

void test("the minimal CI verification sequence and the released version display are preserved", async () => {
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
  // The SPA account menu and the website show the release version.
  const root = new URL("../../../../", import.meta.url);
  const dockerfile = await readFile(new URL("Dockerfile", root), "utf8");
  const bake = await readFile(new URL("deploy/docker-bake.hcl", root), "utf8");
  assert.match(bake, /APP_VERSION\s*=\s*VERSION/);
  assert.match(dockerfile, /VITE_APP_VERSION=\$APP_VERSION/);
  assert.match(dockerfile, /NEXT_PUBLIC_APP_VERSION=\$APP_VERSION/);
  // The platform bundle reads its origins and analytics at runtime.
  assert.doesNotMatch(dockerfile, /VITE_SITE_URL|VITE_POSTHOG/);
});
