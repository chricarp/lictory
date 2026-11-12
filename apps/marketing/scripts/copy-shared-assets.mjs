// Copies the shared brand artwork from @lictory/ui into public/, so the
// website serves it at the same paths as the application. The copies are
// gitignored; packages/ui/public is the only source.
import { cpSync, rmSync } from "node:fs";

for (const folder of ["brand"]) {
  const target = new URL(`../public/${folder}`, import.meta.url);
  rmSync(target, { recursive: true, force: true });
  cpSync(
    new URL(`../../../packages/ui/public/${folder}`, import.meta.url),
    target,
    {
      recursive: true,
    },
  );
}
