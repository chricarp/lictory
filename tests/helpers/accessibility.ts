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

// Serious and critical WCAG findings fail a test. Moderate and minor ones
// mostly depend on context, except the page's structure: screen reader
// users move by headings and landmarks, so an outline that skips a level,
// content outside every landmark or two landmarks with the same name fail
// too, at any impact (these are axe's best-practice rules).
const failingImpacts = new Set(["serious", "critical"]);
const structuralRules = new Set([
  "region",
  "heading-order",
  "page-has-heading-one",
  "landmark-one-main",
  "landmark-unique",
  "landmark-no-duplicate-banner",
  "landmark-no-duplicate-contentinfo",
  "landmark-no-duplicate-main",
  "landmark-banner-is-top-level",
  "landmark-contentinfo-is-top-level",
  "landmark-main-is-top-level",
  "landmark-complementary-is-top-level",
]);

// Popups mount under the body, outside every landmark, but belong to the
// control that opened them, as axe already treats dialogs: content inside one
// is not "outside the landmarks".
const popups =
  "[role=tooltip], [role=menu], [role=listbox], [data-reference-card]";

// Violations that need a product or design decision before they can be fixed.
// Each is excused only for its rule inside its selector, never page-wide, and
// is listed under "Known gaps" in docs/internals/accessibility.md. Remove the
// entry with the fix; do not add one to make a new violation pass.
const knownGaps: { rule: string; within: string; reason: string }[] = [];

/**
 * Fails the test when the page (or the part matching `include`) has serious or critical
 * WCAG 2.2 A/AA violations that axe-core can detect, or a broken heading and landmark
 * structure, other than known gaps. Call it once the state being checked is on screen.
 */
export async function expectNoAccessibilityViolations(
  page: Page,
  state: string,
  options: { include?: string } = {},
) {
  // A popover or tooltip still fading in has a blended, lighter text colour;
  // contrast is checked once finite animations have finished.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const builder = new AxeBuilder({ page }).withTags([
    ...wcagTags,
    "best-practice",
  ]);
  if (options.include) builder.include(options.include);
  const { violations, incomplete } = await builder.analyze();
  // AXE_NEEDS_REVIEW=1 lists what axe could not decide (other than
  // contrast over images and gradients), to look at by hand.
  if (process.env.AXE_NEEDS_REVIEW)
    for (const result of incomplete)
      if (!result.id.startsWith("color-contrast"))
        for (const node of result.nodes)
          console.log(
            `[needs review] ${state}: ${result.id} at ${node.target.join(" >>> ")}\n  ${node.html.slice(0, 300)}\n  ${node.failureSummary?.replaceAll("\n", " ") ?? ""}`,
          );
  const failures: string[] = [];
  for (const violation of violations) {
    const wcag = violation.tags.some((tag) => wcagTags.includes(tag));
    if (
      !structuralRules.has(violation.id) &&
      !(wcag && failingImpacts.has(violation.impact ?? ""))
    )
      continue;
    const gaps = knownGaps
      .filter((gap) => gap.rule === violation.id)
      .map((gap) => gap.within);
    if (violation.id === "region") gaps.push(popups);
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
    .soft(
      failures,
      `${state}: serious or critical WCAG 2.2 AA violations, or broken structure`,
    )
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
