import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  imageNames,
  type ImageName,
  type Images,
} from "@lictory/core/release/images";
import { releaseArchitectures } from "@lictory/core/release/parallel-images";

// Supply-chain evidence of a release. BuildKit records an SBOM and a
// mode=max provenance in every image index (deploy/docker-bake.hcl); the
// workflows sign each index digest with cosign and attest it on GitHub
// (.github/actions/sign-images), which also covers the attestation manifests
// the index lists. The release carries copies for people who read files
// rather than registries: an SPDX SBOM per image and platform, and the
// third-party license report. See docs/operations/releases.md.

/** One image of a release as attestations name it: repository and digest. */
type Subject = { name: string; digest: string };

/** The signing and attestation subjects of a release's images. */
export function attestationSubjects(
  images: Images,
): Record<ImageName, Subject> {
  return Object.fromEntries(
    imageNames.map((name) => {
      const [repository, digest] = images[name].split("@");
      return [name, { name: repository!, digest: digest! }];
    }),
  ) as Record<ImageName, Subject>;
}

type ReleaseAsset = { name: string; body: string };

// `docker buildx imagetools inspect <ref> --format '{{json .SBOM}}'` of an
// index: one entry per platform whose SBOM attestation BuildKit recorded.
const sbomSchema = z.record(
  z.string(),
  z.object({ SPDX: z.record(z.string(), z.unknown()) }).passthrough(),
);

/**
 * The SPDX SBOM of every release image on every release platform, read from
 * the attestations in the registry. A missing SBOM blocks the release: its
 * images were built without attestations, and publishing it would ship a
 * release that operators cannot audit like the others.
 */
export async function sbomAssets(
  images: Images,
  inspect: (reference: string) => Promise<unknown>,
): Promise<ReleaseAsset[]> {
  const assets: ReleaseAsset[] = [];
  for (const name of imageNames) {
    const sboms = sbomSchema.parse(await inspect(images[name]));
    for (const architecture of releaseArchitectures) {
      const platform = `linux/${architecture}`;
      const sbom = sboms[platform];
      if (!sbom)
        throw new Error(
          `The ${name} image has no SBOM attestation for ${platform}: it was built without attestations. Publish a new candidate built by the current release workflow instead.`,
        );
      assets.push({
        name: `lictory-${name}-linux-${architecture}.spdx.json`,
        body: `${JSON.stringify(sbom.SPDX, null, 2)}\n`,
      });
    }
  }
  return assets;
}

/** The license report (`bun run licenses:report <directory>`) as release assets. */
export async function licenseAssets(
  directory: string,
): Promise<ReleaseAsset[]> {
  return [
    {
      name: "third-party-licenses.json",
      body: await readFile(join(directory, "inventory.json"), "utf8"),
    },
    {
      name: "THIRD_PARTY_NOTICES.txt",
      body: await readFile(join(directory, "THIRD_PARTY_NOTICES.txt"), "utf8"),
    },
  ];
}
