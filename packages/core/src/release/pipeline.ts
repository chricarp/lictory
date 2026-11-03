import type { Images } from "@lictory/core/release/images";
import type { Manifest } from "@lictory/core/release/model";

/** One built image set: `id` identifies the digests, `url` its release page. */
export type Build = { id: string; url: string; images: Images };
export type ReleasePorts = {
  validate: () => Promise<void>;
  /** The journaled build of exactly this release, when a retry finds one. */
  active: () => Promise<Build | undefined>;
  build: () => Promise<Build>;
  record: (build: Build) => Promise<number>;
  status: (
    id: number,
    state: "in_progress" | "success" | "failure",
    build: Build,
  ) => Promise<void>;
  /** Tags the source and reserves its draft release with the build's assets. */
  reserve: (build: Build) => Promise<void>;
  publish: () => Promise<void>;
};

// Releases publish; they deploy nothing. Nightly and stable follow the same
// path: validation, a build, the reserved tag with its release.env, then
// publication. Installations upgrade themselves (lictory upgrade), so a
// release has no server to migrate or activate. A retry that finds the
// journaled build repairs publication without rebuilding.
export async function executeRelease(
  manifest: Manifest,
  ports: ReleasePorts,
): Promise<Build> {
  await ports.validate();
  const active = await ports.active();
  if (active) {
    const record = await ports.record(active);
    await ports.reserve(active);
    await ports.status(record, "success", active);
    await ports.publish();
    return active;
  }
  const build = await ports.build();
  const record = await ports.record(build);
  await ports.status(record, "in_progress", build);
  try {
    await ports.validate();
    await ports.reserve(build);
    await ports.publish();
    await ports.status(record, "success", build);
    return build;
  } catch (error) {
    await ports.status(record, "failure", build).catch(() => undefined);
    throw new Error(`${manifest.tag} failed; retry the workflow.`, {
      cause: error,
    });
  }
}
