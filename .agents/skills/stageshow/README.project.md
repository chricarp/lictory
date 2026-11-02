# Project installation

Installed from [benjitaylor/skills](https://github.com/benjitaylor/skills/tree/main/stageshow).
Copyright 2026 Benji Taylor, MIT licensed. The upstream skill and its examples,
kit, references and tooling are preserved.

The website's illustrations (`apps/marketing/src/components/landing/scenes`)
are built with it. They run on the copy of the kit parts they use in
`apps/marketing/src/vendor/stageshow`, styled with Lictory's product tokens
(`scenes/lictory-look.css`). Refresh that copy from `kit/` here when updating.

To film a scene on the running website with the tools in `scripts/`, run
`npm install` in this folder, then for example:

```sh
CHROME_PATH=<a Chrome or Chromium binary> \
  node scripts/film.mjs http://localhost:3100/ --select '.hs' --states --out hero.png
```
