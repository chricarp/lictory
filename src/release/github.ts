import { z } from "zod";
import {
  changelog,
  fingerprint,
  manifestSchema,
  sameManifest,
  type Manifest,
} from "./model";

export const releaseSchema = z.object({
  id: z.number(),
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
  body: z.string().nullable(),
  author: z.object({ login: z.string() }),
  assets: z.array(
    z.object({ id: z.number(), name: z.string(), url: z.string() }),
  ),
});
export type Release = z.infer<typeof releaseSchema>;
export const runSchema = z.object({
  id: z.number(),
  run_number: z.number(),
  head_sha: z.string(),
  head_branch: z.string(),
  event: z.string(),
  path: z.string(),
  conclusion: z.string().nullable(),
  created_at: z.string(),
});
export const deploymentPayloadSchema = z.object({
  kind: z.literal("lictory-release"),
  tag: z.string(),
  version: z.string(),
  manifestHash: z.string(),
  runId: z.number(),
  projectId: z.string(),
  vercelId: z.string(),
  url: z.string().url(),
});
export type DeploymentPayload = z.infer<typeof deploymentPayloadSchema>;
export const deploymentSchema = z.object({
  id: z.number(),
  sha: z.string(),
  environment: z.string(),
  payload: z.unknown(),
});
export type DeploymentRecord = z.infer<typeof deploymentSchema>;

export class GitHub {
  constructor(
    readonly repository: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token)
      throw new Error("GitHub repository and token are required.");
  }

  async request(
    path: string,
    method = "GET",
    body?: unknown,
    accept = "application/vnd.github+json",
  ): Promise<unknown> {
    const url = path.startsWith("https://")
      ? path
      : `https://api.github.com/repos/${this.repository}${path}`;
    if (
      !["api.github.com", "uploads.github.com"].includes(new URL(url).hostname)
    )
      throw new Error("Untrusted GitHub API URL.");
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404 && method === "GET") return undefined;
      if (
        method === "GET" &&
        [429, 500, 502, 503, 504].includes(response.status) &&
        attempt < 3
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * 2 ** attempt),
        );
        continue;
      }
      if (!response.ok)
        throw new Error(
          `GitHub ${method} ${new URL(url).pathname} failed (${response.status}).`,
        );
      if (response.status === 204) return undefined;
      return response.json() as Promise<unknown>;
    }
  }

  async list<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; ; page++) {
      const values = z
        .array(schema)
        .parse(
          await this.request(
            `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
          ),
        );
      all.push(...values);
      if (values.length < 100) return all;
    }
  }

  releases() {
    return this.list("/releases", releaseSchema);
  }
  async release(tag: string): Promise<Release | undefined> {
    const value = await this.request(
      `/releases/tags/${encodeURIComponent(tag)}`,
    );
    // The tag endpoint only returns published releases. Find drafts as well so
    // retries reuse the reservation instead of creating a second release.
    return value === undefined
      ? (await this.releases()).find((release) => release.tag_name === tag)
      : releaseSchema.parse(value);
  }
  async tagSha(tag: string): Promise<string | undefined> {
    const value = await this.request(
      `/git/ref/tags/${encodeURIComponent(tag)}`,
    );
    if (value === undefined) return undefined;
    // getCommit peels both annotated and lightweight tags.
    return z
      .object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
      .parse(await this.request(`/commits/${encodeURIComponent(tag)}`)).sha;
  }

  async manifest(release: Release): Promise<Manifest> {
    const assets = release.assets.filter(
      (asset) => asset.name === "release-manifest.json",
    );
    if (assets.length !== 1)
      throw new Error(
        `${release.tag_name} needs one immutable release manifest.`,
      );
    const manifest = manifestSchema.parse(
      await this.request(
        assets[0]!.url,
        "GET",
        undefined,
        "application/octet-stream",
      ),
    );
    if (
      manifest.repository !== this.repository ||
      manifest.tag !== release.tag_name ||
      (await this.tagSha(manifest.tag)) !== manifest.sha
    )
      throw new Error("Release manifest and immutable tag do not agree.");
    return manifest;
  }

  async reserve(manifest: Manifest): Promise<Release> {
    const sha = await this.tagSha(manifest.tag);
    if (sha && sha !== manifest.sha)
      throw new Error(
        `Tag collision: ${manifest.tag} already points at another commit.`,
      );
    if (!sha)
      await this.request("/git/refs", "POST", {
        ref: `refs/tags/${manifest.tag}`,
        sha: manifest.sha,
      });
    let release = await this.release(manifest.tag);
    release ??= releaseSchema.parse(
      await this.request("/releases", "POST", {
        tag_name: manifest.tag,
        target_commitish: manifest.sha,
        name: `Lictory ${manifest.version}`,
        body: changelog(manifest),
        draft: true,
        prerelease: manifest.channel === "nightly",
        make_latest: "false",
      }),
    );
    if (release.prerelease !== (manifest.channel === "nightly"))
      throw new Error("Release channel collision.");
    if (release.assets.some((asset) => asset.name === "release-manifest.json"))
      sameManifest(await this.manifest(release), manifest);
    else {
      if (!release.draft)
        throw new Error(
          "Cannot adopt an existing published release without provenance.",
        );
      const response = await this.fetcher(
        `https://uploads.github.com/repos/${this.repository}/releases/${release.id}/assets?name=release-manifest.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(manifest),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok)
        throw new Error(
          `Release manifest upload failed (${response.status}); retry the failed job.`,
        );
      const refreshed = await this.request(`/releases/${release.id}`);
      if (refreshed === undefined)
        throw new Error(
          `Reserved release ${manifest.tag} is unavailable; retry the failed job.`,
        );
      release = releaseSchema.parse(refreshed);
      sameManifest(await this.manifest(release), manifest);
    }
    return release;
  }

  async publish(manifest: Manifest): Promise<void> {
    const release = await this.reserve(manifest);
    if (!release.draft) return;
    await this.request(`/releases/${release.id}`, "PATCH", {
      draft: false,
      prerelease: manifest.channel === "nightly",
      make_latest: manifest.channel === "stable" ? "true" : "false",
    });
  }

  deployments(environment: string) {
    return this.list(
      `/deployments?environment=${environment}`,
      deploymentSchema,
    );
  }
  async releaseIntent(
    channel: "stable" | "nightly",
    runId: number,
  ): Promise<Manifest | undefined> {
    let selected: Manifest | undefined;
    const schema = z.object({
      kind: z.literal("lictory-release-intent"),
      runId: z.number(),
      manifest: manifestSchema,
    });
    for (const record of await this.deployments(
      channel === "stable" ? "production-intent" : "nightly-intent",
    )) {
      const payload = schema.safeParse(record.payload);
      if (!payload.success || payload.data.runId !== runId) continue;
      if (
        payload.data.manifest.channel !== channel ||
        payload.data.manifest.repository !== this.repository ||
        payload.data.manifest.sha !== record.sha
      )
        throw new Error("Production intent provenance mismatch.");
      if (selected) sameManifest(selected, payload.data.manifest);
      selected = payload.data.manifest;
    }
    return selected;
  }

  async keepReleaseIntent(runId: number, manifest: Manifest): Promise<void> {
    const existing = await this.releaseIntent(manifest.channel, runId);
    if (existing) {
      sameManifest(existing, manifest);
      return;
    }
    await this.request("/deployments", "POST", {
      ref: manifest.sha,
      environment:
        manifest.channel === "stable" ? "production-intent" : "nightly-intent",
      auto_merge: false,
      required_contexts: [],
      transient_environment: false,
      production_environment: false,
      payload: { kind: "lictory-release-intent", runId, manifest },
    });
  }
  statuses(id: number) {
    return this.list(
      `/deployments/${id}/statuses`,
      z.object({ state: z.string(), environment_url: z.string().optional() }),
    );
  }
  async successfulDeployments(
    environment: string,
    matches: (record: DeploymentRecord, payload: DeploymentPayload) => boolean,
  ) {
    const result: { record: DeploymentRecord; payload: DeploymentPayload }[] =
      [];
    for (const record of await this.deployments(environment)) {
      const payload = deploymentPayloadSchema.safeParse(record.payload);
      if (
        payload.success &&
        matches(record, payload.data) &&
        (await this.statuses(record.id)).some(
          (status) => status.state === "success",
        )
      )
        result.push({ record, payload: payload.data });
    }
    return result;
  }
  async recordDeployment(
    manifest: Manifest,
    payload: Omit<
      DeploymentPayload,
      "kind" | "tag" | "version" | "manifestHash"
    >,
  ) {
    return deploymentSchema.parse(
      await this.request("/deployments", "POST", {
        ref: manifest.sha,
        environment: manifest.channel === "stable" ? "production" : "nightly",
        auto_merge: false,
        required_contexts: [],
        transient_environment: false,
        production_environment: manifest.channel === "stable",
        payload: {
          ...payload,
          kind: "lictory-release",
          tag: manifest.tag,
          version: manifest.version,
          manifestHash: fingerprint(manifest),
        },
      }),
    );
  }
  async deploymentStatus(
    id: number,
    state: "in_progress" | "success" | "failure",
    url: string,
    runId: number,
  ) {
    await this.request(`/deployments/${id}/statuses`, "POST", {
      state,
      environment_url: url,
      log_url: `https://github.com/${this.repository}/actions/runs/${runId}`,
      auto_inactive: false,
    });
  }
}
