import { comparisonRows } from "@lictory/marketing/components/landing/content";
import { installUrl } from "@lictory/marketing/lib/get-started";
import {
  absoluteUrl,
  marketingImage,
  publicPage,
  publicPages,
  siteDescription,
  siteName,
  siteSummary,
} from "@lictory/marketing/lib/site";

// schema.org nodes shared by the public pages. Each page publishes a complete
// graph, because search engines do not resolve @id references across pages.

export const schemaIds = {
  organization: absoluteUrl("/#organization"),
  website: absoluteUrl("/#website"),
  application: absoluteUrl("/#software"),
  logo: absoluteUrl("/#logo"),
};

export function webPageId(path: string) {
  return absoluteUrl(`${path}#webpage`);
}

export const organizationNode = {
  "@type": "Organization",
  "@id": schemaIds.organization,
  name: siteName,
  url: absoluteUrl("/"),
  description: siteSummary,
  logo: {
    "@type": "ImageObject",
    "@id": schemaIds.logo,
    url: absoluteUrl("/brand/lictory-logo.png"),
    contentUrl: absoluteUrl("/brand/lictory-logo.png"),
    width: 548,
    height: 136,
    caption: siteName,
  },
  image: { "@id": schemaIds.logo },
};

export const websiteNode = {
  "@type": "WebSite",
  "@id": schemaIds.website,
  name: siteName,
  url: absoluteUrl("/"),
  description: siteDescription,
  inLanguage: "en",
  publisher: { "@id": schemaIds.organization },
};

/**
 * Lictory itself. Each team installs its own server and uses it in the
 * browser. Published on every page that describes the product, with the same
 * @id, so search engines and AI assistants connect the pages to one product.
 * Never add ratings or reviews: the pages show none.
 */
export const applicationNode = {
  "@type": "SoftwareApplication",
  "@id": schemaIds.application,
  name: siteName,
  url: absoluteUrl("/"),
  description: siteSummary,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Requirements management and project management",
  operatingSystem: "Linux (server, Docker); used in a web browser",
  license: "https://opensource.org/license/mit",
  image: absoluteUrl(marketingImage.path),
  publisher: { "@id": schemaIds.organization },
  isAccessibleForFree: true,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Free and open source (MIT), installed on your own server",
    url: installUrl,
  },
  featureList: comparisonRows
    .filter((row) => row.lictory === "yes")
    .map((row) => row.feature),
};

/** Home, then every ancestor that is itself a public page, then the page. */
function breadcrumbTrail(path: string) {
  const segments = path.split("/").filter(Boolean);
  const ancestors = segments
    .slice(0, -1)
    .map((_, index) => `/${segments.slice(0, index + 1).join("/")}`)
    .filter((ancestor) => publicPages.some((page) => page.path === ancestor));
  return [
    { name: siteName, path: "/" },
    ...ancestors.map((ancestor) => ({
      name: publicPage(ancestor).title,
      path: ancestor,
    })),
    { name: publicPage(path).title, path: undefined },
  ];
}

/**
 * WebPage and breadcrumb trail for a public page below the landing page, plus
 * any page-specific nodes (an Article, an FAQPage) that describe its content.
 */
export function publicPageStructuredData(
  path: string,
  {
    pageType = "WebPage",
    nodes = [],
  }: {
    pageType?: "WebPage" | "CollectionPage";
    nodes?: ReadonlyArray<Record<string, unknown>>;
  } = {},
) {
  const { title, description, lastModified } = publicPage(path);
  const breadcrumbId = absoluteUrl(`${path}#breadcrumb`);
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationNode,
      websiteNode,
      {
        "@type": pageType,
        "@id": webPageId(path),
        url: absoluteUrl(path),
        name: title,
        description,
        inLanguage: "en",
        isPartOf: { "@id": schemaIds.website },
        publisher: { "@id": schemaIds.organization },
        breadcrumb: { "@id": breadcrumbId },
        ...(lastModified ? { dateModified: lastModified } : {}),
      },
      {
        "@type": "BreadcrumbList",
        "@id": breadcrumbId,
        itemListElement: breadcrumbTrail(path).map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: crumb.name,
          ...(crumb.path ? { item: absoluteUrl(crumb.path) } : {}),
        })),
      },
      ...nodes,
    ],
  };
}

/** Question-and-answer pairs that are also visible on the page. */
export function faqNode(
  path: string,
  faqs: ReadonlyArray<{ question: string; answer: string }>,
) {
  return {
    "@type": "FAQPage",
    "@id": absoluteUrl(`${path}#faq`),
    isPartOf: { "@id": webPageId(path) },
    mainEntity: faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

/** Serializes JSON-LD so the payload can never close its script element. */
export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
