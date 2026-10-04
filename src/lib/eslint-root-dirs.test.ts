import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { Linter } from "eslint";
import nextPlugin from "@next/eslint-plugin-next";

const load = createRequire(import.meta.url);
const { getRootDirs } = load(
  "@next/eslint-plugin-next/dist/utils/get-root-dirs",
) as {
  getRootDirs: (context: {
    cwd: string;
    settings: { next?: { rootDir?: string | string[] } };
  }) => string[];
};

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lictory-eslint-")));
  for (const dir of [
    "apps/web/src/app/known",
    "apps/web/pages",
    "apps/api/pages",
    "libs/ui/src",
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, "apps/web/src/app/known/page.tsx"), "");
  writeFileSync(join(root, "apps/web/pages/known.tsx"), "");
  writeFileSync(join(root, "apps/README.md"), "");
  return root;
}

void test("Next.js lint root settings match directories without expanding their contents", () => {
  const root = fixture();
  try {
    const web = join(root, "apps/web"),
      api = join(root, "apps/api"),
      ui = join(root, "libs/ui");
    for (const [rootDir, expected] of [
      [undefined, [root]],
      [process.cwd(), [process.cwd()]],
      [".", [process.cwd()]],
      [web, [web]],
      [relative(process.cwd(), web), [web]],
      [`${web}/`, [web]],
      [join(root, "apps/*"), [api, web]],
      [join(root, "apps/{api,web}"), [api, web]],
      [
        [web, join(root, "libs/*")],
        [web, ui],
      ],
    ] as const) {
      assert.deepEqual(
        getRootDirs({
          cwd: root,
          settings: {
            next: {
              rootDir:
                typeof rootDir === "string"
                  ? rootDir
                  : rootDir
                    ? [...rootDir]
                    : undefined,
            },
          },
        })
          .map((dir) => resolve(dir))
          .sort(),
        [...expected].sort(),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("Next.js still rejects internal HTML links for a discovered project root", () => {
  const root = fixture();
  try {
    const linter = new Linter();
    const config = {
      files: ["**/*.jsx"],
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { "@next/next": nextPlugin },
      settings: { next: { rootDir: join(root, "apps/web") } },
      rules: { "@next/next/no-html-link-for-pages": "error" as const },
    };
    const messages = linter.verify('<a href="/known">Known page</a>', config, {
      filename: "example.jsx",
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.ruleId, "@next/next/no-html-link-for-pages");
    assert.equal(messages[0]!.severity, 2);
    assert.equal(
      linter.verify('<a href="https://example.com">External page</a>', config, {
        filename: "example.jsx",
      }).length,
      0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
