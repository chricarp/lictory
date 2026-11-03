import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
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
import { nightlyEvents } from "@lictory/core/release/plan";
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
      name?: string;
      if?: string;
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
  return yaml(`.github/workflows/${name}.yml`) as Workflow;
}
function compositeAction(name: string): { runs: { steps: Step[] } } {
  return yaml(`.github/actions/${name}/action.yml`) as {
    runs: { steps: Step[] };
  };
}
function yaml(file: string): unknown {
  const path = new URL(`../../../../${file}`, import.meta.url).pathname;
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
  ) as unknown;
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

void test("nightlies are scheduled, fully verified before publication and built for both architectures", () => {
  const ci = workflow("ci");
  const nightly = workflow("nightly");
  const production = workflow("deploy-production");
  assert.deepEqual(Object.keys(ci.on).sort(), [
    "pull_request",
    "workflow_call",
    "workflow_dispatch",
  ]);
  assert.deepEqual(Object.keys(nightly.on).sort(), [
    "push",
    "repository_dispatch",
    "schedule",
    "workflow_dispatch",
  ]);
  // Every way a nightly starts is accepted as its provenance when it is
  // published and later promoted.
  for (const event of Object.keys(nightly.on))
    assert.ok(nightlyEvents.includes(event), event);
  // main gets one candidate a day; maintenance branches release every fix.
  assert.deepEqual(nightly.on.push, { branches: ["release/*"] });
  // Nothing is published unless every browser workflow passed on the exact
  // candidate source with its embedded version.
  const verify = nightly.jobs.verify!;
  assert.equal(verify.uses, "./.github/workflows/ci.yml");
  assert.equal(verify.with?.ref, "${{ needs.plan.outputs.sha }}");
  assert.equal(
    verify.with?.release_version,
    "${{ needs.plan.outputs.version }}",
  );
  assert.equal(verify.with?.suite, "full");
  assert.deepEqual(nightly.jobs.deploy!.needs, ["plan", "verify", "build"]);
  assert.deepEqual(nightly.jobs.stage!.needs, ["plan", "deploy"]);
  // Days without merges publish nothing.
  for (const job of ["verify", "build"])
    assert.equal(
      nightly.jobs[job]!.if,
      "needs.plan.outputs.due == 'true'",
      job,
    );
  for (const flow of [nightly, production]) {
    const matrix = (
      flow.jobs.build as { strategy?: { matrix?: { include?: unknown[] } } }
    ).strategy?.matrix?.include as { architecture: string }[];
    assert.deepEqual(
      matrix.map((entry) => entry.architecture),
      ["amd64", "arm64"],
    );
  }
  assert.equal(
    production.jobs.verify!.with?.release_version,
    "${{ needs.plan.outputs.version }}",
  );
});

void test("only release managers can start a stable release", () => {
  const production = workflow("deploy-production");
  const authorize = production.jobs.authorize!;
  assert.equal(production.jobs.plan!.needs, "authorize");
  assert.deepEqual(authorize.permissions, {});
  assert.equal(
    authorize.env?.MANAGERS,
    "${{ vars.RELEASE_MANAGERS || github.repository_owner }}",
  );
  // The person who clicked (also on a re-run), not the original dispatcher.
  assert.equal(authorize.env?.ACTOR, "${{ github.triggering_actor }}");
  const script = authorize.steps![0]!.run!;
  assert.match(script, /refs\/heads\/main/);
  assert.ok(!JSON.stringify(authorize).includes("secrets."));
  // Every other job waits for the gate, directly or through its needs.
  const needs = (name: string): string[] => {
    const direct = production.jobs[name]!.needs ?? [];
    const list = typeof direct === "string" ? [direct] : direct;
    return [...list, ...list.flatMap(needs)];
  };
  for (const name of Object.keys(production.jobs))
    if (name !== "authorize")
      assert.ok(needs(name).includes("authorize"), name);
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

void test("third-party actions are pinned to commits", async () => {
  // Every workflow, including ones added later.
  const names = (
    await readdir(new URL("../../../../.github/workflows/", import.meta.url))
  )
    .filter((file) => file.endsWith(".yml"))
    .map((file) => file.slice(0, -4));
  assert.ok(names.includes("nightly") && names.includes("ci"));
  for (const name of names)
    for (const job of Object.values(workflow(name).jobs))
      for (const step of job.steps ?? [])
        if (step.uses && !step.uses.startsWith("./"))
          assert.match(step.uses, /@[a-f0-9]{40}$/, `${name}: ${step.uses}`);
  for (const name of ["setup", "services"])
    for (const step of compositeAction(name).runs.steps)
      if (step.uses)
        assert.match(step.uses, /@[a-f0-9]{40}$/, `${name}: ${step.uses}`);
});

void test("base images are pinned by digest", async () => {
  const root = new URL("../../../../", import.meta.url);
  const references: string[] = [];
  const dockerfile = await readFile(new URL("Dockerfile", root), "utf8");
  for (const [, image] of dockerfile.matchAll(
    /^FROM\s+(?:--platform=\S+\s+)?(\S+)/gm,
  ))
    references.push(image!);
  for (const file of [
    "compose.yaml",
    "deploy/compose.production.yaml",
    "deploy/compose.restore-drill.yaml",
  ]) {
    const compose = await readFile(new URL(file, root), "utf8");
    for (const [, image] of compose.matchAll(/^\s+image:\s*(\S+)/gm))
      references.push(image!);
  }
  // Exempt: earlier stages, release images (deployed by digest) and the
  // previous proxy image chosen by release automation.
  const stages = new Set(
    [...dockerfile.matchAll(/\sAS\s+(\S+)$/gm)].map(([, stage]) => stage!),
  );
  const external = references.filter(
    (image) => !stages.has(image) && !/^\$\{[A-Z_]+(:\?)?\}$/.test(image),
  );
  assert.ok(external.length >= 8);
  for (const image of external)
    assert.match(
      image,
      /^(\$\{[A-Z_]+:-)?[\w./-]+:[\w.-]+@sha256:[a-f0-9]{64}\}?$/,
      image,
    );
});

void test("pull requests get layered checks behind one required Verify gate", () => {
  const ci = workflow("ci");
  const jobs = ci.jobs;
  assert.deepEqual(Object.keys(jobs), [
    "changes",
    "static",
    "domain",
    "browser",
    "verify",
  ]);
  const runs = (job: string) =>
    jobs[job]!.steps!.flatMap((step) => (step.run ? [step.run] : []));
  assert.ok(runs("static").includes("bun run check"));
  assert.ok(runs("static").includes("bun run db:check"));
  assert.ok(runs("domain").includes("bun run db:migrate"));
  assert.ok(runs("domain").includes("bun test src"));
  assert.ok(runs("browser").some((run) => run.includes("--grep @smoke")));
  // Static checks are never skipped; the gate waits for every job and
  // accepts only success or a deliberate skip.
  assert.equal(jobs.static!.if, undefined);
  assert.deepEqual(jobs.verify!.needs, [
    "changes",
    "static",
    "domain",
    "browser",
  ]);
  assert.equal(jobs.verify!.if, "always()");
  assert.equal(
    jobs.verify!.name,
    "Verify",
    "branch protection requires the Verify check",
  );
  // Release candidates embed their version in every job that builds.
  for (const job of ["static", "domain", "browser"])
    assert.ok(
      jobs[job]!.steps!.some(
        (step) =>
          step.uses === "./.github/actions/setup" &&
          step.with?.["release-version"] === "${{ inputs.release_version }}",
      ),
      job,
    );
  assert.match(
    JSON.stringify(compositeAction("setup")),
    /inject-release-version/,
  );
  // CI never holds credentials beyond its read-only token.
  assert.ok(!JSON.stringify(ci).includes("secrets."));
  assert.equal(ci.permissions.contents, "read");
});

void test("pull request suite selection fails open", () => {
  const select = (...paths: string[]) =>
    Object.fromEntries(
      execFileSync("bash", [".github/scripts/ci-changes.sh"], {
        cwd: new URL("../../../../", import.meta.url).pathname,
        input: paths.join("\n"),
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    ) as Record<string, string>;
  const none = { unit: "false", e2e: "false", audit: "false" };
  assert.deepEqual(select("README.md", "docs/operations/releases.md"), none);
  assert.deepEqual(select("apps/docs/content/docs/index.mdx"), none);
  assert.deepEqual(select("deploy/deploy.sh"), { ...none, unit: "true" });
  for (const path of [
    "apps/platform/src/main.tsx",
    "apps/marketing/src/content/guide.md",
    "packages/core/src/domain/approval.ts",
    "tests/platform/sync.spec.ts",
    "drizzle/0042_change.sql",
    ".github/workflows/ci.yml",
    "an/unknown/path",
  ])
    assert.deepEqual(
      select("README.md", path),
      { ...none, unit: "true", e2e: "true" },
      path,
    );
  assert.equal(select("bun.lock").audit, "true");
});

void test("the released version display is preserved", async () => {
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
