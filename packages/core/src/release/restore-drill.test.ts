import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// deploy/bin/lictory-restore-drill with a fake docker: a backup file on the
// host reaches the drill's ops container as read-only single-file mounts.

const script = new URL(
  "../../../../deploy/bin/lictory-restore-drill",
  import.meta.url,
).pathname;

void test("a drill of a backup file mounts the dump and its manifest into the container", (t) => {
  const base = mkdtempSync(join(tmpdir(), "lictory-drill-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root");
  const home = join(root, "production");
  mkdirSync(join(home, "current"), { recursive: true });
  writeFileSync(
    join(home, ".env"),
    "LICTORY_DB_NAME=lictory\nBACKUP_TARGET=s3\nBACKUP_BUCKET=b\n",
  );
  writeFileSync(join(home, "current/release.env"), "LICTORY_VERSION=1.2.3\n");
  const backups = join(base, "backups");
  mkdirSync(backups);
  const dump = join(backups, "lictory-production-20261104T023000Z-manual.dump");
  writeFileSync(dump, "dump");
  writeFileSync(
    join(backups, "lictory-production-20261104T023000Z-manual.manifest.json"),
    "{}",
  );
  const fake = join(base, "bin");
  mkdirSync(fake);
  const log = join(base, "docker.log");
  // Records every docker call; the drill stops after its restore step.
  writeFileSync(
    join(fake, "docker"),
    `#!/bin/sh\necho "$*" >> "${log}"\ncase "$*" in *restore.sh*) exit 3 ;; esac\n`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", [script, "production", "none", dump], {
    encoding: "utf8",
    env: { PATH: `${fake}:${process.env.PATH}`, LICTORY_ROOT: root },
  });
  assert.equal(result.status, 3, result.stderr);
  const run = readFileSync(log, "utf8")
    .split("\n")
    .find((line) => line.includes("restore.sh"))!;
  assert.match(
    run,
    /-v \S+\/lictory-production-20261104T023000Z-manual\.dump:\/restore-source\/lictory-production-20261104T023000Z-manual\.dump:ro/,
  );
  assert.match(
    run,
    /manual\.manifest\.json:\/restore-source\/\S+manual\.manifest\.json:ro/,
  );
  assert.match(
    run,
    /restore \/restore-source\/lictory-production-20261104T023000Z-manual\.dump$/,
  );
});

void test("the drill passes backup credentials on exactly as written", (t) => {
  const base = mkdtempSync(join(tmpdir(), "lictory-drill-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root");
  const home = join(root, "production");
  mkdirSync(join(home, "current"), { recursive: true });
  writeFileSync(
    join(home, ".env"),
    "LICTORY_DB_NAME=lictory\nBACKUP_TARGET=s3\nBACKUP_BUCKET=b\nexport BACKUP_S3_SECRET_ACCESS_KEY='literal$TOKEN#1'\n",
  );
  writeFileSync(join(home, "current/release.env"), "LICTORY_VERSION=1.2.3\n");
  const fake = join(base, "bin");
  mkdirSync(fake);
  const copy = join(base, "drill.env");
  // Keeps the generated env file (the drill deletes its work directory).
  writeFileSync(
    join(fake, "docker"),
    `#!/bin/sh\nfor a in "$@"; do [ "$prev" = --env-file ] && cp "$a" "${copy}"; prev="$a"; done\nexit 3\n`,
    { mode: 0o755 },
  );
  spawnSync("bash", [script, "production", "none", "latest"], {
    encoding: "utf8",
    env: { PATH: `${fake}:${process.env.PATH}`, LICTORY_ROOT: root },
  });
  assert.match(
    readFileSync(copy, "utf8"),
    /^BACKUP_S3_SECRET_ACCESS_KEY='literal\$TOKEN#1'$/m,
  );
});
