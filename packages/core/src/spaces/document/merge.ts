import {
  canonicalizeDocument,
  PageDocumentError,
  stableSerialize,
  type PageNode,
} from "./canonical";
import { pageSchema } from "./schema";
import { fragmentMarkdown } from "./markdown";

export type ConflictFragment = { json: PageNode[]; markdown: string };
export type Conflict = {
  id: string;
  blockId: string | null;
  path: number[];
  base: ConflictFragment;
  ours: ConflictFragment;
  theirs: ConflictFragment;
};
export type MergeResult =
  | { status: "clean"; document: PageNode }
  | { status: "conflicts"; document: PageNode; conflicts: Conflict[] };
export type MergeChoice =
  "ours" | "theirs" | "both" | { manual: PageNode | PageNode[] };
const same = (a: unknown, b: unknown) =>
  stableSerialize(a) === stableSerialize(b);
const id = (n: PageNode) => (typeof n.attrs?.id === "string" ? n.attrs.id : "");
const fragment = (json: PageNode[]): ConflictFragment => ({
  json: structuredClone(json),
  markdown: fragmentMarkdown(json),
});
function blockCount(n: PageNode): number {
  return (
    (pageSchema.nodes[n.type]!.isBlock ? 1 : 0) +
    (n.content ?? []).reduce((sum, child) => sum + blockCount(child), 0)
  );
}
const lists = new Set(["bulletList", "orderedList", "taskList"]);
function identityAmbiguous(n: PageNode, seen = new Set<string>()): boolean {
  if (
    n.type !== "doc" &&
    n.type !== "text" &&
    !["hardBreak", "workItemRef", "pageRef"].includes(n.type)
  ) {
    if (!n.attrs?.id || seen.has(id(n))) return true;
    seen.add(id(n));
  }
  return n.content?.some((c) => identityAmbiguous(c, seen)) ?? false;
}
function structure(n: PageNode): unknown {
  return {
    type: n.type,
    id: id(n),
    children: n.content
      ?.filter(
        (c) =>
          !["text", "hardBreak", "workItemRef", "pageRef"].includes(c.type),
      )
      .map(structure),
  };
}
type Edit = {
  start: number;
  end: number;
  nodes: PageNode[];
  side: "ours" | "theirs";
};
/** LCS is bounded before allocation. IDs match identity; content changes are edits too. */
function edits(base: PageNode[], next: PageNode[], side: Edit["side"]): Edit[] {
  const m = Array.from(
    { length: base.length + 1 },
    () => new Uint32Array(next.length + 1),
  );
  for (let i = base.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      m[i]![j] =
        id(base[i]!) === id(next[j]!)
          ? 1 + m[i + 1]![j + 1]!
          : Math.max(m[i + 1]![j]!, m[i]![j + 1]!);
  const out: Edit[] = [];
  let i = 0,
    j = 0;
  while (i < base.length || j < next.length) {
    if (i < base.length && j < next.length && id(base[i]!) === id(next[j]!)) {
      if (!same(base[i], next[j]))
        out.push({ start: i, end: i + 1, nodes: [next[j]!], side });
      i++;
      j++;
      continue;
    }
    const start = i,
      nodes: PageNode[] = [];
    while (i < base.length || j < next.length) {
      if (i < base.length && j < next.length && id(base[i]!) === id(next[j]!))
        break;
      if (
        j < next.length &&
        (i === base.length || m[i]![j + 1]! > m[i + 1]![j]!)
      )
        nodes.push(next[j++]!);
      else i++;
    }
    out.push({ start, end: i, nodes, side });
  }
  // A split/join is a single local rewrite, including adjacent insertions/deletions.
  return out.reduce<Edit[]>((acc, e) => {
    const prev = acc.at(-1);
    if (
      prev?.end === e.start &&
      (prev.end - prev.start !== prev.nodes.length ||
        e.end - e.start !== e.nodes.length)
    ) {
      prev.end = e.end;
      prev.nodes.push(...e.nodes);
    } else acc.push(e);
    return acc;
  }, []);
}
function overlaps(a: Edit, b: Edit) {
  if (a.start === a.end || b.start === b.end)
    return (
      a.start === b.start ||
      (a.start <= b.start && b.start < a.end) ||
      (b.start <= a.start && a.start < b.end)
    );
  return a.start < b.end && b.start < a.end;
}
/** Never replay Yjs updates across branches. Conflicts retain ours provisionally. */
export function mergeDocuments(input: {
  base: PageNode;
  ours: PageNode;
  theirs: PageNode;
}): MergeResult {
  const base = canonicalizeDocument(input.base),
    ours = canonicalizeDocument(input.ours),
    theirs = canonicalizeDocument(input.theirs);
  const conflicts: Conflict[] = [];
  function conflict(
    b: PageNode[],
    o: PageNode[],
    t: PageNode[],
    path: number[],
    blockId: string | null,
  ): PageNode[] {
    conflicts.push({
      id: `page-conflict:${path.join(".") || "document"}`,
      blockId,
      path,
      base: fragment(b),
      ours: fragment(o),
      theirs: fragment(t),
    });
    return o;
  }
  function mergeNode(
    b: PageNode,
    o: PageNode,
    t: PageNode,
    path: number[],
  ): PageNode {
    if (same(o, t) || same(b, t)) return o;
    if (same(b, o)) return t;
    // Tables are atomic. List structure changes cannot be combined with another edit.
    const container = [
      "doc",
      "blockquote",
      "bulletList",
      "orderedList",
      "taskList",
      "listItem",
      "taskItem",
    ].includes(b.type);
    if (
      !container ||
      b.type !== o.type ||
      b.type !== t.type ||
      !same(b.attrs, o.attrs) ||
      !same(b.attrs, t.attrs) ||
      (lists.has(b.type) &&
        (!same(structure(b), structure(o)) ||
          !same(structure(b), structure(t))))
    )
      return conflict([b], [o], [t], path, id(b) || null)[0]!;
    // Stable headings are section boundaries. Ambiguous moves inside one section
    // should not make an unrelated section part of the conflict.
    if (b.type === "doc") {
      const headings = (n: PageNode) =>
        (n.content ?? []).filter((c) => c.type === "heading").map(id);
      const owners = (n: PageNode) => {
        let sectionId = "";
        return new Map(
          (n.content ?? []).map((c) => {
            if (c.type === "heading") sectionId = id(c);
            return [id(c), sectionId];
          }),
        );
      };
      const baseOwners = owners(b);
      const staysInSections = (n: PageNode) =>
        [...owners(n)].every(
          ([key, sectionId]) =>
            !baseOwners.has(key) || baseOwners.get(key) === sectionId,
        );
      const boundaries = headings(b);
      const lengths = [
        b.content?.length ?? 0,
        o.content?.length ?? 0,
        t.content?.length ?? 0,
      ];
      if (
        boundaries.length &&
        staysInSections(o) &&
        staysInSections(t) &&
        same(boundaries, headings(o)) &&
        same(boundaries, headings(t)) &&
        Math.max(...lengths) ** 2 <= 1_000_000
      ) {
        const sections = (n: PageNode) => {
          const parts: PageNode[][] = [[]];
          for (const child of n.content ?? []) {
            if (child.type === "heading") parts.push([]);
            parts.at(-1)!.push(child);
          }
          return parts;
        };
        const bs = sections(b),
          os = sections(o),
          ts = sections(t),
          content: PageNode[] = [];
        for (let i = 0; i < bs.length; i++) {
          if (same(os[i], ts[i]) || same(bs[i], ts[i])) content.push(...os[i]!);
          else if (same(bs[i], os[i])) content.push(...ts[i]!);
          else
            content.push(
              ...mergeSequence(
                bs[i]!,
                os[i]!,
                ts[i]!,
                [],
                b,
                content.length,
                true,
              ),
            );
        }
        return { ...o, content };
      }
    }
    const checkpoint = conflicts.length;
    const merged = mergeSequence(
      b.content ?? [],
      o.content ?? [],
      t.content ?? [],
      path,
      b,
    );
    const candidate = { ...o, content: merged };
    try {
      pageSchema.nodeFromJSON(candidate).check();
      return candidate;
    } catch {
      conflicts.splice(checkpoint);
      if (b.type === "doc") {
        conflict(b.content ?? [], o.content ?? [], t.content ?? [], [], null);
        return o;
      }
      return conflict([b], [o], [t], path, id(b) || null)[0]!;
    }
  }
  function mergeSequence(
    b: PageNode[],
    o: PageNode[],
    t: PageNode[],
    path: number[],
    parent: PageNode,
    offset = 0,
    section = false,
  ): PageNode[] {
    const whole = () => {
      if (parent.type === "doc")
        return conflict(
          b,
          o,
          t,
          section ? [offset] : path,
          section ? id(b[0]!) || null : null,
        );
      // Sequence conflicts replace the parent, preserving schema validity (lists etc.).
      conflict(
        [parent],
        [{ ...parent, content: o }],
        [{ ...parent, content: t }],
        path,
        id(parent),
      );
      return o;
    };
    if (
      Math.max(b.length * o.length, b.length * t.length, o.length * t.length) >
      1_000_000
    )
      return whole();
    const ids = (ns: PageNode[]) => ns.map(id);
    const bi = ids(b),
      oi = ids(o),
      ti = ids(t);
    const commonOrder = (next: string[]) => next.filter((k) => bi.includes(k));
    const reordered = (next: string[]) =>
      !same(
        commonOrder(next),
        bi.filter((k) => next.includes(k)),
      );
    const om = reordered(oi),
      tm = reordered(ti);
    if (om || tm) {
      // Ambiguous competing moves or move/delete widen to the enclosing valid container.
      if (
        (om && tm && !same(oi, ti)) ||
        !same([...bi].sort(), [...oi].sort()) ||
        !same([...bi].sort(), [...ti].sort())
      )
        return whole();
      const bm = new Map(b.map((n) => [id(n), n])),
        own = new Map(o.map((n) => [id(n), n])),
        other = new Map(t.map((n) => [id(n), n]));
      return (om ? oi : ti).map((key, i) =>
        mergeNode(bm.get(key)!, own.get(key)!, other.get(key)!, [
          ...path,
          offset + i,
        ]),
      );
    }
    const pending = [...edits(b, o, "ours"), ...edits(b, t, "theirs")].sort(
      (a, b) => a.start - b.start || a.end - b.end,
    );
    const out: PageNode[] = [];
    let cursor = 0;
    while (pending.length) {
      const group = [pending.shift()!];
      for (let changed = true; changed;) {
        changed = false;
        for (let i = 0; i < pending.length; i++)
          if (group.some((e) => overlaps(e, pending[i]!))) {
            group.push(pending.splice(i--, 1)[0]!);
            changed = true;
          }
      }
      const start = Math.min(...group.map((e) => e.start)),
        end = Math.max(...group.map((e) => e.end));
      out.push(...b.slice(cursor, start));
      const apply = (side: Edit["side"]) => {
        const result: PageNode[] = [];
        let p = start;
        for (const e of group
          .filter((e) => e.side === side)
          .sort((a, b) => a.start - b.start)) {
          result.push(...b.slice(p, e.start), ...e.nodes);
          p = e.end;
        }
        return [...result, ...b.slice(p, end)];
      };
      const own = apply("ours"),
        other = apply("theirs"),
        original = b.slice(start, end);
      if (same(own, other) || !group.some((e) => e.side === "theirs"))
        out.push(...own);
      else if (!group.some((e) => e.side === "ours")) out.push(...other);
      else if (
        original.length === 1 &&
        own.length === 1 &&
        other.length === 1 &&
        id(original[0]!) === id(own[0]!) &&
        id(original[0]!) === id(other[0]!)
      )
        out.push(
          mergeNode(original[0]!, own[0]!, other[0]!, [
            ...path,
            offset + out.length,
          ]),
        );
      else
        out.push(
          ...conflict(
            original,
            own,
            other,
            [...path, offset + out.length],
            original.length === 1 ? id(original[0]!) : null,
          ),
        );
      cursor = end;
    }
    out.push(...b.slice(cursor));
    return out;
  }
  let document: PageNode;
  if (same(input.ours, input.theirs) || same(input.base, input.theirs))
    document = ours;
  else if (same(input.base, input.ours)) document = theirs;
  else if (
    [input.base, input.ours, input.theirs].some((n) => identityAmbiguous(n)) ||
    stableSerialize(input).length > 3_000_000 ||
    Math.max(blockCount(base), blockCount(ours), blockCount(theirs)) > 1000
  ) {
    conflict(
      base.content ?? [],
      ours.content ?? [],
      theirs.content ?? [],
      [],
      null,
    );
    document = ours;
  } else document = mergeNode(base, ours, theirs, []);
  // Deletions may empty doc; retain one valid empty paragraph.
  if (!document.content?.length)
    document = { type: "doc", content: [{ type: "paragraph" }] };
  return conflicts.length
    ? {
        status: "conflicts",
        document: canonicalizeDocument(document),
        conflicts,
      }
    : { status: "clean", document: canonicalizeDocument(document) };
}
export function resolveMerge(
  result: MergeResult,
  choices: Record<string, MergeChoice>,
): PageNode {
  if (result.status === "clean") return canonicalizeDocument(result.document);
  const document = structuredClone(result.document);
  // Reverse paths so sibling replacements cannot shift unresolved paths.
  for (const c of [...result.conflicts].sort((a, b) => {
    for (let i = 0; i < Math.max(a.path.length, b.path.length); i++) {
      const d = (b.path[i] ?? -1) - (a.path[i] ?? -1);
      if (d) return d;
    }
    return 0;
  })) {
    const choice = choices[c.id];
    if (!choice)
      throw new PageDocumentError(
        "Choose a resolution for every page conflict.",
      );
    const replacement =
      typeof choice === "object"
        ? Array.isArray(choice.manual)
          ? choice.manual
          : [choice.manual]
        : choice === "both"
          ? [...c.ours.json, ...c.theirs.json]
          : choice === "ours"
            ? c.ours.json
            : choice === "theirs"
              ? c.theirs.json
              : null;
    if (!replacement)
      throw new PageDocumentError("Unknown page conflict resolution.");
    if (!c.path.length) document.content = structuredClone(replacement);
    else {
      let parent = document;
      for (const index of c.path.slice(0, -1)) {
        const child = parent.content?.[index];
        if (!child) throw new PageDocumentError();
        parent = child;
      }
      parent.content!.splice(
        c.path.at(-1)!,
        c.ours.json.length,
        ...structuredClone(replacement),
      );
    }
  }
  if (!document.content?.length) document.content = [{ type: "paragraph" }];
  return canonicalizeDocument(document);
}
