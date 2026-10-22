import { defineMutator, defineMutators } from "@rocicorp/zero";
import "@lictory/zero/context";
import { optimistic, type Entities } from "@lictory/core/contracts/optimistic";
import {
  directoryKey,
  projectionRow,
  type DirectoryProjection,
} from "@lictory/core/contracts/projection";
import { mutationSchema, type Entity } from "@lictory/core/contracts/protocol";
import { zql } from "@lictory/zero/schema";

// Every workspace command is one mutation of the existing domain protocol.
// The client run predicts safe changes with the shared optimistic reducers;
// commands that need authorization or exact bases (revisions, branches,
// suggestions, review decisions, merges) predict nothing and wait for the
// server. The API registers a server implementation under the same name that
// runs the domain command inside Zero's transaction.
export const mutators = defineMutators({
  workspace: {
    apply: defineMutator(mutationSchema, async ({ tx, args, ctx }) => {
      if (tx.location === "server")
        throw new Error("The API must override workspace.apply.");
      const command = args.command;
      const workItemId =
        "workItemId" in command && typeof command.workItemId === "string"
          ? command.workItemId
          : undefined;
      const [listRows, itemRows] = await Promise.all([
        tx.run(
          zql.syncEntity
            .where("organizationId", args.organizationId)
            .where("workItemId", "IS", null),
        ),
        workItemId
          ? tx.run(
              zql.syncEntity
                .where("organizationId", args.organizationId)
                .where("workItemId", workItemId),
            )
          : Promise.resolve([]),
      ]);
      const directory = listRows.find(
        (row) => row.key === directoryKey(args.organizationId),
      )?.data as DirectoryProjection | undefined;
      const before: Entities = {};
      for (const row of [...listRows, ...itemRows])
        if (row.type !== "directory" && row.type !== "organizationProfile")
          before[row.key] = row.data as unknown as Entity;
      const disciplines = new Map(
        directory?.disciplines.map((d) => [d.id, d.name]) ?? [],
      );
      const after = optimistic(
        before,
        [args],
        ctx.userID,
        (id) => disciplines.get(id) ?? "Review",
        directory,
      );
      const scope = {
        projectId:
          "projectId" in command && typeof command.projectId === "string"
            ? command.projectId
            : ((before[`workItem:${workItemId}`] as { projectId?: string })
                ?.projectId ?? ""),
        workItemId,
      };
      const now = Date.now();
      for (const [key, entity] of Object.entries(after)) {
        if (before[key] === entity) continue;
        const row = projectionRow(entity, scope);
        await tx.mutate.syncEntity.upsert({
          ...row,
          data: row.data as Readonly<Record<string, never>>,
          updatedAt: now,
        });
      }
      for (const key of Object.keys(before))
        if (!(key in after)) await tx.mutate.syncEntity.delete({ key });
    }),
  },
});
