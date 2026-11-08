import assert from "node:assert/strict";
import { describe, test } from "node:test";

import robots from "@lictory/marketing/app/robots";
import sitemap from "@lictory/marketing/app/sitemap";
import {
  capabilityRows,
  comparisonPath,
  comparisons,
} from "@lictory/marketing/content/comparisons";
import { products } from "@lictory/marketing/content/products";
import {
  roundupProducts,
  roundupReviewed,
  roundups,
} from "@lictory/marketing/content/roundups";
import { repositoryUrl } from "@lictory/marketing/lib/get-started";
import { llmsFull, llmsIndex } from "@lictory/marketing/lib/llms";
import {
  markdownDocument,
  markdownPath,
} from "@lictory/marketing/lib/markdown";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";
import { absoluteUrl, publicPages } from "@lictory/marketing/lib/site";
import {
  comparisonStructuredData,
  roundupStructuredData,
} from "@lictory/marketing/lib/comparison-structured-data";

// Comparison, alternatives and roundup pages: each is its own indexable page
// with its own metadata and structured data, and every fact about another
// product can be traced to a source with a review date.

const comparisonPaths = [
  ...comparisons.map(comparisonPath),
  ...roundups.map((item) => item.path),
];

void describe("comparison and alternatives pages", () => {
  void test("the requested pages exist", () => {
    for (const path of [
      "/alternatives/jira",
      "/self-hosted-jira-alternative",
      "/compare/lictory-vs-plane",
      "/compare/lictory-vs-openproject",
      "/compare/lictory-vs-taiga",
      "/best-requirements-management-tools",
    ])
      assert.ok(comparisonPaths.includes(path), path);
  });

  void test("every page is in the sitemap and allowed for every crawler", () => {
    const urls = sitemap().map((entry) => entry.url);
    const rules = [robots().rules].flat();
    for (const path of comparisonPaths) {
      assert.ok(urls.includes(absoluteUrl(path)), path);
      for (const rule of rules) {
        assert.equal(rule.allow, "/");
        for (const prefix of [rule.disallow ?? []].flat())
          assert.ok(!path.startsWith(prefix), `${path} disallowed`);
      }
    }
  });

  void test("every public page has its own title and description", () => {
    const titles = publicPages.map((page) => page.title);
    const descriptions = publicPages.map((page) => page.description);
    assert.equal(new Set(titles).size, titles.length);
    assert.equal(new Set(descriptions).size, descriptions.length);
  });

  for (const path of comparisonPaths)
    void test(`${path} has a self-referencing canonical URL, Open Graph and structured data`, () => {
      const metadata = publicPageMetadata(path, { ownImage: true });
      assert.equal(metadata.alternates?.canonical, path);
      assert.equal(
        (metadata.openGraph as { url?: string } | undefined)?.url,
        path,
      );
      assert.ok(metadata.openGraph?.title);
      assert.ok(metadata.description);
      const comparison = comparisons.find(
        (item) => comparisonPath(item) === path,
      );
      const roundup = roundups.find((item) => item.path === path);
      const graph = (
        comparison
          ? comparisonStructuredData(comparison)
          : roundupStructuredData(roundup!)
      )["@graph"] as ReadonlyArray<Record<string, unknown>>;
      const types = graph.map((node) => node["@type"]);
      for (const type of ["WebPage", "SoftwareApplication", "FAQPage"])
        assert.ok(types.includes(type), `${path}: ${type}`);
      const faq = graph.find((node) => node["@type"] === "FAQPage") as {
        mainEntity: unknown[];
      };
      assert.equal(faq.mainEntity.length, (comparison ?? roundup)!.faqs.length);
      assert.ok(markdownDocument(path), `${path} has a Markdown version`);
    });

  void test("roundups list Lictory alongside other products, each with its limitations", () => {
    for (const item of roundups) {
      const listed = item.entries.map((entry) => entry.product);
      assert.ok(listed.includes("lictory"), item.path);
      assert.ok(listed.length >= 4, item.path);
      assert.equal(new Set(listed).size, listed.length, item.path);
      for (const entry of item.entries)
        assert.ok(entry.considerations.length > 0, entry.product);
    }
  });

  void test("alternatives pages answer different questions", () => {
    // Pages about the same products must not be near-duplicates: they lead
    // with different facts and describe each product in their own words.
    const [alternatives, selfHosted] = [
      "/alternatives/jira",
      "/self-hosted-jira-alternative",
    ].map((path) => roundups.find((item) => item.path === path)!);
    assert.notDeepEqual(alternatives!.columns, selfHosted!.columns);
    for (const entry of alternatives!.entries) {
      const other = selfHosted!.entries.find(
        (candidate) => candidate.product === entry.product,
      );
      if (other) assert.notEqual(entry.summary, other.summary);
    }
  });

  void test("every fact about another product names its sources and when they were checked", () => {
    const used = new Set([
      ...roundups.flatMap((item) => roundupProducts(item).map((p) => p.id)),
      ...comparisons.flatMap((item) => (item.product ? [item.product] : [])),
    ]);
    for (const id of used) {
      const profile = products[id];
      assert.match(profile.reviewed, /^\d{4}-\d{2}-\d{2}$/, id);
      assert.ok(profile.sources.length > 0, id);
      for (const source of profile.sources)
        assert.equal(new URL(source.url).protocol, "https:", source.url);
    }
    for (const item of roundups)
      assert.match(roundupReviewed(item) ?? "", /^\d{4}-\d{2}-\d{2}$/);
  });

  void test("comparisons checked against documentation carry their own capability table", () => {
    for (const item of comparisons.filter((other) => other.product)) {
      const rows = capabilityRows(item);
      assert.ok(rows.length > 0, item.slug);
      // Where the competitor is stronger, the table says so.
      if (item.capabilities)
        assert.ok(
          rows.some((row) => row.lictory === "no" && row.competitor === "yes"),
          item.slug,
        );
    }
  });

  void test("llms.txt links the pages, the repository and the documentation", () => {
    const index = llmsIndex();
    for (const path of comparisonPaths)
      assert.ok(index.includes(absoluteUrl(markdownPath(path))), path);
    // Compare parsed link targets, not substrings of the document.
    const targets = [...index.matchAll(/\]\((https:[^)\s]+)\)/g)].map(
      ([, url]) => new URL(url!),
    );
    assert.ok(targets.some((url) => url.href === repositoryUrl));
    assert.ok(
      targets.some(
        (url) => url.host === "docs.lictory.com" && url.pathname === "/",
      ),
    );
    assert.ok(llmsFull().includes("## Alternatives and roundups"));
  });
});
