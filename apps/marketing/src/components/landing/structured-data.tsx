import { JsonLd } from "@lictory/marketing/components/json-ld";
import { platformHref } from "@lictory/marketing/lib/platform";
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
      // A SoftwareApplication that runs in the browser.
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
        description: "Free to start",
        url: platformHref("/sign-up"),
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
