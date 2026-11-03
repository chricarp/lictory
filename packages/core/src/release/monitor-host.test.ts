import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

// deploy/bin/lictory-monitor on a host: probes only configured public routes
// and alerts without python3 when the ops container cannot run.

const repository = new URL("../../../../", import.meta.url).pathname;

function fixture(t: TestContext, env: string, state = "running/healthy") {
  const base = mkdtempSync(join(tmpdir(), "lictory-monitor-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root");
  const fake = join(base, "fake-bin");
  mkdirSync(join(root, "qa/current"), { recursive: true });
  mkdirSync(fake);
  cpSync(join(repository, "deploy/bin"), join(root, "bin"), {
    recursive: true,
  });
  writeFileSync(join(root, "qa/.env"), env);
  writeFileSync(
    join(root, "qa/current/release.env"),
    "LICTORY_VERSION=1.0.0\n",
  );
  const calls = join(base, "calls.jsonl");
  const recorder = (name: string, body: string) =>
    writeFileSync(
      join(fake, name),
      `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify([${JSON.stringify(name)}, ...args]) + "\\n");
${body}
`,
      { mode: 0o700 },
    );
  recorder(
    "docker",
    `if (args[0] === "info") console.log(${JSON.stringify(base)});
else if (args[0] === "inspect") console.log(${JSON.stringify(state)});
else if (args.includes("ps")) console.log("container-id");
else if (args.includes("run")) process.exit(Number(process.env.FAKE_OPS_EXIT ?? 0));`,
  );
  recorder("curl", "");
  recorder("python3", "process.exit(99);");
  return {
    run(extra: Record<string, string> = {}) {
      const result = spawnSync(
        "bash",
        [join(root, "bin/lictory-monitor"), "qa"],
        {
          env: {
            ...process.env,
            PATH: `${fake}:${process.env.PATH}`,
            LICTORY_ROOT: root,
            ...extra,
          },
          encoding: "utf8",
        },
      );
      const recorded = existsSync(calls)
        ? readFileSync(calls, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as string[])
        : [];
      return { ...result, recorded };
    },
  };
}

const probed = (calls: string[][]) =>
  calls
    .filter((call) => call[0] === "curl" && !call.includes("--data-raw"))
    .map((call) => call.at(-1));

void test("without a marketing site only the app route is probed", (t) => {
  const result = fixture(t, "APP_HOST=app.example.test\nSITE_HOST=\n").run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(probed(result.recorded), [
    "https://app.example.test/readyz",
  ]);
});

void test("a configured site is still probed (unchanged default)", (t) => {
  const result = fixture(
    t,
    "APP_HOST=app.example.test\nPUBLIC_APP_HOST=app.public.test\nSITE_HOST=example.test\n",
  ).run();
  assert.deepEqual(probed(result.recorded), [
    "https://example.test/",
    "https://app.public.test/readyz",
  ]);
});

void test("alerts are valid JSON without python3 when the monitor cannot run", (t) => {
  const state = 'exited "137"\\back\tslash';
  const result = fixture(
    t,
    "APP_HOST=app.example.test\nALERT_WEBHOOK_URL=https://hooks.example.test/x\n",
    state,
  ).run({ FAKE_OPS_EXIT: "3" });
  assert.equal(result.status, 3);
  assert.ok(!result.recorded.some((call) => call[0] === "python3"));
  const post = result.recorded.find(
    (call) =>
      call[0] === "curl" && call.includes("https://hooks.example.test/x"),
  )!;
  const body = JSON.parse(post[post.indexOf("--data-raw") + 1]!) as {
    text: string;
    content: string;
  };
  assert.equal(body.text, body.content);
  assert.match(body.text, /^\[lictory qa\] monitor could not run \(exit 3\)/);
  assert.ok(body.text.includes(`container postgres is ${state}\n`));
});
