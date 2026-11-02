import { z } from "zod";

// A breakdown is part of an immutable branch snapshot. Each entry is either a
// proposed new child or a proposed change to an existing child. Nothing in it
// touches shared work until the reviewed snapshot is merged into main.
const itemId = z.string().min(1).max(160);
export const proposedChildSchema = z.object({
  workItemId: z.uuid(),
  typeId: z.string().min(1).max(160),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(200_000),
});
// A change to an existing child names the child's state it was proposed
// against (`base`). Merge applies it only while the child still has that
// revision and parent; otherwise the PR shows a conflict instead of silently
// overwriting work done on the child meanwhile.
export const childChangeSchema = z.object({
  changeId: z.uuid(),
  workItemId: itemId,
  base: z.object({
    revisionId: itemId,
    title: z.string().max(240),
  }),
  // Text of children without a specification. Spec-backed children are
  // amended through their own specification, where their reviewers are.
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(200_000).optional(),
  // Move under another item of the project (or a child proposed in the same
  // breakdown); null detaches it from any parent.
  parentId: itemId.nullable().optional(),
  // Archive the child (reversible). Exclusive with other changes.
  archive: z.literal(true).optional(),
});
export const breakdownEntrySchema = z.union([
  childChangeSchema,
  proposedChildSchema,
]);
export type NewChild = z.infer<typeof proposedChildSchema>;
export type ChildChange = z.infer<typeof childChangeSchema>;
export type ProposedChild = NewChild | ChildChange;

export const isChildChange = (entry: ProposedChild): entry is ChildChange =>
  "changeId" in entry;
export const isNewChild = (entry: ProposedChild): entry is NewChild =>
  !isChildChange(entry);
// Stable identity of an entry across commits and three-way merges.
export const entryKey = (entry: ProposedChild) =>
  isChildChange(entry) ? entry.changeId : entry.workItemId;

export const proposedChildrenSchema = z
  .array(breakdownEntrySchema)
  .max(500)
  .superRefine((entries, ctx) => {
    if (new Set(entries.map(entryKey)).size !== entries.length)
      ctx.addIssue({
        code: "custom",
        message: "Proposed child identifiers must be unique.",
      });
    if (entries.filter(isNewChild).length > 100)
      ctx.addIssue({
        code: "custom",
        message: "A breakdown can propose at most 100 new children.",
      });
    for (const change of entries.filter(isChildChange)) {
      const changes = [
        change.title,
        change.description,
        change.parentId,
        change.archive,
      ].filter((value) => value !== undefined).length;
      if (!changes)
        ctx.addIssue({
          code: "custom",
          message: "A proposed change to an existing child must change it.",
        });
      if (change.archive && changes > 1)
        ctx.addIssue({
          code: "custom",
          message: "Archiving a child cannot be combined with other changes.",
        });
    }
  });

// PostgreSQL jsonb does not preserve object-key order. Human and server
// approvals must fingerprint the same values after a database round trip.
// New-child values are unchanged so existing fingerprints stay valid.
const entryValue = (entry: ProposedChild) =>
  isChildChange(entry)
    ? [
        "change",
        entry.changeId,
        entry.workItemId,
        entry.base.revisionId,
        entry.base.title,
        entry.title ?? null,
        entry.description ?? null,
        entry.parentId === undefined ? "keep" : ["move", entry.parentId],
        entry.archive ?? false,
      ]
    : [entry.workItemId, entry.typeId, entry.title, entry.description];

export const sameProposedChildren = (
  a: ProposedChild[] = [],
  b: ProposedChild[] = [],
) => JSON.stringify(a.map(entryValue)) === JSON.stringify(b.map(entryValue));

// Entries main has not accepted yet: what a pull request would still apply.
export function pendingEntries(
  entries: ProposedChild[] = [],
  accepted: ProposedChild[] = [],
) {
  const applied = new Set(accepted.map(entryKey));
  return entries.filter((entry) => !applied.has(entryKey(entry)));
}

// Keep ordinary specification hashes unchanged. A breakdown is reviewed as
// part of the result, so changing only a proposed child's scope stales approval.
export function reviewResultValue(snapshot: {
  title: string;
  content: string;
  proposedChildren?: ProposedChild[];
}) {
  return JSON.stringify(
    snapshot.proposedChildren?.length
      ? [
          snapshot.title,
          snapshot.content,
          snapshot.proposedChildren.map(entryValue),
        ]
      : [snapshot.title, snapshot.content],
  );
}
