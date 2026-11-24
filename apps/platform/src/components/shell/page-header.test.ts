import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// Every module page starts with the same header: its heading is
// `PageHeader`'s h1. A page that writes its own <h1> grows its own header
// (a 2-line title, a description, a different height), which is how the
// product came to read as six apps. This test keeps new ones out.

const root = join(import.meta.dirname, "../..");

// Headings that are not a module page's header.
const allowed = new Set([
  // The header itself.
  "components/shell/page-header.tsx",
  // A document's own title above its text: the item, the space page.
  "components/items/inline-title.tsx",
  "components/spaces/page-view.tsx",
  // Pages outside the workspace shell: sign-in, onboarding, the
  // organization scheduled for deletion, the last-resort error page.
  "components/auth/auth-layout.tsx",
  "components/workspace/onboarding-frame.tsx",
  "components/settings/org-deletion.tsx",
  "routes/errors.tsx",
]);

// Pages that still draw their own header. Each module stream adopts
// `PageHeader` and removes its entries; the list only shrinks.
const knownOffenders = new Set([
  "components/channels/browser.tsx",
  "components/channels/header.tsx",
  "components/claims/factory-queue.tsx",
  "components/delivery/backlog.tsx",
  "components/delivery/board.tsx",
  "components/delivery/handoff.tsx",
  "components/delivery/iteration-report.tsx",
  "components/delivery/team-backlog.tsx",
  "components/factory/parts.tsx",
  "components/factory/session-view.tsx",
  "components/intelligence/chat/intelligence.tsx",
  "components/items/issue-list.tsx",
  "components/review/ai-review.tsx",
  "components/review/branch-workspace.tsx",
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
      ? [path]
      : [];
  });
}

const withHeading = sources(root)
  .filter((file) => /<h1[\s>]/.test(readFileSync(file, "utf8")))
  .map((file) => relative(root, file).replaceAll("\\", "/"));

void test("module pages take their heading from PageHeader", () => {
  const offenders = withHeading.filter(
    (file) => !allowed.has(file) && !knownOffenders.has(file),
  );
  assert.deepEqual(
    offenders,
    [],
    "Start the page with PageHeader (components/shell/page-header) instead of writing an <h1>.",
  );
});

void test("the list of pages still drawing their own header only shrinks", () => {
  const fixed = [...knownOffenders].filter((f) => !withHeading.includes(f));
  assert.deepEqual(
    fixed,
    [],
    "These pages adopted PageHeader: remove them from knownOffenders.",
  );
});
