import { GitHub, type Release } from "@lictory/core/release/github";
import { imageNames, type Images } from "@lictory/core/release/images";
import {
  fingerprint,
  type Change,
  type Manifest,
} from "@lictory/core/release/model";
import { nightlyVersion } from "@lictory/core/release/version";

export const shaA = "a".repeat(40);
export const shaB = "b".repeat(40);
export const change = (
  title = "feat(editor): keep editing offline",
  sha = shaB,
  number = 1,
): Change => ({
  number,
  title,
  notes: "",
  author: "alex",
  mergedAt: "2026-10-08T01:00:00Z",
  mergeSha: sha,
  directCommits: [],
  stableApi: false,
});
export const registry = "ghcr.io/example";
export function images(seed = "a", namespace = registry): Images {
  return Object.fromEntries(
    imageNames.map((name, index) => [
      name,
      `${namespace}/lictory-${name}@sha256:${(seed + index).repeat(32).slice(0, 64)}`,
    ]),
  ) as Images;
}
export function nightly(
  sha = shaB,
  number = 142,
  changes = [change()],
): Manifest {
  const createdAt = "2026-10-08T01:42:00Z";
  const version = nightlyVersion("1.5.0", createdAt, number);
  return {
    schema: 1,
    repository: "example/lictory",
    channel: "nightly",
    version,
    tag: `v${version}`,
    stableVersion: "1.5.0",
    sha,
    sourceBranch: "main",
    baseline: { version: "1.4.2", tag: null, sha: shaA },
    run: { id: number + 1000, number, createdAt },
    changes,
    sourceNightly: null,
    nightlyNotes: null,
  };
}
export function stable(candidate = nightly()): Manifest {
  return {
    ...candidate,
    channel: "stable",
    tag: `v${candidate.stableVersion}`,
    version: candidate.stableVersion,
    sourceNightly: candidate.tag,
    nightlyNotes: null,
  };
}

export class GitHubFixture {
  releases: Release[] = [];
  tags = new Map<string, string>();
  assets = new Map<number, Manifest>();
  /** Text assets such as release.env, by asset id. */
  files = new Map<number, string>();
  responses = new Map<string, unknown>();
  writes: string[] = [];
  latestTag: string | undefined;
  /**
   * When set, drafts created through the API stay missing from the
   * `/releases` listing until `refreshListing()`, as GitHub's listing can lag
   * a release it has just created.
   */
  staleListing = false;
  private unlisted = new Set<number>();
  refreshListing() {
    this.unlisted.clear();
  }
  private nextId = 1;
  readonly github = new GitHub(
    "example/lictory",
    "test-token",
    this.fetch.bind(this),
  );

  add(manifest: Manifest, published = true) {
    const id = this.nextId++;
    this.tags.set(manifest.tag, manifest.sha);
    this.assets.set(id, structuredClone(manifest));
    const release: Release = {
      id,
      tag_name: manifest.tag,
      draft: !published,
      prerelease: manifest.channel === "nightly",
      published_at: published ? "2026-10-08T02:00:00Z" : null,
      body: "notes",
      author: { login: "github-actions[bot]" },
      assets: [
        {
          id,
          name: "release-manifest.json",
          url: `https://api.github.com/repos/example/lictory/releases/assets/${id}`,
        },
      ],
    };
    this.releases.push(release);
    if (manifest.channel === "stable" && published)
      this.latestTag = manifest.tag;
    this.responses.set(`/actions/runs/${manifest.run.id}`, {
      id: manifest.run.id,
      run_number: manifest.run.number,
      head_sha: manifest.sha,
      head_branch: manifest.sourceBranch,
      created_at: manifest.run.createdAt,
      event: "push",
      path: ".github/workflows/nightly.yml",
      conclusion: "success",
    });
    const deploymentId = id + 100;
    const records = (this.responses.get("/deployments?environment=nightly") ??
      []) as unknown[];
    this.responses.set("/deployments?environment=nightly", [
      ...records,
      {
        id: deploymentId,
        sha: manifest.sha,
        environment: "nightly",
        payload: {
          kind: "lictory-release",
          tag: manifest.tag,
          version: manifest.version,
          manifestHash: fingerprint(manifest),
          runId: manifest.run.id,
          registry,
          images: images(String(id % 10)),
          url: "https://github.com/example/lictory/releases",
        },
      },
    ]);
    this.responses.set(`/deployments/${deploymentId}/statuses`, [
      { state: "success" },
    ]);
    return release;
  }

  associate(sha: string, changes: Change[], base = "main") {
    this.responses.set(
      `/commits/${sha}/pulls`,
      changes.map((value) => ({
        number: value.number,
        title: value.title,
        body: value.notes ? `## Release notes\n${value.notes}` : "",
        merged_at: value.mergedAt,
        merge_commit_sha: value.mergeSha,
        base: { ref: base },
        user: { login: value.author },
        labels: value.stableApi ? [{ name: "release:stable-api" }] : [],
      })),
    );
  }

  private async fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const path = url.pathname.replace("/repos/example/lictory", "");
    const method = init?.method ?? "GET";
    const raw = typeof init?.body === "string" ? init.body : undefined;
    const json = (init?.headers as Record<string, string> | undefined)?.[
      "Content-Type"
    ]?.startsWith("application/json");
    const body =
      raw && json ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const respond = (value: unknown, status = 200) =>
      value === undefined
        ? new Response(null, { status: 404 })
        : Response.json(value, { status });
    if (method !== "GET") this.writes.push(`${method} ${path}`);
    if (path === "/git/refs" && method === "POST") {
      this.tags.set(
        String(body.ref).replace("refs/tags/", ""),
        String(body.sha),
      );
      return respond(body);
    }
    if (path.startsWith("/git/ref/tags/"))
      return respond(
        this.tags.has(decodeURIComponent(path.slice(14))) ? {} : undefined,
      );
    if (path.startsWith("/commits/") && !path.endsWith("/pulls"))
      return respond(
        this.tags.has(decodeURIComponent(path.slice(9)))
          ? { sha: this.tags.get(decodeURIComponent(path.slice(9))) }
          : undefined,
      );
    if (path.startsWith("/releases/assets/")) {
      const id = Number(path.split("/").at(-1));
      if (this.files.has(id)) return new Response(this.files.get(id));
      return respond(this.assets.get(id));
    }
    if (url.hostname === "uploads.github.com") {
      const id = Number(path.split("/")[2]);
      const assetId = this.nextId++;
      const name = url.searchParams.get("name")!;
      if (json) this.assets.set(assetId, body as unknown as Manifest);
      else this.files.set(assetId, raw ?? "");
      this.releases
        .find((value) => value.id === id)!
        .assets.push({
          id: assetId,
          name,
          url: `https://api.github.com/repos/example/lictory/releases/assets/${assetId}`,
        });
      return respond({ id: assetId });
    }
    if (path === "/releases/latest")
      return respond(
        this.releases.find((value) => value.tag_name === this.latestTag),
      );
    if (path.startsWith("/releases/tags/"))
      return respond(
        this.releases.find(
          (value) =>
            !value.draft &&
            value.tag_name === decodeURIComponent(path.slice(15)),
        ),
      );
    if (path === "/releases" && method === "GET")
      return respond(
        this.releases.filter((value) => !this.unlisted.has(value.id)),
      );
    if (path === "/releases" && method === "POST") {
      const release = {
        id: this.nextId++,
        tag_name: String(body.tag_name),
        draft: true,
        prerelease: Boolean(body.prerelease),
        published_at: null,
        body: String(body.body),
        author: { login: "github-actions[bot]" },
        assets: [],
      };
      this.releases.push(release);
      if (this.staleListing) this.unlisted.add(release.id);
      return respond(release);
    }
    if (/^\/releases\/\d+$/.test(path) && method === "GET")
      return respond(
        this.releases.find((value) => value.id === Number(path.split("/")[2])),
      );
    if (path.startsWith("/releases/") && method === "PATCH") {
      const release = this.releases.find(
        (value) => value.id === Number(path.split("/")[2]),
      )!;
      release.draft = Boolean(body.draft);
      release.published_at = "2026-10-08T02:00:00Z";
      if (body.make_latest === "true") this.latestTag = release.tag_name;
      return respond(release);
    }
    const key =
      path === "/deployments"
        ? `${path}?environment=${url.searchParams.get("environment")}`
        : path;
    if (path === "/deployments" && method === "POST") {
      const key = `/deployments?environment=${String(body.environment)}`;
      const records = (this.responses.get(key) ?? []) as unknown[];
      const record = {
        id: this.nextId++,
        sha: String(body.ref),
        environment: String(body.environment),
        payload: body.payload,
      };
      this.responses.set(key, [...records, record]);
      return respond(record);
    }
    if (this.responses.has(key)) return respond(this.responses.get(key));
    if (path === "/deployments") return respond([]);
    throw new Error(`Unhandled fixture API call: ${method} ${key}`);
  }
}
