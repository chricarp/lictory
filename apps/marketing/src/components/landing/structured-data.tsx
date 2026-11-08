import { JsonLd } from "@lictory/marketing/components/json-ld";
import { faqs } from "@lictory/marketing/components/landing/content";
import {
  absoluteUrl,
  marketingImage,
  siteDescription,
  siteTitle,
} from "@lictory/marketing/lib/site";
import {
  applicationNode,
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
    { ...applicationNode, image: { "@id": ids.image } },
    faqNode("/", faqs),
  ],
};

export function StructuredData() {
  return <JsonLd data={landingStructuredData} />;
}
