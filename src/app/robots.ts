import type { MetadataRoute } from "next";

import { absoluteUrl, guidesFeedPath } from "~/lib/site";

// Search engines and AI assistants named explicitly, so the policy for each is
// deliberate rather than inherited. They read the public website only; the
// workspace requires a session and asks crawlers not to index it.
const searchAndAiCrawlers = [
  // Bingbot also feeds Microsoft Copilot, DuckDuckGo and ChatGPT search.
  "Googlebot",
  "Bingbot",
  "DuckDuckBot",
  "Applebot",
  "YandexBot",
  "Baiduspider",
  // Opt-in tokens for AI products built on search crawls (Gemini, Apple Intelligence).
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
  // Perplexity, DuckDuckGo AI answers, Mistral, Meta, Amazon, Common Crawl.
  "PerplexityBot",
  "Perplexity-User",
  "DuckAssistBot",
  "MistralAI-User",
  "meta-externalagent",
  "meta-externalfetcher",
  "Amazonbot",
  "CCBot",
];

// API and analytics relay responses are not pages, and /markdown/ is only the
// internal target of the public `<page>.md` URLs. Workspace URLs stay crawlable
// so link unfurlers can read their safe, noindex social previews.
const disallow = ["/api/", "/relay/", "/markdown/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      { userAgent: searchAndAiCrawlers, allow: "/", disallow },
    ],
    // Google and Bing accept RSS feeds as sitemaps and revisit them more often,
    // so new guides are found sooner.
    sitemap: [absoluteUrl("/sitemap.xml"), absoluteUrl(guidesFeedPath)],
  };
}
