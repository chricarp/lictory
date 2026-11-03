import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Automated WCAG checks for browser workflows. The target is WCAG 2.2 AA; see
// docs/internals/accessibility.md for what this covers and what it cannot.

// axe-core rules tagged for WCAG 2.0, 2.1 and 2.2 at levels A and AA.
const wcagTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
];

// Only serious and critical findings fail a test. Moderate and minor ones are
// worth fixing but too dependent on context to gate every change.
const failingImpacts = new Set(["serious", "critical"]);

// Violations that need a product or design decision before they can be fixed.
// Each is excused only for its rule inside its selector, never page-wide, and
// is listed under "Known gaps" in docs/internals/accessibility.md. Remove the
// entry with the fix; do not add one to make a new violation pass.
const knownGaps: { rule: string; within: string; reason: string }[] = [];

/**
 * Fails the test when the page (or the part matching `include`) has serious or critical
 * WCAG 2.2 A/AA violations that axe-core can detect, other than known gaps.
 * Call it once the state being checked is on screen.
 */
export async function expectNoAccessibilityViolations(
  page: Page,
  state: string,
  options: { include?: string } = {},
) {
  const builder = new AxeBuilder({ page }).withTags(wcagTags);
  if (options.include) builder.include(options.include);
  const { violations } = await builder.analyze();
  const failures: string[] = [];
  for (const violation of violations) {
    if (!failingImpacts.has(violation.impact ?? "")) continue;
    const gaps = knownGaps
      .filter((gap) => gap.rule === violation.id)
      .map((gap) => gap.within);
    for (const node of violation.nodes) {
      const target = node.target.join(" >>> ");
      if (gaps.length && (await withinGap(page, node.target, gaps))) continue;
      failures.push(
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
          `  at ${target}\n` +
          `  ${node.html.slice(0, 300)}\n` +
          `  ${node.failureSummary?.replaceAll("\n", "\n  ") ?? ""}\n` +
          `  ${violation.helpUrl}`,
      );
    }
  }
  // Soft, so one run reports every failing state of a workflow.
  expect
    .soft(failures, `${state}: serious or critical WCAG 2.2 AA violations`)
    .toEqual([]);
}

async function withinGap(page: Page, target: unknown[], gaps: string[]) {
  // Frames and shadow roots produce nested targets; those are never excused.
  const [selector] = target;
  if (target.length !== 1 || typeof selector !== "string") return false;
  return page.evaluate(
    ([selector, gaps]) => {
      const element = document.querySelector(selector);
      return !!element && gaps.some((gap) => element.closest(gap));
    },
    [selector, gaps] as const,
  );
}
