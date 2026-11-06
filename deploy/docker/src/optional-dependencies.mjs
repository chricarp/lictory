// Decides whether a package the runtime tracer cannot find may be left out of
// an image: only when the package that imports it declares it optional. Such
// imports sit in try/catch (ws loads bufferutil and utf-8-validate this way),
// so the code runs without them; any other missing package fails the build.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The package a bare specifier names, or undefined for relative, absolute
 * and builtin specifiers. */
export function packageName(specifier) {
  if (/^(\.|\/|[a-zA-Z]:[\\/]|node:)/.test(specifier)) return undefined;
  const parts = specifier.split("/");
  if (specifier.startsWith("@"))
    return parts.length > 1 && parts[1] ? `${parts[0]}/${parts[1]}` : undefined;
  return parts[0] || undefined;
}

/** Whether a package.json manifest declares `name` an optional dependency
 * (optionalDependencies, or a peer dependency marked optional). */
export function declaresOptional(manifest, name) {
  if (Object.hasOwn(manifest.optionalDependencies ?? {}, name)) return true;
  return (
    Object.hasOwn(manifest.peerDependencies ?? {}, name) &&
    manifest.peerDependenciesMeta?.[name]?.optional === true
  );
}

/** The manifest of the package that owns `file`: the nearest package.json
 * with a name (nested ones such as {"type": "module"} only set module rules). */
export function owningManifest(file, readJson = readJsonFile) {
  let dir = dirname(file);
  for (;;) {
    const manifest = readJson(join(dir, "package.json"));
    if (manifest && typeof manifest.name === "string") return manifest;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** The importing package's name when it declares the missing `specifier`
 * optional, otherwise undefined. */
export function optionalMiss(specifier, parent, readJson = readJsonFile) {
  const name = packageName(specifier);
  if (!name) return undefined;
  const manifest = owningManifest(parent, readJson);
  return manifest && declaresOptional(manifest, name)
    ? manifest.name
    : undefined;
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return undefined;
    throw error;
  }
}
