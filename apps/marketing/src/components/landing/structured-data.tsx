import { JsonLd } from "@lictory/marketing/components/json-ld";
import { installUrl } from "@lictory/marketing/lib/get-started";
import {
  comparisonRows,
  faqs,
} from "@lictory/marketing/components/landing/content";
import {
  absoluteUrl,
  marketingImage,
  siteDescription,
  siteName,
  siteSummary,
  siteTitle,
} from "@lictory/marketing/lib/site";
import {
  faqNode,
  organizationNode,
  schemaIds,
  webPageId,
  websiteNode,
} from "@lictory/marketing/lib/structured-data";

const ids = {
  ...schemaIds,
  webpage: webPageId("/"),
  image: absoluteUrl("/#primaryimage"),
};

/** schema.org description of the public landing page for search engines and AI. */
export const landingStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    organizationNode,
    websiteNode,
    {
      "@type": "ImageObject",
      "@id": ids.image,
      url: absoluteUrl(marketingImage.path),
      contentUrl: absoluteUrl(marketingImage.path),
      width: marketingImage.width,
      height: marketingImage.height,
      caption: marketingImage.alt,
    },
    {
      "@type": "WebPage",
      "@id": ids.webpage,
      url: absoluteUrl("/"),
      name: siteTitle,
      description: siteDescription,
      inLanguage: "en",
      isPartOf: { "@id": ids.website },
      about: { "@id": ids.application },
      mainEntity: { "@id": ids.application },
      publisher: { "@id": ids.organization },
      primaryImageOfPage: { "@id": ids.image },
      image: { "@id": ids.image },
    },
    {
      // A SoftwareApplication that people use in the browser; each team
      // installs its own server.
      "@type": "WebApplication",
      "@id": ids.application,
      name: siteName,
      url: absoluteUrl("/"),
      description: siteSummary,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Requirements management and project management",
      operatingSystem: "Web browser",
      browserRequirements: "Requires JavaScript and a modern web browser.",
      image: { "@id": ids.image },
      publisher: { "@id": ids.organization },
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
    },
    faqNode("/", faqs),
  ],
};

export function StructuredData() {
  return <JsonLd data={landingStructuredData} />;
}
