// Preloaded by `bun test` (bunfig.toml). Bun's 5 s default fails integration
// tests that create databases or run shell installers whenever a contributor's
// machine is busy, which says nothing about the change under test. Tests keep
// explicit budgets where they need a tighter or longer one.
//
// With --isolate or --parallel this preload applies to every file. A plain
// `bun test` over several files (Bun 1.4) applies it to the first file only and
// the others keep the 5 s default, so focused runs use --isolate as well.
//
// The repository has no Bun type definitions (tests use node:test), hence the
// untyped specifier.
const runner = ["bun", "test"].join(":");
const { setDefaultTimeout } = (await import(runner)) as {
  setDefaultTimeout: (ms: number) => void;
};

setDefaultTimeout(60_000);

export {};
