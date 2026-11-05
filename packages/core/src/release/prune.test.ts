import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHub } from "@lictory/core/release/github";
import {
  nightliesToPrune,
  promotionSources,
  pruneNightlies,
  type IntentRecord,
  type PrunableRelease,
} from "@lictory/core/release/prune";

const now = new Date("2026-11-04T12:00:00Z");
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

let nextId = 1;
function nightly(days: number, run = nextId): PrunableRelease {
  const published = daysAgo(days);
  return {
    id: nextId++,
    tag_name: `v0.19.0-nightly.${published.slice(0, 10).replaceAll("-", "")}.${run}`,
    draft: false,
    prerelease: true,
    published_at: published,
  };
}
function stable(days: number, version = "0.18.0"): PrunableRelease {
  return {
    id: nextId++,
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    published_at: daysAgo(days),
  };
}
const tags = (releases: PrunableRelease[]) =>
  releases.map((release) => release.tag_name);

void test("nothing is pruned without nightlies", () => {
  assert.deepEqual(nightliesToPrune([], now), []);
  assert.deepEqual(
    nightliesToPrune([stable(400), stable(90, "0.17.0")], now),
    [],
  );
});

void test("the newest nightly survives however old it is", () => {
  const only = nightly(200);
  assert.deepEqual(nightliesToPrune([only], now), []);
  // The owner was away: nothing was published in the retention period.
  const old = [nightly(90), nightly(60), nightly(30)];
  assert.deepEqual(tags(nightliesToPrune(old, now)), tags(old.slice(0, 2)));
  // Two nightlies published in the same instant are both the newest.
  const twinA = nightly(40);
  const twinB = { ...twinA, id: nextId++, tag_name: `${twinA.tag_name}0` };
  const older = nightly(50);
  assert.deepEqual(tags(nightliesToPrune([older, twinA, twinB], now)), [
    older.tag_name,
  ]);
});

void test("old nightlies go once a recent one exists; recent ones stay", () => {
  const old = [nightly(15), nightly(40)];
  const recent = [nightly(13), nightly(1), nightly(0)];
  assert.deepEqual(
    tags(nightliesToPrune([...recent, ...old], now)),
    // Oldest first.
    [old[1]!.tag_name, old[0]!.tag_name],
  );
});

void test("a nightly exactly 14 days old is kept; a millisecond older goes", () => {
  const boundary = nightly(14);
  const older = {
    ...nightly(14),
    published_at: new Date(Date.parse(daysAgo(14)) - 1).toISOString(),
  };
  const fresh = nightly(2);
  assert.deepEqual(tags(nightliesToPrune([boundary, older, fresh], now)), [
    older.tag_name,
  ]);
});

void test("stable releases, drafts and other prereleases are never selected", () => {
  const draft = { ...nightly(100), draft: true, published_at: null };
  // A published draft-turned-release that is not marked prerelease.
  const unmarked = { ...nightly(100), prerelease: false };
  const otherPrerelease = {
    ...nightly(100),
    tag_name: "v0.19.0-rc.1",
  };
  const lookalike = { ...nightly(100), tag_name: "nightly-20260101" };
  const old = nightly(100);
  const releases = [
    stable(300, "0.1.0"),
    stable(100, "0.17.0"),
    draft,
    unmarked,
    otherPrerelease,
    lookalike,
    old,
    nightly(1),
  ];
  assert.deepEqual(tags(nightliesToPrune(releases, now)), [old.tag_name]);
});

void test("the newest is chosen by publication date, not list order or run number", () => {
  // A retried older run published last is the newest the channel offers.
  const republished = nightly(20, 5);
  const higherRun = nightly(25, 9);
  const oldest = nightly(30, 7);
  for (const order of [
    [republished, higherRun, oldest],
    [oldest, higherRun, republished],
    [higherRun, oldest, republished],
  ])
    assert.deepEqual(tags(nightliesToPrune(order, now)), [
      oldest.tag_name,
      higherRun.tag_name,
    ]);
});

void test("protected nightlies survive, and a nightly with an unreadable date stops the run", () => {
  const promoted = nightly(30);
  const old = nightly(31);
  assert.deepEqual(
    tags(
      nightliesToPrune([promoted, old, nightly(0)], now, {
        protectedTags: new Set([promoted.tag_name]),
      }),
    ),
    [old.tag_name],
  );
  assert.throws(() =>
    nightliesToPrune([{ ...nightly(30), published_at: "soon" }], now),
  );
});

function intent(days: number, sourceNightly: unknown, id = nextId++) {
  return {
    id,
    created_at: daysAgo(days),
    payload: {
      kind: "lictory-release-intent",
      runId: 1,
      manifest: { tag: "v0.19.0", sourceNightly },
    },
  } satisfies IntentRecord;
}

void test("stable release runs keep the nightly they promote for 30 days", () => {
  assert.deepEqual(
    [
      ...promotionSources(
        [intent(29, "v0.19.0-nightly.20261006.40"), intent(31, "v0.18.0-x")],
        now,
      ),
    ],
    ["v0.19.0-nightly.20261006.40"],
  );
  assert.throws(
    () => promotionSources([intent(1, null)], now),
    /does not say which nightly/,
  );
});

/** A GitHub API double: paginated listings, deletions, injected failures. */
function api(
  releases: PrunableRelease[],
  options: {
    intents?: IntentRecord[];
    failPage?: number;
    failDelete?: number;
    repeatOnPage2?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}${url.search}`);
    const id = /\/releases\/(\d+)$/.exec(url.pathname)?.[1];
    if (method === "DELETE" && id) {
      if (Number(id) === options.failDelete)
        return Promise.resolve(new Response(null, { status: 502 }));
      const index = releases.findIndex((release) => release.id === Number(id));
      releases.splice(index, 1);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.pathname.endsWith("/deployments"))
      return Promise.resolve(Response.json(options.intents ?? []));
    // Two releases per page so tests exercise the Link header.
    const page = Number(url.searchParams.get("page") ?? "1");
    if (page === options.failPage)
      return Promise.resolve(new Response(null, { status: 500 }));
    const items = releases.slice((page - 1) * 2, page * 2);
    if (options.repeatOnPage2 && page === 2) items[0] = releases[0]!;
    const headers =
      page * 2 < releases.length
        ? {
            link: `<https://api.github.com/repositories/1/releases?per_page=100&page=${page + 1}>; rel="next"`,
          }
        : undefined;
    return Promise.resolve(Response.json(items, { headers }));
  };
  return { calls, github: new GitHub("example/lictory", "token", fetcher) };
}

const quiet = (line: string) => void line;

void test("pruning reads every page, deletes oldest first and keeps tags", async () => {
  const keep = nightly(1);
  const releases = [keep, nightly(20), stable(5), nightly(40), nightly(60)];
  const expected = [...releases]
    .slice(1)
    .filter((r) => r.prerelease)
    .reverse();
  const { github, calls } = api(releases);
  const report = await pruneNightlies(github, now, false, quiet);
  assert.equal(report.newest, keep.tag_name);
  assert.equal(report.nightlies, 4);
  assert.deepEqual(tags(report.deleted), tags(expected));
  assert.equal(report.failure, undefined);
  assert.deepEqual(
    calls.filter((call) => !call.startsWith("GET")),
    expected.map(
      (release) => `DELETE /repos/example/lictory/releases/${release.id}`,
    ),
  );
  // Only GitHub Releases are deleted; no Git ref is touched.
  assert.ok(!calls.some((call) => call.includes("/git/")));
  assert.deepEqual(tags(releases), [keep.tag_name, "v0.18.0"]);
});

void test("a dry run lists what it would delete and deletes nothing", async () => {
  const releases = [nightly(1), nightly(20), nightly(40)];
  const lines: string[] = [];
  const { github, calls } = api(releases);
  const report = await pruneNightlies(github, now, true, (line) =>
    lines.push(line),
  );
  assert.equal(report.selected.length, 2);
  assert.deepEqual(report.deleted, []);
  assert.ok(calls.every((call) => call.startsWith("GET")));
  assert.equal(
    lines.filter((line) => line.startsWith("Would delete")).length,
    2,
  );
});

void test("an incomplete listing deletes nothing", async () => {
  const releases = () => [nightly(1), nightly(20), nightly(40), nightly(50)];
  for (const options of [{ failPage: 2 }, { repeatOnPage2: true }]) {
    const { github, calls } = api(releases(), options);
    await assert.rejects(pruneNightlies(github, now, false, quiet));
    assert.ok(calls.every((call) => call.startsWith("GET")));
  }
  // An unreadable stable release intent also stops before any deletion.
  const { github, calls } = api(releases(), { intents: [intent(1, null)] });
  await assert.rejects(pruneNightlies(github, now, false, quiet));
  assert.ok(calls.every((call) => call.startsWith("GET")));
});

void test("a failed deletion stops and reports what was and was not deleted", async () => {
  const oldest = nightly(60);
  const middle = nightly(40);
  const newer = nightly(20);
  const { github } = api([nightly(1), newer, middle, oldest], {
    failDelete: middle.id,
  });
  const report = await pruneNightlies(github, now, false, quiet);
  assert.deepEqual(tags(report.deleted), [oldest.tag_name]);
  assert.equal(report.failure?.release.tag_name, middle.tag_name);
  assert.match(report.failure.error, /502/);
  assert.deepEqual(tags(report.selected), tags([oldest, middle, newer]));
});

void test("a nightly an in-flight stable release promotes is kept", async () => {
  const promoted = nightly(25);
  const { github } = api([nightly(1), promoted, nightly(30)], {
    intents: [intent(2, promoted.tag_name)],
  });
  const report = await pruneNightlies(github, now, false, quiet);
  assert.deepEqual(report.protectedTags, [promoted.tag_name]);
  assert.ok(!tags(report.deleted).includes(promoted.tag_name));
  assert.equal(report.deleted.length, 1);
});
