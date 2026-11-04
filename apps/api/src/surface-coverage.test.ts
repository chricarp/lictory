import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  browserOperations,
  transportRoutes,
} from "@lictory/core/capabilities/human-only";
import { getCapability } from "@lictory/core/capabilities/registry";

// "No human-only features" is product policy: whatever the browser can do is
// a capability (available to MCP and Litto) unless it is listed as a
// human-only browser operation with its reason. This check reads the sources
// so a new route or Better Auth call cannot slip past the list.

const api = new URL(".", import.meta.url).pathname;
const platform = new URL("../../platform/src", import.meta.url).pathname;

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

const routeFiles = [
  "app.ts",
  "routes/web.ts",
  "routes/intelligence.ts",
  "routes/events.ts",
  "routes/admin.ts",
].map((file) => join(api, file));

const registration =
  /app\.(get|post|put|patch|delete|all|on)\(\s*(?:\[([^\]]*)\]\s*,\s*)?(["`])([^"`]+)\3/g;

// Every route with the code that handles it, up to the next registration.
function routes() {
  return routeFiles.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    const matches = [...text.matchAll(registration)];
    return matches.flatMap((match, index) => {
      const body = text.slice(
        match.index,
        matches[index + 1]?.index ?? text.length,
      );
      const methods =
        match[1] === "on"
          ? [...match[2]!.matchAll(/"([A-Z]+)"/g)].map((m) => m[1]!)
          : [match[1]!.toUpperCase()];
      return methods.map((method) => ({
        route: `${method} ${match[4]}`,
        body,
        file,
      }));
    });
  });
}

const exemptRoutes = new Set([
  ...browserOperations.flatMap((o) => o.routes ?? []),
  ...Object.keys(transportRoutes),
]);

void test("every API route invokes a capability or is an explicit exemption", () => {
  const found = routes();
  assert.ok(found.length > 30, "the route scan found too few routes");
  for (const { route, body, file } of found) {
    const viaCapability = /invokeForWeb\(|actionRoute\(/.test(body);
    if (exemptRoutes.has(route)) {
      assert.ok(
        !viaCapability || route.startsWith("ALL "),
        `${route} invokes a capability; remove its exemption`,
      );
      continue;
    }
    assert.ok(
      viaCapability,
      `${route} (${file}) neither invokes a capability nor is listed in browserOperations or transportRoutes (packages/core/src/capabilities/human-only.ts)`,
    );
    // Capability names a route dispatches to must exist on the web.
    for (const name of body.matchAll(
      /invokeForWeb\(\s*[\w.]+,\s*"([A-Za-z]+)"|^\s*[a-zA-Z]+: "([A-Za-z]+)",$/gm,
    )) {
      const capability = name[1] ?? name[2]!;
      assert.ok(
        getCapability(capability, "web"),
        `${route} names unknown capability ${capability}`,
      );
    }
  }
  const registered = new Set(found.map((r) => r.route));
  for (const route of exemptRoutes)
    assert.ok(registered.has(route), `Exempt route ${route} no longer exists`);
});

void test("every Better Auth call and capability call in the browser is accounted for", () => {
  const files = sources(platform);
  const used = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/authClient((?:\s*\.\s*[A-Za-z]\w*)+)/g))
      used.add(match[1]!.replace(/\s|^\./g, ""));
    for (const match of text.matchAll(
      /callCapability(?:<[^>]*>)?\(\s*"([A-Za-z]+)"/g,
    ))
      assert.ok(
        getCapability(match[1]!, "web"),
        `${file} calls unknown capability ${match[1]}`,
      );
  }
  // `authClient.organization` on its own precedes a call on a new line.
  used.delete("organization");
  assert.ok(used.size > 10, "the Better Auth scan found too few calls");
  const listed = new Set(browserOperations.flatMap((o) => o.authClient ?? []));
  for (const method of used)
    assert.ok(
      listed.has(method),
      `authClient.${method} is a browser operation missing from browserOperations (packages/core/src/capabilities/human-only.ts)`,
    );
  for (const method of listed)
    assert.ok(
      used.has(method),
      `browserOperations lists authClient.${method}, which the browser no longer calls`,
    );
});
