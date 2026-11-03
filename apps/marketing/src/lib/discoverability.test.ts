import { describe, test } from "node:test";
import assert from "node:assert/strict";

import sitemap from "@lictory/marketing/app/sitemap";
import { comparisons } from "@lictory/marketing/content/comparisons";
import { guides } from "@lictory/marketing/content/guides";
import { landingStructuredData } from "@lictory/marketing/components/landing/structured-data";
import { installUrl } from "@lictory/marketing/lib/get-started";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";
import { absoluteUrl, publicPages, siteUrl } from "@lictory/marketing/lib/site";
import {
  publicPageStructuredData,
  serializeJsonLd,
} from "@lictory/marketing/lib/structured-data";

void describe("search discoverability", () => {
  void test("the sitemap lists exactly the public pages on the canonical origin", () => {
    const entries = sitemap();
    assert.deepEqual(
      entries.map((entry) => entry.url),
      publicPages.map((page) => absoluteUrl(page.path)),
    );
    for (const entry of entries)
      assert.equal(new URL(entry.url).origin, siteUrl);
  });

  void test("the sitemap reports lastmod only for pages with a known change date", () => {
    const byUrl = new Map(sitemap().map((entry) => [entry.url, entry]));
    assert.equal(byUrl.get(absoluteUrl("/"))?.lastModified, undefined);
    assert.ok(byUrl.get(absoluteUrl("/privacy"))?.lastModified);
  });

  for (const path of ["/privacy", "/terms-of-service"] as const) {
    void test(`${path} is indexable with its own canonical URL and card`, () => {
      const metadata = publicPageMetadata(path);
      assert.equal(metadata.alternates?.canonical, path);
      assert.equal(
        (metadata.openGraph as { url?: string } | undefined)?.url,
        path,
      );
      assert.equal(
        (metadata.robots as { index?: boolean } | undefined)?.index,
        true,
      );
    });

    void test(`${path} publishes a breadcrumb back to the landing page`, () => {
      const graph = publicPageStructuredData(path)["@graph"];
      const breadcrumb = graph.find(
        (node) => node["@type"] === "BreadcrumbList",
      ) as { itemListElement: Array<{ item?: string }> } | undefined;
      assert.equal(breadcrumb?.itemListElement[0]?.item, absoluteUrl("/"));
      assert.equal(breadcrumb?.itemListElement.length, 2);
    });
  }

  void test("the landing page offer leads to the installation guide", () => {
    const application = landingStructuredData["@graph"].find(
      (node) => node["@type"] === "WebApplication",
    ) as { offers: { "@type": string; url: string } };
    assert.equal(application.offers["@type"], "Offer");
    assert.equal(application.offers.url, installUrl);
  });

  void test("every guide and comparison is published in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const { slug } of guides)
      assert.ok(urls.includes(absoluteUrl(`/guides/${slug}`)));
    for (const { slug } of comparisons)
      assert.ok(urls.includes(absoluteUrl(`/compare/${slug}`)));
  });

  void test("guide breadcrumbs pass through the guides index", () => {
    const breadcrumb = publicPageStructuredData("/guides/definition-of-ready")[
      "@graph"
    ].find((node) => node["@type"] === "BreadcrumbList") as {
      itemListElement: Array<{ item?: string }>;
    };
    assert.deepEqual(
      breadcrumb.itemListElement.map((crumb) => crumb.item),
      [absoluteUrl("/"), absoluteUrl("/guides"), undefined],
    );
  });

  void test("comparison breadcrumbs skip the missing /compare index", () => {
    const breadcrumb = publicPageStructuredData("/compare/jira")["@graph"].find(
      (node) => node["@type"] === "BreadcrumbList",
    ) as {
      itemListElement: Array<{ item?: string }>;
    };
    assert.equal(breadcrumb.itemListElement.length, 2);
  });

  void test("JSON-LD can never close its script element", () => {
    assert.doesNotMatch(
      serializeJsonLd({ text: "</script><script>alert(1)</script>" }),
      /</,
    );
  });
});
