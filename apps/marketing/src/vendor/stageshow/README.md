# Stageshow kit (vendored)

The part of the [Stageshow](https://github.com/benjitaylor/skills/tree/main/stageshow)
kit that the website's illustrations use: the stage and its script, the
window frame, and a few motion and small parts. Copyright 2026 Benji Taylor,
MIT licensed (see `LICENSE`). The full skill, its references, examples and
filming tools live in `.agents/skills/stageshow`.

It is kept as upstream wrote it, so it can be refreshed from the skill, with
one local change: a few index accesses gained non-null assertions or
defaults to satisfy this repository's `noUncheckedIndexedAccess`. Lint and
formatting skip this folder; TypeScript checks it.

The scenes built on it are in `src/components/landing/scenes`.
