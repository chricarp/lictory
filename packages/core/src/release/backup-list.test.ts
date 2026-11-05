import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

// deploy/backup/list-backups.sh (ops image) with a fake rclone: what
// `lictory backup list` shows and which keys `lictory restore` accepts.

const script = new URL(
  "../../../../deploy/backup/list-backups.sh",
  import.meta.url,
).pathname;

function run(t: TestContext, rclone: string, env: Record<string, string> = {}) {
  const fake = mkdtempSync(join(tmpdir(), "lictory-backup-list-"));
  t.after(() => rmSync(fake, { recursive: true, force: true }));
  writeFileSync(join(fake, "rclone"), `#!/bin/sh\n${rclone}\n`, {
    mode: 0o755,
  });
  return spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      PATH: `${fake}:${process.env.PATH}`,
      LICTORY_ENVIRONMENT: "production",
      BACKUP_TARGET: "s3",
      BACKUP_BUCKET: "lictory-backups",
      ...env,
    },
  });
}

const listing = JSON.stringify([
  {
    Path: "daily/lictory-production-20261104T023000Z-scheduled.dump.age",
    Name: "lictory-production-20261104T023000Z-scheduled.dump.age",
    Size: 1_400_000,
    ModTime: "2026-11-04T02:30:41Z",
  },
  {
    Path: "manual/lictory-production-20261105T120000Z-manual.dump",
    Name: "lictory-production-20261105T120000Z-manual.dump",
    Size: 1_500_000,
    ModTime: "2026-11-05T12:00:12Z",
  },
  // Not a backup: a stray file in the target is never offered for restore.
  {
    Path: "daily/notes.dump",
    Name: "notes.dump",
    Size: 1,
    ModTime: "2026-11-06T00:00:00Z",
  },
]);

void test("list-backups.sh lists restorable keys newest first", (t) => {
  const result = run(t, `cat <<'JSON'\n${listing}\nJSON`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    {
      key: "production/manual/lictory-production-20261105T120000Z-manual.dump",
      kind: "manual",
      name: "lictory-production-20261105T120000Z-manual.dump",
      bytes: 1_500_000,
      modified: "2026-11-05T12:00:12Z",
      encrypted: false,
    },
    {
      key: "production/daily/lictory-production-20261104T023000Z-scheduled.dump.age",
      kind: "daily",
      name: "lictory-production-20261104T023000Z-scheduled.dump.age",
      bytes: 1_400_000,
      modified: "2026-11-04T02:30:41Z",
      encrypted: true,
    },
  ]);
});

void test("list-backups.sh: no backups yet, a disabled target, an unreachable one", (t) => {
  const empty = run(t, `echo "directory not found" >&2; exit 3`, {
    BACKUP_TARGET: "rclone",
    BACKUP_RCLONE_REMOTE: ":sftp,host=nas:backups",
  });
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), []);

  const disabled = run(t, "exit 0", { BACKUP_TARGET: "none" });
  assert.equal(disabled.status, 3);
  assert.match(disabled.stderr, /Backups are disabled for production/);

  const misconfigured = run(t, "exit 0", { BACKUP_BUCKET: "" });
  assert.equal(misconfigured.status, 64);
  assert.match(misconfigured.stderr, /needs BACKUP_BUCKET/);

  const refused = run(t, `echo "AccessDenied: bad credentials" >&2; exit 1`);
  assert.equal(refused.status, 1);
  assert.match(
    refused.stderr,
    /Could not list backup:lictory-backups\/production: AccessDenied/,
  );
});

void test("a connection string's credentials reach rclone as configuration, not as arguments", (t) => {
  const record = join(mkdtempSync(join(tmpdir(), "lictory-rclone-")), "call");
  t.after(() => rmSync(join(record, ".."), { recursive: true, force: true }));
  const result = run(
    t,
    `{ echo "ARGS $*"; env | grep ^RCLONE_CONFIG_LICTORYTARGET_ | sort; } > "${record}"; echo '[]'`,
    {
      BACKUP_TARGET: "rclone",
      BACKUP_RCLONE_REMOTE:
        ":sftp,host=nas.example.test,user=backup,pass='SFTP-SECRET,9f2':lictory",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const call = readFileSync(record, "utf8");
  const args = call.split("\n").find((line) => line.startsWith("ARGS "))!;
  assert.match(args, / lictorytarget:lictory\/production$/);
  assert.ok(!args.includes("SFTP-SECRET"));
  assert.match(call, /^RCLONE_CONFIG_LICTORYTARGET_PASS=SFTP-SECRET,9f2$/m);
  assert.match(call, /^RCLONE_CONFIG_LICTORYTARGET_TYPE=sftp$/m);
  assert.match(call, /^RCLONE_CONFIG_LICTORYTARGET_HOST=nas\.example\.test$/m);
});

void test("connection strings are read as rclone reads them", (t) => {
  const record = join(mkdtempSync(join(tmpdir(), "lictory-rclone-")), "call");
  t.after(() => rmSync(join(record, ".."), { recursive: true, force: true }));
  const call = (remote: string) => {
    const result = run(
      t,
      `{ echo "ARGS $*"; env | grep ^RCLONE_CONFIG_ | grep -v ^RCLONE_CONFIG_BACKUP | sort; } > "${record}"; echo '[]'`,
      { BACKUP_TARGET: "rclone", BACKUP_RCLONE_REMOTE: remote },
    );
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(record, "utf8");
  };
  // An option without "=" is true, and the path after it is kept.
  const flag = call(":local,no_check_updated:/srv/backups");
  assert.match(flag, / lictorytarget:\/srv\/backups\/production$/m);
  assert.match(flag, /^RCLONE_CONFIG_LICTORYTARGET_NO_CHECK_UPDATED=true$/m);
  // A doubled quote inside a quoted value is one literal quote.
  assert.match(
    call(':alias,remote="/srv/a""b":'),
    /^RCLONE_CONFIG_LICTORYTARGET_REMOTE=\/srv\/a"b$/m,
  );
  // A quote inside an unquoted value is literal.
  assert.match(
    call(':sftp,pass=a"b:p'),
    /^RCLONE_CONFIG_LICTORYTARGET_PASS=a"b$/m,
  );
  // Options on a named remote reach that remote's configuration.
  const named = call("nas,pass=opaque-secret:backups");
  assert.match(named, /^ARGS .* nas:backups\/production$/m);
  assert.ok(!/^ARGS .*opaque-secret/m.exec(named));
  assert.match(named, /^RCLONE_CONFIG_NAS_PASS=opaque-secret$/m);
  // A plain named remote is unchanged.
  assert.match(call("nas:backups"), / nas:backups\/production$/m);
});
