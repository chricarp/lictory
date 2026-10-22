import { guides } from "@lictory/marketing/content/guides";
import { guidesFeedPath, absoluteUrl, publicPage, siteName } from "@lictory/marketing/lib/site";

export const dynamic = "force-static";

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const rfc822 = (date: string) => new Date(`${date}T00:00:00Z`).toUTCString();

/** RSS 2.0 feed of the guides. Dates come from the content, never the build. */
export function GET() {
  const { title, description } = publicPage("/guides");
  const items = [...guides].sort((a, b) =>
    b.published.localeCompare(a.published),
  );
  const lastUpdated = [...guides.map((guide) => guide.updated)].sort().at(-1)!;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(`${title} · ${siteName}`)}</title>
    <link>${absoluteUrl("/guides")}</link>
    <description>${escapeXml(description)}</description>
    <language>en</language>
    <lastBuildDate>${rfc822(lastUpdated)}</lastBuildDate>
    <atom:link href="${absoluteUrl(guidesFeedPath)}" rel="self" type="application/rss+xml"/>
${items
  .map((guide) => {
    const url = absoluteUrl(`/guides/${guide.slug}`);
    return `    <item>
      <title>${escapeXml(guide.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${rfc822(guide.published)}</pubDate>
      <description>${escapeXml(guide.description)}</description>
    </item>`;
  })
  .join("\n")}
  </channel>
</rss>
`;
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
