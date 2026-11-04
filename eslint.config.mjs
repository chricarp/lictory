import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";

const react = [
  "apps/marketing/**/*.{ts,tsx,mjs}",
  "apps/docs/**/*.{ts,tsx,mjs}",
  "apps/platform/**/*.{ts,tsx}",
  "packages/**/*.{ts,tsx}",
];
// React, hooks, accessibility and import rules apply to all React code; the
// Next.js-specific rules are switched off outside the Next.js applications
// (the website and the documentation).
/** @param {import("eslint").Linter.Config[]} configs @param {string[]} files */
const scoped = (configs, files) =>
  configs.map((config) =>
    config.ignores && Object.keys(config).length === 1
      ? config
      : { ...config, files },
  );

export default defineConfig([
  globalIgnores([
    // Locally restored skill examples and tools are not application source.
    ".agents/skills/**",
    // The Stageshow kit the website's illustrations run on, kept as upstream
    // wrote it so it can be refreshed from upstream. TypeScript still checks it.
    "apps/marketing/src/vendor/**",
    "**/.next/**",
    "**/.open-next/**",
    "**/.wrangler/**",
    "**/.next-e2e/**",
    "**/dist/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    "**/routeTree.gen.ts",
    "**/legacy-next/**",
  ]),
  ...scoped(nextVitals, react),
  ...scoped(nextTs, react),
  {
    // eslint-config-next registers jsx-a11y but enables only six of its rules.
    // Enforce the plugin's recommended set (WCAG 2.2 AA is the target; see
    // docs/internals/accessibility.md). The plugin itself stays registered by
    // the Next.js config, so only the rules are added here.
    files: react,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // The shared Input renders a native <input>; labels often wrap it
      // together with an action button, one level deeper than the default.
      "jsx-a11y/label-has-associated-control": [
        "error",
        { controlComponents: ["Input"], depth: 3 },
      ],
      // autoFocus is used only to move focus into what a person just opened
      // (dialogs, popovers, inline editors) or to the single field of a
      // single-purpose step, as the WAI-ARIA dialog pattern asks. Focus on page
      // load elsewhere is a review concern, not something this rule can tell
      // apart.
      "jsx-a11y/no-autofocus": "off",
    },
  },
  {
    settings: { next: { rootDir: ["apps/marketing/", "apps/docs/"] } },
  },
  {
    files: ["apps/platform/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    rules: Object.fromEntries(
      Object.keys(nextPlugin.rules).map((rule) => [
        `@next/next/${rule}`,
        "off",
      ]),
    ),
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    // Shared packages never depend on applications.
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@lictory/marketing/*",
                "@lictory/platform/*",
                "@lictory/api/*",
                "@lictory/worker/*",
                "next",
                "next/*",
              ],
              message:
                "Shared packages must not depend on applications or Next.js.",
            },
          ],
        },
      ],
    },
  },
  {
    // Server-only modules must never reach browser bundles.
    files: ["apps/platform/src/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@lictory/core/db/*",
                "@lictory/core/domain/*",
                "@lictory/core/storage/index",
                "@lictory/core/storage/s3",
                "@lictory/core/delivery/*",
                "@lictory/core/ai/*",
                "@lictory/core/lib/auth",
                "@lictory/core/lib/mailer",
                "@lictory/core/lib/email",
                "@lictory/core/capabilities/server",
                "@lictory/core/capabilities/http",
                "drizzle-orm",
                "drizzle-orm/*",
                "postgres",
                "next",
                "next/*",
              ],
              message: "Browser code may only import isomorphic modules.",
            },
          ],
        },
      ],
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
]);
