import type { Manifest } from "./model";

export type Build = { id: string; url: string };
export type ReleasePorts = {
  validate: () => Promise<void>;
  active: () => Promise<Build | undefined>;
  build: () => Promise<Build>;
  record: (build: Build) => Promise<number>;
  status: (
    id: number,
    state: "in_progress" | "success" | "failure",
    build: Build,
  ) => Promise<void>;
  migrate: () => Promise<void>;
  reserve: () => Promise<void>;
  promote: (build: Build) => Promise<void>;
  publish: () => Promise<void>;
};

// Every activation is after source validation, a configured build and migration.
// An already active matching deployment repairs publication without reactivation.
export async function executeRelease(
  manifest: Manifest,
  ports: ReleasePorts,
): Promise<Build> {
  await ports.validate();
  const active = await ports.active();
  if (active) {
    const record = await ports.record(active);
    await ports.reserve();
    await ports.status(record, "success", active);
    await ports.publish();
    return active;
  }
  const build = await ports.build();
  const record = await ports.record(build);
  await ports.status(record, "in_progress", build);
  try {
    await ports.migrate();
    await ports.validate();
    // Reserve stable tags only after gates pass, so a failed migration does not
    // consume the version before a corrected candidate can be selected.
    await ports.reserve();
    // Nightly publication is another pre-activation gate. A GitHub outage must
    // not replace the working nightly alias. Stable publishes after activation.
    if (manifest.channel === "nightly") await ports.publish();
    await ports.promote(build);
    await ports.status(record, "success", build);
    if (manifest.channel === "stable") await ports.publish();
    return build;
  } catch (error) {
    // Success can be repaired from the active Vercel deployment on retry.
    await ports.status(record, "failure", build).catch(() => undefined);
    throw new Error(
      `${manifest.tag} failed; retry the workflow. A migration is never automatically reversed.`,
      { cause: error },
    );
  }
}
