// Checks a website's static export (apps/marketing, apps/docs) the way a
// search engine reads it, and fails the build when a page would be dropped
// from the index:
//
// - every sitemap URL is an exported page without noindex whose canonical
//   link is that same URL (one form: no trailing slash, no .html);
// - every other exported page is a not-found page and carries noindex, so no
//   page is missing from the sitemap and none is noindexed by accident;
// - titles and descriptions are unique, JSON-LD parses, robots.txt allows
//   crawling and names the sitemap, and llms.txt exists.
//
// Usage: [SITE_URL=<origin>] bun scripts/check-site-indexing.ts <export directory>

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root: string =
  process.argv[2] ??
  (() => {
    throw new Error("Usage: check-site-indexing.ts <export directory>");
  })();

const problems: string[] = [];
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
// `&amp;` last, so `&amp;lt;` stays the text `&lt;`.
const decode = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const attribute = (tag: string, name: string) =>
  decode(new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "");
const tags = (html: string, name: string) =>
  html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

// Next.js exports its not-found page under these names; the Worker answers
// them with status 404 (deploy/cloudflare/src/worker.ts).
const notFoundPages = new Set(["404.html", "_not-found.html"]);

function htmlFiles(directory = ""): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.posix.join(directory, entry.name);
      if (entry.isDirectory())
        return entry.name === "_next" ? [] : htmlFiles(file);
      return entry.name.endsWith(".html") ? [file] : [];
    })
    .sort();
}

function head(html: string) {
  const robots = tags(html, "meta")
    .filter((tag) => attribute(tag, "name").toLowerCase() === "robots")
    .map((tag) => attribute(tag, "content").toLowerCase());
  const canonicals = tags(html, "link")
    .filter((tag) => attribute(tag, "rel") === "canonical")
    .map((tag) => attribute(tag, "href"));
  const description = tags(html, "meta")
    .filter((tag) => attribute(tag, "name") === "description")
    .map((tag) => attribute(tag, "content"))[0];
  const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "");
  return { robots, canonicals, description, title };
}

const sitemap = read("sitemap.xml");
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) =>
  decode(match[1]!),
);
if (locations.length === 0) problems.push("sitemap.xml lists no URLs");
const origins = new Set(locations.map((location) => new URL(location).origin));
if (origins.size !== 1)
  problems.push(`sitemap.xml mixes origins: ${[...origins].join(", ")}`);
const origin = [...origins][0] ?? "";
// Deployments build with SITE_URL; a build without it uses the development
// origin, which must never reach production.
const expectedOrigin = process.env.SITE_URL?.trim();
if (expectedOrigin && origin !== new URL(expectedOrigin).origin)
  problems.push(
    `sitemap.xml uses ${origin}, but SITE_URL is ${expectedOrigin}`,
  );

const listed = new Set<string>();
const titles = new Map<string, string>();
const descriptions = new Map<string, string>();
for (const location of locations) {
  const url = new URL(location);
  const file =
    url.pathname === "/" ? "index.html" : `${url.pathname.slice(1)}.html`;
  listed.add(file);
  if (url.pathname !== "/" && url.pathname.endsWith("/"))
    problems.push(`${location}: sitemap URL has a trailing slash`);
  if (url.search || url.hash)
    problems.push(`${location}: sitemap URL has a query or fragment`);
  if (!existsSync(path.join(root, file))) {
    problems.push(`${location}: no exported page (${file})`);
    continue;
  }
  const { robots, canonicals, description, title } = head(read(file));
  if (robots.some((content) => /noindex|none/.test(content)))
    problems.push(
      `${location}: listed in the sitemap but noindex (${robots.join(" | ")})`,
    );
  if (canonicals.length !== 1)
    problems.push(
      `${location}: ${canonicals.length} canonical links, expected 1`,
    );
  else if (new URL(canonicals[0]!).href !== url.href)
    problems.push(`${location}: canonical is ${canonicals[0]}`);
  if (!title) problems.push(`${location}: no <title>`);
  else if (titles.has(title))
    problems.push(
      `${location}: same title as ${titles.get(title)} ("${title}")`,
    );
  else titles.set(title, location);
  if (!description) problems.push(`${location}: no meta description`);
  else if (descriptions.has(description))
    problems.push(
      `${location}: same description as ${descriptions.get(description)}`,
    );
  else descriptions.set(description, location);
}

for (const file of htmlFiles()) {
  const html = read(file);
  for (const [, json] of html.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      const data = JSON.parse(json!) as { "@context"?: unknown };
      if (data["@context"] !== "https://schema.org")
        problems.push(`${file}: JSON-LD without the schema.org context`);
    } catch {
      problems.push(`${file}: JSON-LD does not parse`);
    }
  }
  if (listed.has(file)) continue;
  const { robots } = head(html);
  if (!notFoundPages.has(file))
    problems.push(`${file}: exported page missing from sitemap.xml`);
  else if (!robots.some((content) => content.includes("noindex")))
    problems.push(`${file}: not-found page without noindex`);
  else if (robots.some((content) => /(^|,\s*)index/.test(content)))
    problems.push(
      `${file}: contradictory robots directives (${robots.join(" | ")})`,
    );
}

const robotsTxt = read("robots.txt");
if (/^Disallow:\s*\/\s*$/m.test(robotsTxt))
  problems.push("robots.txt disallows the whole site");
if (!robotsTxt.includes(`Sitemap: ${origin}/sitemap.xml`))
  problems.push(`robots.txt does not name ${origin}/sitemap.xml`);
if (!existsSync(path.join(root, "llms.txt"))) problems.push("no llms.txt");

if (problems.length) {
  console.error(
    `Indexing check failed for ${root}:\n- ${problems.join("\n- ")}`,
  );
  process.exit(1);
}
console.log(
  `Indexing check passed for ${origin}: ${locations.length} indexable pages, ` +
    `${htmlFiles().length - locations.length} noindexed not-found pages.`,
);
