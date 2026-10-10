import type { MetadataRoute } from "next";

import { absoluteUrl, siteUrl } from "~/lib/site";

// Search engines and AI assistants named explicitly, so the policy for each is
// deliberate rather than inherited. They read the public website only; the
// workspace requires a session and asks crawlers not to index it.
const searchAndAiCrawlers = [
  "Googlebot",
  "Bingbot",
  "DuckDuckBot",
  "Applebot",
  "YandexBot",
  "Baiduspider",
  // Opt-in tokens for AI products built on search crawls.
  "Google-Extended",
  "Applebot-Extended",
  // OpenAI (ChatGPT search, browsing and training).
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  // Anthropic (Claude search, browsing and training).
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  // Perplexity, Microsoft Copilot, Meta, Mistral, Amazon, Common Crawl.
  "PerplexityBot",
  "Perplexity-User",
  "MistralAI-User",
  "meta-externalagent",
  "Amazonbot",
  "CCBot",
];

// API and analytics relay responses are not pages. Workspace URLs stay
// crawlable so link unfurlers can read their safe, noindex social previews.
const disallow = ["/api/", "/relay/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      { userAgent: searchAndAiCrawlers, allow: "/", disallow },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteUrl,
  };
}
