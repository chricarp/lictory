import { z } from "zod";
import { fingerprint, type Manifest } from "@lictory/core/release/model";
import {
  assertImages,
  imageNames,
  imagesSchema,
  type Command,
  type Images,
} from "@lictory/core/release/images";

const architectureBuildSchema = z.object({
  architecture: z.enum(["amd64", "arm64"]),
  manifestHash: z.string(),
  previousProxyImage: z.string().optional(),
  images: imagesSchema,
});

/** Join only the native ARM64 build of this exact plan and previous asset set. */
export async function mergeArchitectureBuilds(
  metadata: unknown[],
  manifest: Manifest,
  registry: string,
  previousProxyImage: string | undefined,
  command: Command,
  cwd: string,
  digest: (tag: string) => Promise<string>,
): Promise<Images> {
  const builds = metadata.map((entry) => architectureBuildSchema.parse(entry));
  if (
    builds.length !== 1 ||
    builds[0]?.architecture !== "arm64" ||
    builds.some(
      (build) =>
        build.manifestHash !== fingerprint(manifest) ||
        build.previousProxyImage !== previousProxyImage,
    )
  )
    throw new Error(
      "Native image builds do not match this release plan and previous proxy.",
    );
  for (const build of builds) assertImages(build.images, registry);
  const images = {} as Images;
  await Promise.all(
    imageNames.map(async (name) => {
      const repository = `${registry}/lictory-${name}`;
      const tag = `${repository}:${manifest.version}`;
      await command(
        "docker",
        [
          "buildx",
          "imagetools",
          "create",
          "--tag",
          tag,
          "--tag",
          `${repository}:sha-${manifest.sha}-${manifest.channel}`,
          ...builds.map((build) => build.images[name]),
        ],
        { cwd, env: process.env },
      );
      images[name] = `${repository}@${await digest(tag)}`;
    }),
  );
  return assertImages(images, registry);
}
