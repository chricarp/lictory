import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { isSafePageLink, pageSchema, PAGE_SCHEMA_VERSION } from "./schema";

export type PageNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PageNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};
export class PageDocumentError extends Error {
  constructor(
    message = "Page content is invalid. Check its blocks, formatting and references.",
  ) {
    super(message);
    this.name = "PageDocumentError";
  }
}
export function stableSerialize(value: unknown): string {
  return JSON.stringify(sort(value));
}
function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sort(v)]),
    );
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PageDocumentError();
  return value as Record<string, unknown>;
}
function checkAttrs(attrs: unknown, allowed: Record<string, unknown>) {
  if (attrs === undefined) return;
  for (const [key, value] of Object.entries(object(attrs))) {
    if (!Object.hasOwn(allowed, key))
      throw new PageDocumentError(
        `Page content has an unsupported attribute: ${key}.`,
      );
    if (value === undefined) continue;
    const nullable = [
      "id",
      "alt",
      "title",
      "language",
      "colwidth",
      "pageId",
      "commitId",
      "decisionId",
      "label",
      "workItemId",
      "key",
      "src",
      "href",
      "target",
      "rel",
      "class",
      "align",
      "type",
    ].includes(key);
    if (value === null && nullable) continue;
    if (["level", "start", "colspan", "rowspan"].includes(key)) {
      if (
        !Number.isSafeInteger(value) ||
        (value as number) < 1 ||
        (key === "level" && (value as number) > 3)
      )
        throw new PageDocumentError();
    } else if (key === "align") {
      if (
        typeof value !== "string" ||
        !["left", "center", "right"].includes(value)
      )
        throw new PageDocumentError();
    } else if (key === "checked") {
      if (typeof value !== "boolean") throw new PageDocumentError();
    } else if (key === "colwidth") {
      if (
        !Array.isArray(value) ||
        !value.every((v) => Number.isSafeInteger(v) && v > 0)
      )
        throw new PageDocumentError();
    } else if (typeof value !== "string") throw new PageDocumentError();
  }
}
function inspect(value: unknown, depth = 0): PageNode {
  if (depth > 100)
    throw new PageDocumentError("Page nesting exceeds 100 levels.");
  const n = object(value);
  if (typeof n.type !== "string" || !pageSchema.nodes[n.type])
    throw new PageDocumentError("Page content contains an unsupported block.");
  if (
    Object.keys(n).some(
      (k) => !["type", "attrs", "content", "marks", "text"].includes(k),
    )
  )
    throw new PageDocumentError();
  checkAttrs(n.attrs, pageSchema.nodes[n.type]!.spec.attrs ?? {});
  if (n.marks !== undefined) {
    if (!Array.isArray(n.marks)) throw new PageDocumentError();
    for (const mark of n.marks) {
      const m = object(mark);
      if (
        typeof m.type !== "string" ||
        !pageSchema.marks[m.type] ||
        Object.keys(m).some((k) => !["type", "attrs"].includes(k))
      )
        throw new PageDocumentError(
          "Page content contains unsupported formatting.",
        );
      checkAttrs(m.attrs, pageSchema.marks[m.type]!.spec.attrs ?? {});
      if (m.type === "link") {
        const href = object(m.attrs).href;
        if (typeof href !== "string" || !isSafePageLink(href))
          throw new PageDocumentError("Page links must use a safe URL.");
      }
    }
  }
  const a = n.attrs === undefined ? {} : object(n.attrs);
  for (const key of n.type === "workItemRef"
    ? ["workItemId", "key"]
    : n.type === "pageRef"
      ? ["pageId"]
      : n.type === "decisionRef"
        ? ["decisionId", "label"]
        : [])
    if (typeof a[key] !== "string" || !a[key].trim())
      throw new PageDocumentError("Page references require an identifier.");
  if (
    n.type === "image" &&
    (typeof a.src !== "string" ||
      !(/^\/api\/files\/[a-zA-Z0-9_-]+$/.test(a.src) || isHttps(a.src)))
  )
    throw new PageDocumentError(
      "Images require a Lictory file reference or HTTPS URL.",
    );
  if (
    (n.type === "text" && n.content !== undefined) ||
    (n.type !== "text" && n.text !== undefined)
  )
    throw new PageDocumentError();
  if (n.text !== undefined && typeof n.text !== "string")
    throw new PageDocumentError();
  if (n.content !== undefined) {
    if (!Array.isArray(n.content)) throw new PageDocumentError();
    n.content.forEach((v) => inspect(v, depth + 1));
  }
  return n as PageNode;
}
function isHttps(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
export function canonicalizeDocument(json: unknown): PageNode {
  try {
    const input = inspect(structuredClone(json));
    if (input.type !== "doc")
      throw new PageDocumentError("Page content must be a document.");
    const node = pageSchema.nodeFromJSON(input);
    node.check();
    const output = node.toJSON() as PageNode;
    const seen = new Set<string>();
    function visit(n: PageNode) {
      // An unpinned page reference stores no commit, so documents written
      // before pins existed keep their exact canonical form and hash.
      if (n.type === "pageRef" && n.attrs && n.attrs.commitId == null)
        delete n.attrs.commitId;
      if (pageSchema.nodes[n.type]!.isBlock && n.type !== "doc") {
        const id = n.attrs?.id;
        const next =
          typeof id === "string" && id.trim() && !seen.has(id)
            ? id
            : crypto.randomUUID();
        n.attrs = { ...n.attrs, id: next };
        seen.add(next);
      }
      n.content?.forEach(visit);
    }
    visit(output);
    return sort(output) as PageNode;
  } catch (error) {
    if (error instanceof PageDocumentError) throw error;
    throw new PageDocumentError();
  }
}
export function emptyDocument(): PageNode {
  return canonicalizeDocument({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
}
/** Synchronous SHA-256 shared by the browser and server. */
export function documentHash(title: string, json: unknown): string {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        stableSerialize({
          title,
          content: canonicalizeDocument(json),
          schemaVersion: PAGE_SCHEMA_VERSION,
        }),
      ),
    ),
  );
}
