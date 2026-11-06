import { describe, expect, test } from "bun:test";
import {
  declaresOptional,
  optionalMiss,
  packageName,
} from "./optional-dependencies.mjs";

const ws = {
  name: "ws",
  peerDependencies: { bufferutil: "^4.0.1", "utf-8-validate": ">=5.0.2" },
  peerDependenciesMeta: {
    bufferutil: { optional: true },
    "utf-8-validate": { optional: true },
  },
};

function files(tree) {
  return (path) => tree[path];
}

describe("optional dependency misses", () => {
  test("names the package a specifier imports", () => {
    expect(packageName("bufferutil")).toBe("bufferutil");
    expect(packageName("lodash/fp")).toBe("lodash");
    expect(packageName("@scope/pkg/sub/path.js")).toBe("@scope/pkg");
    expect(packageName("./local.js")).toBeUndefined();
    expect(packageName("/abs/file.js")).toBeUndefined();
    expect(packageName("node:fs")).toBeUndefined();
    expect(packageName("@scope")).toBeUndefined();
  });

  test("optional peers and optional dependencies are optional", () => {
    expect(declaresOptional(ws, "bufferutil")).toBe(true);
    expect(
      declaresOptional({ optionalDependencies: { fsevents: "*" } }, "fsevents"),
    ).toBe(true);
  });

  test("required, plain peer and undeclared packages are not optional", () => {
    expect(declaresOptional({ dependencies: { a: "1" } }, "a")).toBe(false);
    expect(declaresOptional({ peerDependencies: { a: "1" } }, "a")).toBe(false);
    expect(
      declaresOptional(
        {
          peerDependencies: { a: "1" },
          peerDependenciesMeta: { a: { optional: false } },
        },
        "a",
      ),
    ).toBe(false);
    // Metadata alone, without the peer declaration, is not a declaration.
    expect(
      declaresOptional(
        { peerDependenciesMeta: { a: { optional: true } } },
        "a",
      ),
    ).toBe(false);
    expect(declaresOptional(ws, "constructor")).toBe(false);
  });

  test("the importing package's nearest named manifest decides", () => {
    const read = files({
      "/src/node_modules/ws/lib/package.json": { type: "commonjs" },
      "/src/node_modules/ws/package.json": ws,
      "/src/apps/api/package.json": {
        name: "@lictory/api",
        dependencies: { ws: "8" },
      },
    });
    expect(
      optionalMiss(
        "bufferutil",
        "/src/node_modules/ws/lib/buffer-util.js",
        read,
      ),
    ).toBe("ws");
    expect(
      optionalMiss(
        "utf-8-validate/fallback",
        "/src/node_modules/ws/lib/validation.js",
        read,
      ),
    ).toBe("ws");
    // ws does not declare this one, and the app requires its dependencies.
    expect(
      optionalMiss(
        "missing-required",
        "/src/node_modules/ws/lib/buffer-util.js",
        read,
      ),
    ).toBeUndefined();
    expect(
      optionalMiss("bufferutil", "/src/apps/api/dist/index.js", read),
    ).toBeUndefined();
    expect(
      optionalMiss(
        "./gone.js",
        "/src/node_modules/ws/lib/buffer-util.js",
        read,
      ),
    ).toBeUndefined();
    expect(
      optionalMiss("bufferutil", "/elsewhere/file.js", read),
    ).toBeUndefined();
  });
});
