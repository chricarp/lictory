import { z } from "zod";

// Proposed children are part of an immutable branch snapshot. They become
// ordinary work items only when that reviewed snapshot is merged into main.
export const proposedChildSchema = z.object({
  workItemId: z.uuid(),
  typeId: z.string().min(1).max(160),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(200_000),
});
export const proposedChildrenSchema = z
  .array(proposedChildSchema)
  .max(100)
  .superRefine((children, ctx) => {
    if (
      new Set(children.map((child) => child.workItemId)).size !==
      children.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Proposed child identifiers must be unique.",
      });
  });
export type ProposedChild = z.infer<typeof proposedChildSchema>;

// PostgreSQL jsonb does not preserve object-key order. Human and server
// approvals must fingerprint the same values after a database round trip.
const childValue = (child: ProposedChild) => [
  child.workItemId,
  child.typeId,
  child.title,
  child.description,
];

export const sameProposedChildren = (
  a: ProposedChild[] = [],
  b: ProposedChild[] = [],
) => JSON.stringify(a.map(childValue)) === JSON.stringify(b.map(childValue));

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
          snapshot.proposedChildren.map(childValue),
        ]
      : [snapshot.title, snapshot.content],
  );
}

// A merge that changes only the breakdown leaves the specification text as it
// was. Review decisions on that text carry to the new revision as new rows;
// the previous approval ends with this reason so history shows where it went
// and nobody is told their approval was invalidated.
// A carried approval is in turn superseded when the merged pull request's
// approval for the same responsibility is recorded on that revision.
const carriedPrefix = "Carried to revision ";
export const carriedApprovalReason = (revision: number) =>
  `${carriedPrefix}${revision}: specification text unchanged`;
export const supersededApprovalReason =
  "Superseded by the merged pull request's approval";
export const isCarriedApproval = (endReason: string | null | undefined) =>
  !!endReason &&
  (endReason.startsWith(carriedPrefix) ||
    endReason === supersededApprovalReason);
