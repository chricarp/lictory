import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { fingerprint, type Manifest } from "./model";
import { compareStable } from "./version";
import type { Build } from "./pipeline";

const execute = promisify(execFile);
const deployment = z.object({
  id: z.string(),
  url: z.string(),
  projectId: z.string(),
  readyState: z.string(),
  target: z.string().nullable(),
  meta: z.record(z.string(), z.string()).default({}),
});
export type VercelDeployment = z.infer<typeof deployment>;
export type VercelConfiguration = {
  token: string;
  orgId: string;
  projectId: string;
  bootstrapDeploymentId?: string;
  productionDatabaseHost?: string;
  databaseUrl?: string;
  directDatabaseUrl?: string;
  migrationDatabaseUrl?: string;
};

export function assertDatabases(
  manifest: Manifest,
  config: VercelConfiguration,
): void {
  if (manifest.channel === "nightly") return;
  const expected = config.productionDatabaseHost;
  if (!expected) throw new Error("Configure the production database host.");
  for (const [value, pooled] of [
    [config.databaseUrl, true],
    [config.directDatabaseUrl, false],
    [config.migrationDatabaseUrl, false],
  ] as const) {
    const url = new URL(value ?? "");
    const host = pooled ? url.hostname.replace("-pooler.", ".") : url.hostname;
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      host !== expected ||
      !["require", "verify-full"].includes(
        url.searchParams.get("sslmode") ?? "",
      )
    )
      throw new Error(
        "Production database validation failed; release is blocked.",
      );
  }
}

export function assertProject(
  _manifest: Manifest,
  config: VercelConfiguration,
  domains: string[],
): void {
  if (!config.token || !config.orgId || !config.projectId)
    throw new Error("Configure Vercel project credentials.");
  if (
    !domains.includes("lictory.com") ||
    domains.some(
      (domain) =>
        !["lictory.com", "www.lictory.com"].includes(domain) &&
        !domain.endsWith(".vercel.app"),
    )
  )
    throw new Error(
      "Vercel project/domain validation failed; release is blocked.",
    );
}

export function matchesDeployment(
  manifest: Manifest,
  current: VercelDeployment,
): boolean {
  return (
    current.meta.releaseTag === manifest.tag &&
    current.meta.releaseSha === manifest.sha &&
    current.meta.releaseVersion === manifest.version &&
    current.meta.releaseChannel === manifest.channel &&
    current.meta.releaseManifest === fingerprint(manifest)
  );
}

export class Vercel {
  constructor(
    private readonly config: VercelConfiguration,
    private readonly root: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly command?: (args: readonly string[]) => Promise<string>,
  ) {}

  private async request(
    path: string,
    missingAllowed = false,
  ): Promise<unknown> {
    const response = await this.fetcher(
      `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(this.config.orgId)}`,
      {
        headers: { Authorization: `Bearer ${this.config.token}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (missingAllowed && response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`Vercel validation failed (${response.status}).`);
    return response.json() as Promise<unknown>;
  }

  async validateProject(manifest: Manifest): Promise<void> {
    assertDatabases(manifest, this.config);
    const domains = z
      .object({ domains: z.array(z.object({ name: z.string() })) })
      .parse(
        await this.request(
          `/v9/projects/${this.config.projectId}/domains?limit=100`,
        ),
      );
    assertProject(
      manifest,
      this.config,
      domains.domains.map((domain) => domain.name),
    );
    if (domains.domains.length >= 100)
      throw new Error("Too many project domains to prove channel isolation.");
  }

  async inspect(
    id: string,
    channel: Manifest["channel"] = "stable",
  ): Promise<VercelDeployment> {
    const current = deployment.parse(
      await this.request(`/v13/deployments/${encodeURIComponent(id)}`),
    );
    if (
      current.projectId !== this.config.projectId ||
      current.readyState !== "READY" ||
      (channel === "stable"
        ? current.target !== "production"
        : current.target !== null && current.target !== "preview")
    )
      throw new Error(
        "Deployment is not ready or has the wrong project/environment.",
      );
    return current;
  }

  async current(): Promise<VercelDeployment | undefined> {
    // Read the traffic-bearing alias, not targets.production (which can point
    // at a staged build). A staged --skip-domain build is never an activation.
    const domain = "lictory.com";
    const value = await this.request(`/v4/aliases/${domain}`, true);
    if (value === undefined) return undefined;
    const alias = z
      .object({ projectId: z.string(), deploymentId: z.string() })
      .parse(value);
    if (alias.projectId !== this.config.projectId)
      throw new Error("Channel alias belongs to another Vercel project.");
    return this.inspect(alias.deploymentId);
  }

  async assertProductionOrder(manifest: Manifest): Promise<void> {
    const current = await this.current();
    if (!current || matchesDeployment(manifest, current)) return;
    if (!current.meta.releaseVersion) {
      if (current.id !== this.config.bootstrapDeploymentId)
        throw new Error(
          "Untracked production deployment. Configure RELEASE_BOOTSTRAP_DEPLOYMENT_ID for the one-time migration.",
        );
      return;
    }
    if (current.meta.releaseChannel !== "stable")
      throw new Error("Production project contains a non-stable release.");
    if (compareStable(current.meta.releaseVersion, manifest.version) >= 0)
      throw new Error(
        "Cannot reactivate an older production version or reuse a version for different code.",
      );
    if (
      current.meta.releaseVersion !== manifest.baseline.version ||
      current.meta.releaseSha !== manifest.baseline.sha
    )
      throw new Error(
        "An activated production release still needs publication. Retry that release before deploying another.",
      );
  }

  private async cli(operation: string, args: string[]): Promise<string> {
    try {
      if (this.command) return await this.command(args);
      return (
        await execute(
          "npx",
          [
            "--yes",
            "vercel@62.2.0",
            ...args,
            "--yes",
            "--token",
            this.config.token,
          ],
          {
            cwd: this.root,
            maxBuffer: 16 * 1024 * 1024,
            env: {
              ...process.env,
              VERCEL_ORG_ID: this.config.orgId,
              VERCEL_PROJECT_ID: this.config.projectId,
            },
          },
        )
      ).stdout.trim();
    } catch {
      // execFile errors include argv; never expose the token through their message.
      throw new Error(
        `Vercel ${operation} failed. Inspect the deployment logs, then retry the workflow.`,
      );
    }
  }

  async build(manifest: Manifest): Promise<Build> {
    const metadata = {
      releaseTag: manifest.tag,
      releaseSha: manifest.sha,
      releaseVersion: manifest.version,
      releaseChannel: manifest.channel,
      releaseManifest: fingerprint(manifest),
      releaseRunNumber: String(manifest.run.number),
    };
    const output = await this.cli("build", [
      "deploy",
      ...(manifest.channel === "nightly"
        ? ["--target=preview"]
        : ["--prod", "--skip-domain"]),
      "--env",
      `LICTORY_RELEASE_CHANNEL=${manifest.channel}`,
      "--build-env",
      `LICTORY_RELEASE_CHANNEL=${manifest.channel}`,
      ...(manifest.channel === "stable"
        ? [
            "--env",
            "BETTER_AUTH_URL=https://lictory.com",
            "--build-env",
            "BETTER_AUTH_URL=https://lictory.com",
            "--env",
            `DATABASE_URL=${this.config.databaseUrl}`,
            "--env",
            `DATABASE_URL_UNPOOLED=${this.config.directDatabaseUrl}`,
            "--build-env",
            `DATABASE_URL=${this.config.databaseUrl}`,
            "--build-env",
            `DATABASE_URL_UNPOOLED=${this.config.directDatabaseUrl}`,
          ]
        : []),
      ...Object.entries(metadata).flatMap(([key, value]) => [
        "--meta",
        `${key}=${value}`,
      ]),
    ]);
    const url = output
      .split("\n")
      .findLast((line) => /^https:\/\/[\w.-]+\.vercel\.app$/.test(line.trim()))
      ?.trim();
    if (!url)
      throw new Error("Vercel did not return an immutable deployment URL.");
    const current = await this.inspect(new URL(url).hostname, manifest.channel);
    if (!matchesDeployment(manifest, current))
      throw new Error(
        "Configured build does not match the verified source/version.",
      );
    return { id: current.id, url };
  }

  async promote(manifest: Manifest, build: Build): Promise<void> {
    if (manifest.channel !== "stable")
      throw new Error("Preview nightlies cannot be promoted.");
    await this.validateProject(manifest);
    const target = await this.inspect(build.id);
    if (!matchesDeployment(manifest, target))
      throw new Error("Promotion source mismatch.");
    await this.assertProductionOrder(manifest);
    await this.cli("promotion", ["promote", build.url]);
    const activated = await this.current();
    if (activated?.id !== build.id || !matchesDeployment(manifest, activated))
      throw new Error("Vercel did not activate the validated deployment.");
  }
}
