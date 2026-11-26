import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  currentOffset,
  parseEnv,
  portsAt,
  projectName,
  settingsAt,
  withSettings,
} from "../../../../scripts/dev-env";

// `bun run dev:env` moves a second checkout's development ports together
// and rewrites every setting that names one, in .env.example's own lines.

const repository = new URL("../../../../", import.meta.url).pathname;
const example = readFileSync(`${repository}.env.example`, "utf8");

void test("a second checkout gets every port and the settings that name them moved by one offset", () => {
  const next = withSettings(example, {
    COMPOSE_PROJECT_NAME: projectName("/work/lictory-review"),
    ...settingsAt(10000),
  });
  const env = parseEnv(next);
  assert.equal(env.COMPOSE_PROJECT_NAME, "lictory-review");
  assert.equal(
    env.DATABASE_URL,
    "postgresql://lictory:lictory@localhost:15432/lictory",
  );
  assert.equal(env.SMTP_PORT, "11025");
  assert.equal(env.S3_ENDPOINT, "http://127.0.0.1:19000");
  assert.equal(env.BETTER_AUTH_URL, "http://localhost:13000");
  assert.equal(env.LICTORY_DEV_ZERO_PORT, "14848");
  assert.equal(env.LICTORY_DEV_API_PORT, "13002");
  assert.equal(env.COLLABORATION_PORT, "13004");
  assert.equal(env.SITE_URL, "http://localhost:13100");
  assert.equal(currentOffset(env), 10000);
  // Commented examples are replaced in place, not duplicated.
  assert.equal(next.match(/LICTORY_DEV_ZERO_PORT=/g)?.length, 1);
  assert.doesNotMatch(next, /^# COMPOSE_PROJECT_NAME=/m);
  // Every setting .env.example names a port for is covered.
  for (const name of Object.keys(parseEnv(example)))
    if (
      /PORT|_URL$|ENDPOINT/.test(name) &&
      /localhost|127\.0\.0\.1|^\d+$/.test(parseEnv(example)[name]!)
    )
      assert.ok(name in settingsAt(10000), name);
});

void test("the highest offset stays within the port range", () => {
  for (const port of Object.values(portsAt(50000))) assert.ok(port < 65536);
  assert.equal(projectName("/srv/lictory"), "lictory-2");
  assert.equal(currentOffset({}), 0);
});
