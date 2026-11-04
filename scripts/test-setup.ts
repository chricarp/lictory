// Preloaded by `bun test` (bunfig.toml). Bun's 5 s default fails integration
// tests that create databases or run shell installers whenever a contributor's
// machine is busy, which says nothing about the change under test. Tests keep
// explicit budgets where they need a tighter or longer one.
//
// The repository has no Bun type definitions (tests use node:test), hence the
// untyped specifier.
const runner = ["bun", "test"].join(":");
const { setDefaultTimeout } = (await import(runner)) as {
  setDefaultTimeout: (ms: number) => void;
};

setDefaultTimeout(60_000);

export {};
