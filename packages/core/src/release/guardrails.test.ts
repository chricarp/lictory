import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  releaseFile,
} from "@lictory/core/release/images";
import { nightlyEvents } from "@lictory/core/release/plan";

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
      if?: string;
      uses?: string;
      secrets?: "inherit" | Record<string, string>;
      with?: Record<string, string>;
      environment?: string | { name: string; url?: string };
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

void test("releases publish from the exact candidate source and hold no deployment credential", () => {
  const release = workflow("release");
  const nightly = workflow("nightly");
  assert.deepEqual(Object.keys(release.on), ["workflow_dispatch"]);
  assert.equal(release.concurrency?.queue, "max");
  assert.equal(release.concurrency?.["cancel-in-progress"], false);
  assert.equal(nightly.concurrency?.queue, "max");
  assert.equal(release.jobs.verify!.uses, "./.github/workflows/ci.yml");
  assert.equal(release.jobs.verify!.with?.ref, "${{ needs.plan.outputs.sha }}");
  assert.deepEqual(release.jobs.publish!.needs, ["plan", "verify", "build"]);
  for (const flow of [release, nightly]) {
    const source = flow.jobs.publish!.steps!.find(
      (step) => step.with?.path === "source",
    );
    assert.equal(source?.with?.ref, "${{ needs.plan.outputs.sha }}");
    assert.equal(
      flow.jobs.plan!.permissions?.contents ?? flow.permissions.contents,
      "read",
    );
    assert.equal(flow.jobs.publish!.permissions?.contents, "write");
    assert.equal(flow.jobs.publish!.permissions?.packages, "write");
    // Nothing is hosted: no release reaches a server, a database or a secret.
    const text = JSON.stringify(flow);
    for (const forbidden of ["secrets.", "DATABASE_", "DEPLOY_SSH", "ssh "])
      assert.ok(!text.includes(forbidden), forbidden);
  }
  assert.ok(!Object.hasOwn(nightly.on, "pull_request"));
  // The workflows that deployed or migrated a hosted platform are gone.
  for (const name of [
    "deploy-production",
    "deploy-platform",
    "migrate",
    "backfill",
  ])
    assert.throws(() => workflow(name), name);
});

void test("nightlies are scheduled, fully verified before publication and built for both architectures", () => {
  const ci = workflow("ci");
  const nightly = workflow("nightly");
  const production = workflow("release");
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
  assert.deepEqual(nightly.jobs.publish!.needs, ["plan", "verify", "build"]);
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

void test("only release managers can release or deploy a website", () => {
  const release = workflow("release");
  const check = {
    uses: "./.github/actions/release-manager",
    with: {
      managers: "${{ vars.RELEASE_MANAGERS || github.repository_owner }}",
    },
  };
  assert.deepEqual(
    release.jobs.authorize!.steps!.find((step) => step.uses === check.uses),
    check,
  );
  assert.equal(release.jobs.plan!.needs, "authorize");
  // Every other job waits for the gate, directly or through its needs.
  const needs = (name: string): string[] => {
    const direct = release.jobs[name]!.needs ?? [];
    const list = typeof direct === "string" ? [direct] : direct;
    return [...list, ...list.flatMap(needs)];
  };
  for (const name of Object.keys(release.jobs))
    if (name !== "authorize")
      assert.ok(needs(name).includes("authorize"), name);
  // Run alone or from Release, a website deployment checks too, before its
  // Cloudflare token can be used.
  for (const name of ["deploy-marketing", "deploy-docs"]) {
    const steps = workflow(name).jobs.deploy!.steps!;
    const gate = steps.findIndex((step) => step.uses === check.uses);
    const token = steps.findIndex((step) =>
      JSON.stringify(step).includes("secrets."),
    );
    assert.ok(gate >= 0 && gate < token, name);
  }
  // The person who clicked (also on a re-run), on main.
  const script = JSON.stringify(compositeAction("release-manager"));
  assert.match(script, /github\.triggering_actor/);
  assert.match(script, /refs\/heads\/main/);
});

void test("nightly pruning never runs on forks, queues with nightlies and deletes only when asked", () => {
  const prune = workflow("prune-nightlies");
  assert.deepEqual(Object.keys(prune.on).sort(), [
    "schedule",
    "workflow_dispatch",
  ]);
  const dryRun = (
    prune.on.workflow_dispatch as {
      inputs: Record<string, { type: string; default: boolean }>;
    }
  ).inputs.dry_run!;
  assert.deepEqual([dryRun.type, dryRun.default], ["boolean", true]);
  assert.deepEqual(prune.permissions, {});
  // The same queue as nightly publication, never cancelled.
  assert.equal(
    (prune.concurrency as { group?: string }).group,
    (workflow("nightly").concurrency as { group?: string }).group,
  );
  assert.equal(prune.concurrency?.["cancel-in-progress"], false);
  const job = prune.jobs.prune!;
  assert.equal(job.if, "github.repository == 'chricarp/lictory'");
  assert.deepEqual(job.permissions, {
    contents: "write",
    deployments: "read",
  });
  // Schedules prune; a manual run previews unless a release manager unchecks it.
  assert.equal(
    job.env?.DRY_RUN,
    "${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}",
  );
  const steps = job.steps!;
  const gate = steps.findIndex(
    (step) => step.uses === "./.github/actions/release-manager",
  );
  const run = steps.findIndex((step) =>
    step.run?.includes("scripts/prune-nightlies.ts"),
  );
  assert.ok(gate >= 0 && gate < run);
  assert.equal(
    (steps[gate] as { if?: string }).if,
    "github.event_name == 'workflow_dispatch' && !inputs.dry_run",
  );
  // Only the pruning step holds the token.
  assert.deepEqual(
    steps.flatMap((step, index) =>
      JSON.stringify(step).includes("github.token") ? [index] : [],
    ),
    [run],
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

void test("websites deploy only from Release or a release manager, with the token in one step", () => {
  for (const name of ["deploy-marketing", "deploy-docs"]) {
    const flow = workflow(name);
    assert.deepEqual(
      Object.keys(flow.on).sort(),
      ["workflow_call", "workflow_dispatch"],
      name,
    );
    assert.deepEqual(flow.permissions, { contents: "read" });
    assert.equal(flow.concurrency?.["cancel-in-progress"], false);
    const jobs = Object.values(flow.jobs);
    assert.equal(jobs.length, 1, name);
    const job = jobs[0]!;
    assert.equal(job.if, "github.repository == 'chricarp/lictory'");
    assert.equal(
      typeof job.environment === "object" ? job.environment.name : null,
      "websites",
    );
    assert.deepEqual(job.permissions, {
      contents: "read",
      deployments: "write",
    });
    assert.ok(!JSON.stringify(job.env ?? {}).includes("secrets."), name);
    const withSecrets = job.steps!.filter((step) =>
      JSON.stringify(step).includes("secrets."),
    );
    assert.equal(withSecrets.length, 1, name);
    assert.deepEqual(
      Object.keys(withSecrets[0]!.env!)
        .filter((key) => key.startsWith("CLOUDFLARE_"))
        .sort(),
      ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    );
    // Deploy, then journal the deployed commit for the next Release.
    assert.equal(withSecrets[0], job.steps!.at(-2));
    assert.match(job.steps!.at(-1)!.run!, /-site/);
    for (const step of job.steps!)
      if (step.uses?.startsWith("actions/checkout@"))
        assert.equal(String(step.with?.["persist-credentials"]), "false");
  }
  // Release deploys a website only when the platform release succeeded or
  // was not needed.
  const release = workflow("release");
  for (const [job, file] of [
    ["marketing", "deploy-marketing"],
    ["docs", "deploy-docs"],
  ] as const) {
    assert.equal(release.jobs[job]!.uses, `./.github/workflows/${file}.yml`);
    // Environment-scoped secrets resolve empty in a called workflow unless
    // the caller passes them; inherit keeps Release from naming any.
    assert.equal(release.jobs[job]!.secrets, "inherit", job);
    assert.match(
      release.jobs[job]!.if!,
      /needs\.plan\.outputs\.platform != 'true' \|\| needs\.publish\.result == 'success'/,
    );
  }
  // Nothing serves the platform any more.
  assert.ok(
    !existsSync(
      new URL("../../../../apps/platform/wrangler.jsonc", import.meta.url),
    ),
  );
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
  for (const name of ["setup", "services", "release-manager"])
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
  // The static jobs together run everything `bun run check` runs: types, the
  // remaining checks and lint over paths that cover the whole repository.
  const scripts = (
    JSON.parse(
      readFileSync(
        new URL("../../../../package.json", import.meta.url),
        "utf8",
      ),
    ) as { scripts: Record<string, string> }
  ).scripts;
  assert.equal(
    scripts.check,
    "bun scripts/check-toolchain.ts && bun run typecheck && bun run lint && bun run check:rest",
  );
  for (const run of [
    "bun scripts/check-toolchain.ts",
    "bun run typecheck",
    "bun run check:rest",
    "bun run db:check",
  ])
    assert.ok(runs("static").includes(run), run);
  const groups = (
    jobs.static as {
      strategy?: {
        matrix?: { check?: { group: string; paths?: string }[] };
      };
    }
  ).strategy!.matrix!.check!;
  const lint = groups.filter((group) => group.group === "lint");
  const named = lint.flatMap((group) =>
    group.paths!.startsWith(".") ? [] : [group.paths!],
  );
  assert.deepEqual(
    lint.map((group) => group.paths),
    [
      ...named,
      [".", ...named.map((path) => `--ignore-pattern ${path}/**`)].join(" "),
    ],
    "the last lint group is everything the others do not lint",
  );
  assert.ok(runs("static").some((run) => run.includes("eslint $LINT_PATHS")));
  // Every domain test file runs, in parallel; browser shards split the suite.
  assert.ok(runs("domain").includes("bun run db:migrate"));
  assert.ok(
    runs("domain").some((run) => /^bun test --parallel\b.* src$/.test(run)),
  );
  assert.ok(!runs("domain").some((run) => run.includes("--shard")));
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
  const none = { unit: "false", e2e: "false", audit: "false", docs: "false" };
  assert.deepEqual(select("README.md", "docs/operations/releases.md"), none);
  // Documentation pages need their site built, not the application suites.
  assert.deepEqual(select("apps/docs/content/docs/index.mdx"), {
    ...none,
    docs: "true",
  });
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
  assert.equal(select("packages/ui/src/theme.css").docs, "true");
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
