import { spawn } from "node:child_process";
import { z } from "zod";
import {
  assertImages,
  imageNames,
  imagesSchema,
  releaseFile,
  type Images,
} from "@lictory/core/release/images";
import type { Manifest } from "@lictory/core/release/model";
import type { Build } from "@lictory/core/release/pipeline";
import { compareStable } from "@lictory/core/release/version";

// The deployment server is reached only through its SSH forced command
// (deploy/bin/lictory-remote): prepare, migrate, activate and status.

export const environments = ["production", "staging"] as const;
export type Environment = (typeof environments)[number];

export const serverStatusSchema = z.object({
  environment: z.enum(environments),
  version: z.string().nullable(),
  sha: z.string().optional(),
  channel: z.string().optional(),
  images: imagesSchema.optional(),
  services: z.record(z.string(), z.string()).optional(),
  healthy: z.boolean().optional(),
});
export type ServerStatus = z.infer<typeof serverStatusSchema>;

export type ServerConfiguration = {
  environment: Environment;
  registry: string;
};

/** Runs one forced-command invocation; `input` is sent on stdin. */
export type Remote = (
  args: readonly string[],
  input?: string,
) => Promise<string>;

export function matchesRelease(
  manifest: Manifest,
  status: ServerStatus,
): boolean {
  return (
    status.version === manifest.version &&
    status.sha === manifest.sha &&
    status.channel === manifest.channel
  );
}

function expectedChannel(environment: Environment): Manifest["channel"] {
  return environment === "production" ? "stable" : "nightly";
}

/** Whether a stable version is a published GitHub release of exactly this commit. */
export type PublishedCheck = (version: string, sha: string) => Promise<boolean>;

export class Server {
  constructor(
    private readonly config: ServerConfiguration,
    private readonly remote: Remote,
    private readonly published: PublishedCheck = async () => false,
  ) {}

  private assertChannel(manifest: Manifest) {
    if (manifest.channel !== expectedChannel(this.config.environment))
      throw new Error(
        `${this.config.environment} only runs ${expectedChannel(this.config.environment)} releases; ${manifest.tag} is ${manifest.channel}.`,
      );
  }

  async status(): Promise<ServerStatus> {
    const status = serverStatusSchema.parse(
      JSON.parse(await this.remote([this.config.environment, "status"])),
    );
    if (status.environment !== this.config.environment)
      throw new Error("The deployment server reports another environment.");
    return status;
  }

  /** Stores and pulls the release on the server; never changes traffic. */
  async prepare(manifest: Manifest, images: Images): Promise<void> {
    this.assertChannel(manifest);
    assertImages(images, this.config.registry);
    const prepared = (
      await this.remote(
        [this.config.environment, "prepare"],
        releaseFile(manifest, images),
      )
    ).trim();
    if (prepared.split("\n").at(-1) !== manifest.version)
      throw new Error("The server prepared a different release.");
  }

  /** Backup if needed, migrations, then waits until zero-cache replicated them. */
  async migrate(manifest: Manifest): Promise<void> {
    this.assertChannel(manifest);
    await this.remote([this.config.environment, "migrate", manifest.version]);
  }

  async activate(manifest: Manifest, build: Build): Promise<void> {
    this.assertChannel(manifest);
    await this.assertOrder(manifest);
    await this.remote([this.config.environment, "activate", manifest.version]);
    const active = await this.status();
    if (
      !matchesRelease(manifest, active) ||
      !active.healthy ||
      imageNames.some((name) => active.images?.[name] !== build.images[name])
    )
      throw new Error("The server did not activate the validated release.");
  }

  /**
   * Production moves forward only: never to an older or equal version with
   * different code, and never past an activated release that still needs its
   * GitHub publication. An operator rollback to an older published release is
   * fine. An empty server (first launch) accepts any release.
   */
  async assertOrder(manifest: Manifest): Promise<void> {
    if (this.config.environment !== "production") return;
    const current = await this.status();
    if (!current.version || matchesRelease(manifest, current)) return;
    if (current.channel !== "stable")
      throw new Error("Production runs a non-stable release.");
    if (compareStable(current.version, manifest.version) >= 0)
      throw new Error(
        "Cannot reactivate an older production version or reuse a version for different code.",
      );
    if (
      (current.version !== manifest.baseline.version ||
        current.sha !== manifest.baseline.sha) &&
      !(current.sha && (await this.published(current.version, current.sha)))
    )
      throw new Error(
        "An activated production release still needs publication. Retry that release before deploying another.",
      );
  }
}

/**
 * SSH transport with strict host key checking. The workflow writes the deploy
 * key and the pinned known_hosts entry before calling it.
 */
export function sshRemote(
  destination: string,
  options: { knownHostsFile?: string; identityFile?: string } = {},
): Remote {
  if (!/^[a-z_][a-z0-9_-]*@[A-Za-z0-9.-]+$/.test(destination))
    throw new Error(
      "DEPLOY_SSH_TARGET must look like deploy@server.example.com.",
    );
  return (args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "ServerAliveInterval=30",
          ...(options.knownHostsFile
            ? ["-o", `UserKnownHostsFile=${options.knownHostsFile}`]
            : []),
          ...(options.identityFile
            ? ["-o", "IdentitiesOnly=yes", "-i", options.identityFile]
            : []),
          destination,
          args.join(" "),
        ],
        { stdio: ["pipe", "pipe", "inherit"] },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve(output)
          : reject(
              new Error(
                `Deployment server refused or failed "${args.slice(0, 2).join(" ")}" (exit ${code}); see the log above.`,
              ),
            ),
      );
      child.stdin.end(input ?? "");
    });
}
