# Documentation authoring

`docs/` is the canonical documentation source for GitHub and a future website.
Use ordinary Markdown and relative links. Product guides live in `guides/`,
operator instructions in `operations/`, and durable concepts in `internals/`.
Keep contribution rules at the repository root. Do not put temporary agent
plans or generated website output in documentation.

Add a page to `docs/README.md` and `docs/navigation.json`. The versioned manifest
records sections, paths and display titles without coupling content to a site
framework. Paths are relative to `docs/`; each published page appears once.
Every Markdown page except the index must appear in navigation.

```sh
bun run docs:check
bun run docs:export
```

`docs:check`, also part of `bun run check`, validates navigation, page coverage
and local file links in docs and contributor entry points. It parses Markdown
(including GFM) instead of treating code examples as links. External URL
availability and heading fragments are not checked; review those in rendered
content when changing them.

`docs:export` performs the same checks and writes `.docs-build/content.json`,
which is ignored by Git. The export includes versioned navigation, a stable
route derived from each path, title, section and raw Markdown. A future website
can use it for rendering, search and edit links without duplicating sources.
Render Markdown links against source paths when importing it; links to files
outside `docs/` should resolve to the selected source repository, and image and
heading links need the website's normal Markdown handling.

## Future website

A documentation website should build separately from the application and
without a database, authentication secrets, cloud credentials or customer data.
This change provides content and validation, not a website or automatic
publishing. Choose a renderer when there is a concrete site brief; no new site
framework or dependency is required to edit documentation now.

Keep documentation versions aligned to release tags. Preserve routes or add
redirects when moving published pages. Set a public repository/edit-link base
only after the repository identity is settled. Review content against the
implemented behavior: supported providers and self-hosting limits must not be
inferred from a future roadmap.
