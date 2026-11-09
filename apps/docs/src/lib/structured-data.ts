import type { DocsPage } from "@lictory/docs/lib/markdown";
import { absoluteUrl, site } from "@lictory/docs/lib/site";
import { source } from "@lictory/docs/lib/source";

// schema.org data for each documentation page: the article, its place in the
// documentation and who publishes it. Only facts the page itself states; no
// dates, because a build does not know when a page last changed.

const organization = {
  "@type": "Organization",
  "@id": `${site.website}/#organization`,
  name: "Lictory",
  url: site.website,
  sameAs: [site.repository],
};

const website = {
  "@type": "WebSite",
  "@id": absoluteUrl("/#website"),
  name: site.name,
  url: absoluteUrl("/"),
  description: site.description,
  inLanguage: "en",
  publisher: { "@id": organization["@id"] },
};

/** The home page, then each ancestor that is a page itself, then the page. */
function breadcrumb(page: DocsPage) {
  const ancestors = page.slugs
    .slice(0, -1)
    .map((_, index) => source.getPage(page.slugs.slice(0, index + 1)))
    .filter((ancestor) => ancestor !== undefined);
  const home = source.getPage([]);
  const trail = [...(home ? [home] : []), ...ancestors, page];
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb === home ? site.name : crumb.data.title,
      ...(index < trail.length - 1 ? { item: absoluteUrl(crumb.url) } : {}),
    })),
  };
}

export function pageStructuredData(page: DocsPage) {
  const url = absoluteUrl(page.url);
  if (page.url === "/")
    return {
      "@context": "https://schema.org",
      "@graph": [organization, website],
    };
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      website,
      {
        "@type": "TechArticle",
        "@id": `${url}#article`,
        headline: page.data.title,
        description: page.data.description,
        url,
        mainEntityOfPage: url,
        inLanguage: "en",
        isPartOf: { "@id": website["@id"] },
        publisher: { "@id": organization["@id"] },
        about: { "@type": "SoftwareApplication", name: "Lictory" },
      },
      breadcrumb(page),
    ],
  };
}

export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
