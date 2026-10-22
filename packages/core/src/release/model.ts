import { createHash } from "node:crypto";
import { z } from "zod";
import {
  conventionalTitle,
  nightlyVersion,
  stableParts,
} from "@lictory/core/release/version";

export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const changeSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    notes: z.string(),
    mergedAt: z.string().datetime(),
    mergeSha: shaSchema,
    author: z.string(),
    directCommits: z.array(shaSchema),
    stableApi: z.boolean(),
  })
  .strict();
export type Change = z.infer<typeof changeSchema>;
export const baselineSchema = z
  .object({ version: z.string(), tag: z.string().nullable(), sha: shaSchema })
  .strict();
export type Baseline = z.infer<typeof baselineSchema>;
export const manifestSchema = z
  .object({
    schema: z.literal(1),
    repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    channel: z.enum(["nightly", "stable"]),
    tag: z.string(),
    version: z.string(),
    stableVersion: z.string(),
    sha: shaSchema,
    sourceBranch: z.string().regex(/^(main|release\/\d+\.\d+)$/),
    baseline: baselineSchema,
    run: z
      .object({
        id: z.number().int().positive(),
        number: z.number().int().positive(),
        createdAt: z.string().datetime(),
      })
      .strict(),
    changes: z.array(changeSchema),
    nightlyNotes: z
      .object({
        tag: z.string(),
        sha: shaSchema,
        changes: z.array(changeSchema),
      })
      .strict()
      .nullable(),
    sourceNightly: z.string().nullable(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    try {
      stableParts(manifest.stableVersion);
      stableParts(manifest.baseline.version);
      const expected =
        manifest.channel === "nightly"
          ? nightlyVersion(
              manifest.stableVersion,
              manifest.run.createdAt,
              manifest.run.number,
            )
          : manifest.stableVersion;
      if (manifest.version !== expected || manifest.tag !== `v${expected}`)
        throw new Error(
          "Manifest version/tag does not match its channel and run.",
        );
      if (manifest.channel === "stable" && !manifest.sourceNightly)
        throw new Error(
          "Stable releases must identify their verified nightly.",
        );
      if (manifest.channel === "stable" && manifest.nightlyNotes)
        throw new Error(
          "Stable notes must cover the complete stable release range.",
        );
      if (manifest.channel === "nightly" && manifest.sourceNightly !== null)
        throw new Error(
          "Nightly releases must originate from their triggering commit.",
        );
      if (
        manifest.channel === "stable" &&
        manifest.sourceNightly !==
          `v${nightlyVersion(manifest.stableVersion, manifest.run.createdAt, manifest.run.number)}`
      )
        throw new Error(
          "Stable provenance must identify the exact selected nightly version.",
        );
      if (
        manifest.baseline.tag !== null &&
        manifest.baseline.tag !== `v${manifest.baseline.version}`
      )
        throw new Error("Stable baseline tag/version mismatch.");
      for (const change of manifest.changes) {
        const title = conventionalTitle(change.title);
        if (change.stableApi && !title.breaking)
          throw new Error(
            "Stable API declarations require breaking PR titles.",
          );
      }
      if (
        new Set(manifest.changes.map((change) => change.number)).size !==
        manifest.changes.length
      )
        throw new Error("Duplicate PRs in release manifest.");
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid manifest",
      });
    }
  });
export type Manifest = z.infer<typeof manifestSchema>;

export function fingerprint(manifest: Manifest): string {
  return createHash("sha256")
    .update(JSON.stringify(manifestSchema.parse(manifest)))
    .digest("hex");
}

export function sameManifest(a: Manifest, b: Manifest): void {
  if (fingerprint(a) !== fingerprint(b))
    throw new Error(
      `Immutable release collision: ${a.tag} already records different source or release metadata.`,
    );
}

export function changelog(manifest: Manifest): string {
  const sections = new Map<string, string[]>();
  for (const change of manifest.nightlyNotes?.changes ?? manifest.changes) {
    const title = conventionalTitle(change.title);
    const category = title.breaking
      ? "Breaking changes"
      : title.type === "feat"
        ? "Added"
        : title.type === "fix"
          ? "Fixed"
          : title.type === "perf"
            ? "Performance"
            : "Maintenance";
    const text = (change.notes || title.description)
      .replaceAll("\r", "")
      .replace(/^[-*] /, "")
      .trim();
    const attribution = `([#${change.number}](https://github.com/${manifest.repository}/pull/${change.number}), @${change.author})`;
    const lines = sections.get(category) ?? [];
    lines.push(`- ${text.replaceAll("\n", "\n  ")} ${attribution}`);
    sections.set(category, lines);
  }
  const heading =
    manifest.channel === "nightly"
      ? `Nightly candidate for ${manifest.stableVersion}. This is a prerelease.`
      : `Lictory ${manifest.version}`;
  const changes = [
    "Breaking changes",
    "Added",
    "Fixed",
    "Performance",
    "Maintenance",
  ]
    .filter((name) => sections.has(name))
    .map((name) => `### ${name}\n\n${sections.get(name)!.join("\n")}`)
    .join("\n\n");
  const base =
    manifest.nightlyNotes?.tag ??
    manifest.baseline.tag ??
    manifest.baseline.sha;
  return `${heading}\n\n${changes || "No new release-worthy PRs."}\n\n[Changes since ${manifest.nightlyNotes?.tag ?? manifest.baseline.version}](https://github.com/${manifest.repository}/compare/${base}...${manifest.sha})\n\nSource: \`${manifest.sha}\`${manifest.sourceNightly ? `\n\nVerified nightly: \`${manifest.sourceNightly}\`` : ""}\n`;
}
