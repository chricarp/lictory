# Search and AI discoverability

The public website (landing page, sign-up and legal notices) is written for
three audiences at once: people, search engines and AI assistants such as
ChatGPT, Claude, Gemini, Copilot and Perplexity. They must read one consistent
story, so every machine-readable description is generated from the same source
as the visible page:

- Site facts (origin, name, title, description, summary, public pages) live in
  one module. Metadata, structured data, the sitemap and `llms.txt` read it.
- Landing FAQ and comparison copy live in one module that renders the page,
  the schema.org `FAQPage` and `featureList`, and the `llms.txt` overview.
  Change the copy there and every surface follows. Never add claims to
  structured data or `llms.txt` that the page itself does not make.

## What is published

- **`/robots.txt`** allows all crawlers on the public website and names major
  search and AI crawlers explicitly so the policy for each is deliberate.
  `/api/`, the analytics relay and the internal `/markdown/` route are
  disallowed. Workspace URLs are not
  disallowed: link unfurlers that obey robots.txt (for example Twitterbot and
  LinkedIn) must still read their safe social previews, and those pages carry
  `noindex, nofollow` instead. See [social link previews](./social-previews.md).
  It lists the guides RSS feed as a second sitemap, because Google and Bing
  revisit feeds more often. There is no `Host` line: Google ignores it and
  Yandex retired it.
- **`/sitemap.xml`** lists only public, indexable pages. `lastmod` is reported
  only where the change date is known (the legal notices' version date), never
  the build time, because search engines ignore inaccurate dates. The landing
  entry includes its social card as an image-sitemap entry.
- **`/llms.txt`** and **`/llms-full.txt`** follow the llms.txt convention: a
  short Markdown index and a complete product overview for AI assistants. The
  landing page links to the index with `rel="alternate"`. The index links to
  the Markdown version of a page where one exists.
- **Markdown pages**: the guides index, each guide and each comparison are also
  served as Markdown at the page URL plus `.md` (`/guides/definition-of-ready.md`),
  so AI assistants and agents can read them without navigation or scripts. The
  HTML page advertises it with `rel="alternate" type="text/markdown"`, and the
  Markdown response names the HTML page as canonical in a `Link` header so
  search engines index the page, not the copy. The `.md` URLs are rewrites to
  `/markdown/...`; that internal path is disallowed in robots.txt.
- **`/guides/feed.xml`** is an RSS feed of the guides, linked from the landing
  page and every guide. Dates come from the content, never the build.
- **JSON-LD** on the landing page describes the `Organization` (with logo),
  `WebSite`, `WebPage` and its primary image, the product as a
  `WebApplication` and the `FAQPage`. Sign-up and the legal notices publish
  their own `WebPage` and `BreadcrumbList` with the shared `Organization` and
  `WebSite`, because search engines do not resolve `@id` references across
  pages. Payloads escape `<` so content can never close the script element.
  Never add ratings, reviews or prices that the page does not show.
- **Metadata**: every indexable public page gets its own title, description,
  canonical URL, Open Graph and Twitter card from the shared site facts. The
  web app manifest and `theme-color` give browsers, installed apps and search
  results consistent branding.
- **Robots meta**: public pages allow full snippets and large image previews.
  Workspace and account pages are `noindex`; sign-up is the one account page
  that stays indexable, with a canonical URL that drops query parameters. The
  landing page is also served at `/home` and declares `/` as canonical.
- Content that is collapsed for people (comparison rows, FAQ answers) stays in
  the HTML and is only hidden visually, so crawlers read all of it.

## Guides and comparisons

`/guides/*` and `/compare/*` are statically generated from the content modules
in `src/content/`. They give search engines and AI assistants pages that answer
specific questions (what is a Definition of Ready, how does Lictory compare with
Jira) instead of one landing page competing for every query. Each page has its
own generated social card, a visible breadcrumb matching its `BreadcrumbList`,
and an `Article` or `FAQPage` node. `lastmod` is the date in the content module;
change it only for material edits. The full text of the guides and comparisons
is also in `/llms-full.txt`.

Guides lead with product-neutral advice and describe Lictory only where it
applies. Comparisons state other products' built-in capabilities as we
understand them, say where those products fit better, and must not claim
integrations Lictory does not have: publishing is to Jira Cloud today, and
Linear is described as coming.

## Boundaries

Only public, closed facts about the product belong in these files. Never expose
organization, project, item or user data, and never load workspace data to build
them. They are generated at build time from `BETTER_AUTH_URL`, which must be the
canonical HTTPS origin; no request Host header is used.

Allowing AI crawlers is a product decision: being cited by AI assistants is
worth more to Lictory than keeping public marketing copy out of their training
data. Revisit the crawler list in `robots.txt` if that changes.

Search-engine ownership (Google Search Console, Bing Webmaster Tools) is
verified through DNS records on the domain, so no verification tokens live in
the code. Submit `/sitemap.xml` in both after deployment; Bing also feeds
Copilot and DuckDuckGo.
