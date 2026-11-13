import { identifierPattern } from "@lictory/core/lib/work-items";

// Addresses of this organization's work items and Lictory Spaces pages, as
// they appear in text written outside the editors (Litto's answers link work
// as `/acme/items/PAY-142` and pages as `/acme/spaces/SPACE/pages/ID`). A
// reader can show such a link as the same live reference the documents use
// (contracts/references.ts) when the link names its target.

export type AppLink =
  | { kind: "item"; key: string; whole: boolean }
  | { kind: "page"; id: string; commitId?: string; whole: boolean };

const segment = /^[A-Za-z0-9_-]{1,160}$/;

/**
 * The work item (by key) or page an address points at inside organization
 * `org`, or undefined. Absolute addresses count only on `origin`, the app's
 * own. `whole` is false when the address points somewhere within the target
 * (another tab, a discussion, a page's history) rather than at the target.
 */
export function parseAppLink(
  href: string | null | undefined,
  org: string,
  origin?: string,
): AppLink | undefined {
  if (!href || !org) return undefined;
  const base = origin ?? "https://lictory.invalid";
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return undefined;
  }
  // Whatever the address looks like ("//host", "/\\host"), it must resolve
  // to our own origin.
  if (url.origin !== new URL(base).origin) return undefined;
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(1);
  let decoded: string[];
  try {
    decoded = parts.map((p) => decodeURIComponent(p));
  } catch {
    return undefined;
  }
  if (decoded[0] !== org) return undefined;
  const rest = decoded.slice(1);
  const params = [...url.searchParams.keys()];
  const extras = url.hash !== "";

  // /org/items/KEY (any project) and /org/project/items/KEY.
  const key =
    rest.length === 2 && rest[0] === "items"
      ? rest[1]
      : rest.length === 3 && rest[1] === "items"
        ? rest[2]
        : undefined;
  if (key !== undefined) {
    if (!identifierPattern.test(key)) return undefined;
    if (
      rest.length === 3 &&
      rest[0]!.toUpperCase() !== key.split("-")[0]!.toUpperCase()
    )
      return undefined;
    return {
      kind: "item",
      key: key.toUpperCase(),
      whole: params.length === 0 && !extras,
    };
  }

  // /org/spaces/SPACE/pages/ID, optionally ?commit=ID (one exact version).
  if (rest[0] === "spaces" && rest[2] === "pages" && rest.length >= 4) {
    const id = rest[3]!;
    if (!rest[1] || !segment.test(id)) return undefined;
    const commitId = url.searchParams.get("commit") ?? undefined;
    if (commitId !== undefined && !segment.test(commitId)) return undefined;
    return {
      kind: "page",
      id,
      ...(commitId ? { commitId } : {}),
      whole:
        rest.length === 4 &&
        !extras &&
        params.every((p) => p === "commit") &&
        url.searchParams.getAll("commit").length <= 1,
    };
  }
  return undefined;
}

const normalize = (text: string) =>
  text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Separators and quotes around what a label says ("PAY-1: Title", “Title”).
const edges = /^[\s,:;·–—"'“”‘’-]+|[\s,:;·–—"'“”‘’-]+$/g;
// The version annotation of a cited page: "(version 3)", ", v3".
const versionNote = /^\(?(?:version|v)\s*\d+\)?$/;

// Whether `text` is the title, alone or (a page's) with a version
// annotation.
function namesTitle(text: string, title: string, versioned: boolean) {
  if (!title) return false;
  if (text === title) return true;
  if (!versioned || !text.startsWith(title)) return false;
  const note = text.slice(title.length).replace(edges, "");
  return versionNote.test(note);
}

/**
 * Whether a link's text names its target, so a chip can stand in for it
 * without losing words: the address itself, the item's key, the title
 * (with the version annotation of a cited page), or the key with the title
 * ("PAY-142, Retry payments", "Retry payments (PAY-142)"). Text that says
 * anything more ("blocking discussion", "Test failure handling") keeps its
 * words.
 */
export function labelNamesTarget(
  label: string,
  target: { key?: string; title: string },
  href?: string,
): boolean {
  const text = normalize(label);
  if (!text) return true;
  if (href && text === normalize(href)) return true;
  const title = normalize(target.title);
  // Only pages have versions; items are the targets with a key.
  if (namesTitle(text, title, !target.key)) return true;
  if (!target.key) return false;
  const key = new RegExp(
    `(^|[^a-z0-9-])${escape(normalize(target.key))}(?![a-z0-9-])`,
  );
  if (!key.test(text)) return false;
  const rest = text
    .replace(key, "$1")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(edges, "")
    .replace(/^\((.*)\)$/, "$1")
    .replace(edges, "");
  return rest === "" || namesTitle(rest, title, false);
}
