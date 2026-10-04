# Next.js ESLint globbing

The scoped `fast-glob` override for `@next/eslint-plugin-next` replaces its
globbing dependency with `tinyglobby`, removing the `micromatch` → `braces` chain
affected by [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
All Next.js lint rules remain enabled.

The accompanying patch disables `expandDirectories` because `tinyglobby`
otherwise recursively expands literal directory paths. It also preserves absolute
paths when the configured root is absolute. These options preserve Next.js
project-root discovery for paths and globs; see the
[migration guide](https://superchupu.dev/tinyglobby/migration).

Keep the override and patch together when upgrading the plugin, and verify its
project-root discovery and internal-link lint rule. Remove both once an upstream
release removes or fixes the vulnerable dependency chain.
