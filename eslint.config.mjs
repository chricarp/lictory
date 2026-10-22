import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

const react = [
  "apps/marketing/**/*.{ts,tsx,mjs}",
  "apps/platform/**/*.{ts,tsx}",
  "packages/**/*.{ts,tsx}",
];
// React, hooks, accessibility and import rules apply to all React code; the
// Next.js-specific rules are switched off outside the marketing application.
const scoped = (configs, files) =>
  configs.map((config) =>
    config.ignores && Object.keys(config).length === 1
      ? config
      : { ...config, files },
  );

export default defineConfig([
  globalIgnores([
    "**/.next/**",
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
    settings: { next: { rootDir: "apps/marketing" } },
  },
  {
    files: ["apps/platform/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    rules: Object.fromEntries(
      Object.keys(nextPlugin.rules).map((rule) => [`@next/next/${rule}`, "off"]),
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
              message: "Shared packages must not depend on applications or Next.js.",
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
                "@lictory/core/storage/*",
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
