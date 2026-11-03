import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { appearanceBootScript } from "../../packages/core/src/lib/appearance";
import {
  analyticsSettings,
  publicConfigTag,
} from "../../packages/core/src/lib/public-config";

const root = fileURLToPath(new URL("../..", import.meta.url));
const workspace = (path: string) => `${root}${path}`;

// Small files only the app host serves (icons and the web app manifest).
const staticFiles: Record<string, string> = {
  "/icon.svg": "image/svg+xml",
  "/apple-icon.png": "image/png",
  "/manifest.webmanifest": "application/manifest+json",
};
function appStatic(): Plugin {
  const file = (name: string) =>
    fileURLToPath(new URL(`./static${name}`, import.meta.url));
  return {
    name: "lictory-app-static",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const type = req.url ? staticFiles[req.url.split("?")[0]!] : undefined;
        if (!type) return next();
        res.setHeader("Content-Type", type);
        res.end(readFileSync(file(req.url!.split("?")[0]!)));
      });
    },
    generateBundle() {
      for (const name of Object.keys(staticFiles))
        this.emitFile({
          type: "asset",
          fileName: name.slice(1),
          source: readFileSync(file(name)),
        });
    },
  };
}

// The saved light/dark preference applies before the first paint.
function appearanceBoot(): Plugin {
  return {
    name: "lictory-appearance-boot",
    transformIndexHtml(html) {
      return html.replace("/*appearance-boot*/", appearanceBootScript);
    },
  };
}

// The development server serves index.html itself, so it writes the runtime
// configuration the API's document handler writes in production. Builds keep
// the placeholder: nothing installation-specific is compiled into them.
function developmentConfig(env: Record<string, string>): Plugin {
  return {
    name: "lictory-development-config",
    apply: "serve",
    transformIndexHtml(html) {
      const site = env.SITE_URL?.trim();
      return html.replace("<!--app-head-->", () =>
        publicConfigTag({
          // Empty: the browser falls back to the page's own origin.
          siteUrl: site ? new URL(site).origin : "",
          analytics: analyticsSettings(env),
        }),
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  // Empty variables count as unset.
  const setting = (name: string, fallback: string) =>
    env[name]?.trim() ? env[name].trim() : fallback;
  const apiOrigin = setting("API_ORIGIN", "http://localhost:3002");
  const zeroOrigin = setting("ZERO_ORIGIN", "http://localhost:4848");
  const version = (
    JSON.parse(readFileSync(workspace("package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  // One origin in development and previews: the API, zero-cache and the
  // analytics relay sit behind the app's own server, as in production.
  const proxy: Record<string, ProxyOptions> = {
    "/api": { target: apiOrigin, changeOrigin: false, xfwd: true },
    "/relay": { target: apiOrigin, changeOrigin: false, xfwd: true },
    "/zero": { target: zeroOrigin, ws: true, changeOrigin: true },
  };
  const port = Number(setting("PORT", "3120"));
  return {
    root: fileURLToPath(new URL(".", import.meta.url)),
    envDir: root,
    publicDir: workspace("packages/ui/public"),
    plugins: [
      react(),
      tailwindcss(),
      appearanceBoot(),
      appStatic(),
      developmentConfig(env),
    ],
    resolve: {
      alias: [
        {
          find: /^@lictory\/(core|ui|zero)\/(.*)$/,
          replacement: workspace("packages/$1/src/$2"),
        },
        {
          find: /^@lictory\/platform\/(.*)$/,
          replacement: workspace("apps/platform/src/$1"),
        },
      ],
    },
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
      // Shared browser modules read build settings under the website's
      // names. Analytics come from the runtime configuration instead
      // (lib/public-config), so the build carries none.
      "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(version),
      "process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN": JSON.stringify(""),
      "process.env.NEXT_PUBLIC_POSTHOG_HOST": JSON.stringify(""),
      "process.env.NEXT_PUBLIC_ANALYTICS_CONSENT": JSON.stringify(""),
    },
    server: { port, strictPort: true, proxy },
    preview: { port, strictPort: true, proxy },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // No source maps: the bundles are served publicly and no error
      // reporting service consumes them.
      sourcemap: false,
      target: "es2022",
    },
  };
});
