import assert from "node:assert/strict";
import { test } from "node:test";
import { deploymentLegalSections } from "./deployment";

const cloud = [
  { id: "cloud", title: "Cloud", body: "Cloud provider declarations" },
];
void test("only an explicit cloud configuration uses the cloud contracts", () => {
  assert.equal(deploymentLegalSections(cloud, "cloud"), cloud);
  for (const value of [undefined, "", "self-hosted", "typo"]) {
    const sections = deploymentLegalSections(cloud, value);
    assert.equal(sections[0]?.id, "operator-notice");
    assert.ok(
      sections.every(
        (section) => !section.body.includes("Cloud provider declarations"),
      ),
    );
  }
});
