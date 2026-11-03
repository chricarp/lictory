// Copies the shared brand artwork from @lictory/ui into public/, so the docs
// site serves the logo at the same paths as the application and the website.
// The copy is gitignored; packages/ui/public is the only source.
import { cpSync, rmSync } from "node:fs";

const target = new URL("../public/brand", import.meta.url);
rmSync(target, { recursive: true, force: true });
cpSync(new URL("../../../packages/ui/public/brand", import.meta.url), target, {
  recursive: true,
});
