# Search and AI discoverability

The public website (`apps/marketing`, served at `lictory.com`: landing page,
guides, comparisons and legal notices) is written for
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
  The analytics relay and the internal `/markdown/` route are disallowed.
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
- **Markdown pages**: the guides index, each guide, each comparison and each
  alternatives or roundup page are also
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
  `SoftwareApplication` (its free offer links to the installation guide on
  `docs.lictory.com`) and the
  `FAQPage`. Guides, comparisons, alternatives pages and the legal notices
  publish their own `WebPage` and `BreadcrumbList` with the shared
  `Organization` and `WebSite`; comparisons and alternatives pages add the same
  `SoftwareApplication` node and their `FAQPage` (roundups also an `ItemList`
  naming the listed products, without claims about them), because search engines do not resolve `@id` references across
  pages. Payloads escape `<` so content can never close the script element.
  Never add ratings, reviews or prices that the page does not show.
- **Metadata**: every indexable public page gets its own title, description,
  canonical URL, Open Graph and Twitter card from the shared site facts. The
  web app manifest and `theme-color` give browsers, installed apps and search
  results consistent branding.
- **Robots meta**: public pages allow full snippets and large image previews.
  Lictory itself runs on each team's own server, never on this origin, so the
  sitemap has no account or workspace pages.
- Content that is collapsed for people (comparison rows, FAQ answers) stays in
  the HTML and is only hidden visually, so crawlers read all of it.

## Guides, comparisons and alternatives

`/guides/*`, `/compare/*`, `/alternatives/*`, `/self-hosted-jira-alternative`
and `/best-requirements-management-tools` are statically generated from the
content modules in `src/content/`. They give search engines and AI assistants pages that answer
specific questions (what is a Definition of Ready, how does Lictory compare with
Jira) instead of one landing page competing for every query. Each page has its
own generated social card, a visible breadcrumb matching its `BreadcrumbList`,
and an `Article` or `FAQPage` node. `lastmod` is the date in the content module;
change it only for material edits. The full text of the guides and comparisons
is also in `/llms-full.txt`.

Guides lead with product-neutral advice and describe Lictory only where it
applies. Comparisons say where other products fit better and must not claim
integrations Lictory does not have: publishing is to Jira Cloud today, and
Linear is described as coming.

Facts about other products (license, hosting, pricing model, Jira import) live
once, in the product profiles of `src/content/products.ts`, and every page that
mentions a product reads them from there. Each profile lists the vendor pages
it was checked against and the date of that check; pages show the sources and a
"Last reviewed" date. Only state what the vendor's own website, documentation
or repository says; when something cannot be confirmed there, leave it out or
mark the capability "Not documented" rather than guess. Lictory's own
limitations (no importer, no Gantt or time tracking, OpenID Connect only, Jira
Cloud only) are stated as plainly as anyone else's. Re-check the profiles before
changing their `reviewed` date. Pages about the same products answer different
questions (open-source licensing versus running it yourself) and must stay
distinct rather than become near-duplicates.

## Boundaries

Only public, closed facts about the product belong in these files. Never expose
organization, project, item or user data, and never load workspace data to build
them. The website has no database, session or authentication, and no hosted
application stands behind it: Lictory is only self-hosted. The same page is
served to everyone, and its calls to action are fixed links
(`apps/marketing/src/lib/get-started.ts`): **Get started** leads to the
installation guide (`docs.lictory.com/self-hosting/install`) and **GitHub** to
the source repository.

Paths of the former hosted application (`/app/...`, `/sign-in`, `/sign-up` and
the other account pages) are not redirected any more; they are ordinary
missing pages. `/home`, once the landing page for signed-in people, still
redirects to `/`.

The files are generated at build time from `SITE_URL`, which must be the
canonical HTTPS origin (unset, the build falls back to the local development
origin); no request Host header is used. Rebuild after changing it.

Allowing AI crawlers is a product decision: being cited by AI assistants is
worth more to Lictory than keeping public marketing copy out of their training
data. Revisit the crawler list in `robots.txt` if that changes.

Search-engine ownership (Google Search Console, Bing Webmaster Tools) is
verified through DNS records on the domain, so no verification tokens live in
the code. Submit `/sitemap.xml` in both after deployment; Bing also feeds
Copilot and DuckDuckGo.

## Social link previews

Public cards must never disclose workspace data. Workspace routes select a
closed page category: no titles, identifiers, organization or project names,
custom type names, people, content, progress or approval state. Building a card
never queries the database or confirms that an item exists.

The API injects category metadata into the platform's SPA HTML, alongside its
public configuration. The shell contains no work item data; protected APIs and
synchronized queries enforce authentication and membership. HTML responses use
`Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.

The marketing website generates `/og/<kind>` images at build time with Next.js
ImageResponse and local assets. Absolute image URLs use the configured
`SITE_URL`, never the request Host header. Only category images can be publicly
cached. Richer previews would need an explicit disclosure policy and recipient
authorization; private fields must never be added to these public cards.
