import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Manifest } from "@lictory/core/release/model";

// Images of one release (deploy/docker-bake.hcl). The API image also runs the worker.
export const imageNames = ["api", "proxy", "migrate", "ops"] as const;
export type ImageName = (typeof imageNames)[number];
export type Images = Record<ImageName, string> & { marketing?: string };

const registryPattern = /^[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._-]+)+$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function assertRegistry(registry: string): void {
  if (!registryPattern.test(registry))
    throw new Error(
      "Configure IMAGE_REGISTRY as a lowercase registry namespace, for example ghcr.io/acme.",
    );
}

function assertImage(
  name: ImageName | "marketing",
  reference: string | undefined,
  registry: string,
) {
  const [repository, digest] = reference?.split("@") ?? [];
  if (
    repository !== `${registry}/lictory-${name}` ||
    !digestPattern.test(digest ?? "")
  )
    throw new Error(
      `Image ${name} is not a digest in ${registry}; release is blocked.`,
    );
}

/** Every image must be pinned by digest in the configured registry namespace. */
export function assertImages(images: Images, registry: string): Images {
  assertRegistry(registry);
  for (const name of imageNames) assertImage(name, images[name], registry);
  if (images.marketing) assertImage("marketing", images.marketing, registry);
  return images;
}

export const imagesSchema = z
  .object(
    Object.fromEntries(imageNames.map((name) => [name, z.string()])) as Record<
      ImageName,
      z.ZodString
    >,
  )
  .extend({ marketing: z.string().optional() })
  .strict();

/** Stable identity of an image set, used as the build ID in journals. */
export function imagesId(images: Images): string {
  return createHash("sha256")
    .update(JSON.stringify(imageNames.map((name) => images[name])))
    .digest("hex");
}

/**
 * Reads `docker buildx bake --metadata-file` output. Each target reports its
 * pushed manifest-list digest; the image name must be the expected repository.
 */
export function imagesFromBakeMetadata(
  metadata: unknown,
  registry: string,
): Images {
  const targets = z
    .record(
      z.string(),
      z
        .object({
          "containerimage.digest": z.string(),
          "image.name": z.string(),
        })
        .passthrough(),
    )
    .parse(metadata);
  const images = {} as Images;
  for (const name of imageNames) {
    const target = targets[name];
    if (!target)
      throw new Error(`The build did not produce the ${name} image.`);
    const repository = `${registry}/lictory-${name}`;
    if (
      !target["image.name"]
        .split(",")
        .some((tag) => tag.startsWith(`${repository}:`))
    )
      throw new Error(
        `The ${name} image was pushed to an unexpected repository.`,
      );
    images[name] = `${repository}@${target["containerimage.digest"]}`;
  }
  return assertImages(images, registry);
}

/** The release file deploy.sh accepts (deploy/deploy.sh `prepare`). */
export function releaseFile(manifest: Manifest, images: Images): string {
  return [
    `LICTORY_VERSION=${manifest.version}`,
    `LICTORY_GIT_SHA=${manifest.sha}`,
    `LICTORY_CHANNEL=${manifest.channel}`,
    `API_IMAGE=${images.api}`,
    // No marketing image is built (the website runs on Cloudflare); installed
    // deploy.sh versions still require the key, so it repeats the API image.
    `MARKETING_IMAGE=${images.marketing ?? images.api}`,
    `PROXY_IMAGE=${images.proxy}`,
    `MIGRATE_IMAGE=${images.migrate}`,
    `OPS_IMAGE=${images.ops}`,
    "",
  ].join("\n");
}

export type BuildConfiguration = {
  registry: string;
  sourceUrl: string;
  /** Proxy image of the release being replaced; keeps its hashed assets. */
  previousProxyImage?: string;
  /** Registry namespace for BuildKit layer caches (one cache image per target). */
  cacheRegistry?: string;
  architecture?: "amd64" | "arm64";
};

export type Command = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<void>;

// Streams build output to the job log.
export const runCommand: Command = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { ...options, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });

export function bakeEnvironment(
  manifest: Manifest,
  config: BuildConfiguration,
): Record<string, string> {
  assertRegistry(config.registry);
  if (config.previousProxyImage)
    assertImage("proxy", config.previousProxyImage, config.registry);
  return {
    REGISTRY: config.registry,
    VERSION: manifest.version,
    GIT_SHA: manifest.sha,
    CHANNEL: manifest.channel,
    SOURCE_URL: config.sourceUrl,
    PREVIOUS_PROXY_IMAGE: config.previousProxyImage ?? "no-previous-assets",
    CACHE_REGISTRY: config.cacheRegistry ?? `${config.registry}/lictory-cache`,
    CACHE_SCOPE: `${manifest.channel}-${config.architecture ?? "multi"}`,
    TAG_SUFFIX: config.architecture ? `-${config.architecture}` : "",
    ...(config.architecture
      ? { PLATFORMS: `linux/${config.architecture}` }
      : {}),
  };
}

/** Builds and pushes backend images for the configured platform(s). */
export async function buildImages(
  root: string,
  manifest: Manifest,
  config: BuildConfiguration,
  command: Command = runCommand,
): Promise<Images> {
  const directory = await mkdtemp(join(tmpdir(), "lictory-bake-"));
  const metadata = join(directory, "metadata.json");
  try {
    await command(
      "docker",
      [
        "buildx",
        "bake",
        "--file",
        "deploy/docker-bake.hcl",
        "--push",
        // An SBOM and full provenance in every image index, also when an
        // older selected source (a maintenance branch) predates them in its
        // bake file. Publication reads the SBOMs back for the release.
        "--sbom=true",
        "--provenance=mode=max",
        // Override tags even for an older selected source whose bake file
        // predates TAG_SUFFIX. Architecture jobs must never overwrite each other.
        ...imageNames,
        ...(config.architecture
          ? imageNames.flatMap((name) => [
              "--set",
              `${name}.tags=${config.registry}/lictory-${name}:${manifest.version}-${config.architecture}`,
            ])
          : []),
        "--metadata-file",
        metadata,
      ],
      {
        cwd: root,
        env: { ...process.env, ...bakeEnvironment(manifest, config) },
      },
    ).catch(() => {
      throw new Error("Image build failed. Inspect the build log, then retry.");
    });
    return imagesFromBakeMetadata(
      JSON.parse(await readFile(metadata, "utf8")) as unknown,
      config.registry,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
