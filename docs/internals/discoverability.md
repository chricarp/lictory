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
  `/api/` and the analytics relay are disallowed. Workspace URLs are not
  disallowed: link unfurlers that obey robots.txt (for example Twitterbot and
  LinkedIn) must still read their safe social previews, and those pages carry
  `noindex, nofollow` instead. See [social link previews](./social-previews.md).
- **`/sitemap.xml`** lists only public, indexable pages.
- **`/llms.txt`** and **`/llms-full.txt`** follow the llms.txt convention: a
  short Markdown index and a complete product overview for AI assistants. The
  landing page links to the index with `rel="alternate"`.
- **JSON-LD** on the landing page describes the `Organization`, `WebSite`,
  `WebPage`, `SoftwareApplication` and `FAQPage`. Payloads escape `<` so content
  can never close the script element.
- **Robots meta**: public pages allow full snippets and large image previews.
  Workspace and account pages are `noindex`; sign-up is the one account page
  that stays indexable, with a canonical URL that drops query parameters. The
  landing page is also served at `/home` and declares `/` as canonical.
- Content that is collapsed for people (comparison rows, FAQ answers) stays in
  the HTML and is only hidden visually, so crawlers read all of it.

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
