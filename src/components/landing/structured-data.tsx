import { comparisonRows, faqs } from "~/components/landing/content";
import {
  absoluteUrl,
  siteDescription,
  siteName,
  siteSummary,
  siteTitle,
} from "~/lib/site";

const ids = {
  organization: absoluteUrl("/#organization"),
  website: absoluteUrl("/#website"),
  application: absoluteUrl("/#software"),
  webpage: absoluteUrl("/#webpage"),
  faq: absoluteUrl("/#faq"),
};

/** schema.org description of the public landing page for search engines and AI. */
export const landingStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ids.organization,
      name: siteName,
      url: absoluteUrl("/"),
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/brand/lictory-logo.png"),
      },
    },
    {
      "@type": "WebSite",
      "@id": ids.website,
      name: siteName,
      url: absoluteUrl("/"),
      description: siteDescription,
      inLanguage: "en",
      publisher: { "@id": ids.organization },
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
      primaryImageOfPage: absoluteUrl("/og/marketing"),
    },
    {
      "@type": "SoftwareApplication",
      "@id": ids.application,
      name: siteName,
      url: absoluteUrl("/"),
      description: siteSummary,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Requirements management and project management",
      operatingSystem: "Web browser",
      image: absoluteUrl("/og/marketing"),
      publisher: { "@id": ids.organization },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free to start",
        url: absoluteUrl("/sign-up"),
      },
      featureList: comparisonRows
        .filter((row) => row.lictory === "yes")
        .map((row) => row.feature),
    },
    {
      "@type": "FAQPage",
      "@id": ids.faq,
      url: absoluteUrl("/#faq"),
      isPartOf: { "@id": ids.webpage },
      mainEntity: faqs.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
  ],
};

export function StructuredData() {
  return (
    <script
      type="application/ld+json"
      // Escapes "<" so the payload can never close the script element.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(landingStructuredData).replace(/</g, "\\u003c"),
      }}
    />
  );
}
