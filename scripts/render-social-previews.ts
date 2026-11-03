// Renders the platform's link preview cards, one per kind of page, into
// packages/ui/public/social/<kind>.png. The platform serves them as static
// files, so shared links preview correctly without a separate website. The
// cards use the website's renderer, so both stay identical. Rerun after
// changing the card design or the preview vocabulary, and commit the images.
//
// Usage: bun scripts/render-social-previews.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ogCard, sharedWorkCard } from "../apps/marketing/src/lib/og-card";
import {
  previewLabels,
  socialPreviewImagePath,
  type PreviewKind,
} from "../packages/core/src/lib/social-preview-kind";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = `${root}packages/ui/public`;

// The renderer reads the logo from the website's public directory.
process.chdir(`${root}apps/marketing`);
execFileSync("node", ["scripts/copy-shared-assets.mjs"], { stdio: "inherit" });

mkdirSync(`${output}/social`, { recursive: true });
for (const [kind, label] of Object.entries(previewLabels) as [
  PreviewKind,
  string,
][]) {
  const image = await ogCard(sharedWorkCard(label));
  if (!image.ok) throw new Error(`Rendering the ${kind} card failed.`);
  writeFileSync(
    `${output}${socialPreviewImagePath(kind)}`,
    Buffer.from(await image.arrayBuffer()),
  );
  console.log(socialPreviewImagePath(kind));
}
