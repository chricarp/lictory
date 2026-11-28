import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { docsPages, docsUrl } from "@lictory/core/lib/docs-links";

const content = new URL("../../../../apps/docs/content/docs", import.meta.url)
  .pathname;

// Heading anchors as the docs site writes them: lower case, punctuation
// dropped, spaces as hyphens.
const anchor = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

void test("every documentation link the product shows names a page and heading that exist", () => {
  for (const [name, target] of Object.entries(docsPages)) {
    const [path, hash] = target.split("#");
    const file = [
      join(content, `${path}.mdx`),
      join(content, path, "index.mdx"),
    ].find((candidate) => existsSync(candidate));
    assert.ok(file, `${name}: no documentation page at ${path}`);
    if (!hash) continue;
    const anchors = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => /^#{2,4} /.test(line))
      .map((line) => anchor(line.replace(/^#+ /, "")));
    assert.ok(
      anchors.includes(hash),
      `${name}: ${path} has no heading #${hash}`,
    );
  }
  assert.equal(
    docsUrl("autonomy"),
    "https://docs.lictory.com/factory/autonomy#autonomy-levels",
  );
});
