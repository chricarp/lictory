import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import * as s from "../db/schema";
import type { DeliveryItemOutcome } from "../db/schema";
import { paths } from "../lib/paths";
import {
  capabilitiesOf,
  type Entity,
  type EntityOf,
} from "../sync/shared/protocol";
import { DomainError } from "../sync/server/errors";
import { notifyExport } from "../notifications/server";
import {
  authorize,
  clock,
  directory,
  emitChanges,
  externalLinks,
  isAdmin,
  lock,
  publish,
  serialize,
  type Database,
  type Tx,
} from "../sync/server/service";
import { decryptCredential, encryptCredential } from "./credentials";
import {
  DeliveryError,
  type DeliveryConnection,
  type DeliveryPayload,
  type ExternalRef,
  type OwnedField,
} from "./provider";
import { deliveryProviders, type DeliveryProviders } from "./registry";

// Explicit, human-triggered export of ready work to an external delivery
// system. Invariants:
// - only ready spec-backed items (and plain items under an exported parent)
//   are exported; a root that is not ready refuses the whole export;
// - network calls never run inside the organization lock;
// - every external write is idempotent: links are reserved before the
//   first call, a create attempt is committed before it is made, and a
//   crashed create is recovered through the identity stamped externally;
// - external edits to owned fields are never overwritten without the
//   requester confirming that item;
// - results are recorded per item, so partial success is visible and the
//   failed items can be exported again on their own.

export type ExportRequest = {
  organizationId: string;
  // Export an item and its subtree, or exactly these items.
  rootId?: string;
  itemIds?: string[];
};

export type PlanAction =
  | "create"
  | "update"
  | "unchanged"
  | "not_ready"
  | "parent_excluded"
  | "no_target"
  | "unmapped";

export type PlanEntry = {
  workItemId: string;
  parentId: string | null;
  key: string;
  title: string;
  typeName: string;
  depth: number;
  action: PlanAction;
  reason?: string;
  externalKey?: string;
  externalUrl?: string;
  // Owned fields edited externally since the last export; "linked" when the
  // item was linked to an existing issue and has never been exported.
  conflict?: (OwnedField | "linked")[];
};

export type ExportPlan = {
  connectionId: string | null;
  connectionName: string | null;
  entries: PlanEntry[];
};

const exportable = new Set<PlanAction>(["create", "update", "unchanged"]);
// A create attempt younger than this may not be searchable externally yet;
// recovery waits instead of risking a duplicate.
const CREATE_CONFIRM_MS = 90_000;
const LEASE_MS = 5 * 60_000;

type Options = {
  providers?: DeliveryProviders;
  appUrl?: string;
  now?: () => Date;
};

type ItemRow = typeof s.workItem.$inferSelect;
type LinkRow = typeof s.workItemExternalLink.$inferSelect;
type ConnectionRow = typeof s.deliveryConnection.$inferSelect;

export function createDeliveryService(db: Database, options: Options = {}) {
  const providers = () => options.providers ?? deliveryProviders();
  const appUrl = () =>
    (options.appUrl ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  const now = options.now ?? (() => new Date());

  const access = async (tx: Tx, userId: string, organizationId: string) => {
    const membership = await authorize(tx, userId, organizationId);
    const roster = await directory(tx, userId, organizationId);
    return {
      admin: isAdmin(membership),
      capabilities: capabilitiesOf(roster.roles, userId),
      roster,
    };
  };
  const requireAdmin = (admin: boolean) => {
    if (!admin)
      throw new DomainError(
        "forbidden",
        "An organization administrator must manage delivery connections.",
      );
  };
  const requirePublisher = (capabilities: { publishDelivery: boolean }) => {
    if (!capabilities.publishDelivery)
      throw new DomainError(
        "forbidden",
        "Your roles cannot export work to external delivery systems. Ask an administrator to grant “Export to delivery tools”.",
      );
  };

  const connectionRow = async (
    tx: Tx | Database,
    organizationId: string,
    connectionId: string,
  ) => {
    const row = (
      await tx
        .select()
        .from(s.deliveryConnection)
        .where(
          and(
            eq(s.deliveryConnection.organizationId, organizationId),
            eq(s.deliveryConnection.id, connectionId),
            isNull(s.deliveryConnection.archivedAt),
          ),
        )
    )[0];
    if (!row)
      throw new DomainError(
        "unavailable",
        "The delivery connection is unavailable.",
      );
    return row;
  };
  const open = (row: ConnectionRow) => ({
    provider: providers()[row.provider],
    connection: {
      baseUrl: row.baseUrl,
      credential: decryptCredential(
        row.organizationId,
        row.encryptedCredential,
      ),
    } satisfies DeliveryConnection,
  });

  // Invalidate clients after a directory-only change (connections, targets).
  const touch = async (tx: Tx, organizationId: string) =>
    publish(tx, organizationId, await clock(tx, organizationId));

  const markConnection = async (row: ConnectionRow, error: unknown) => {
    if (!(error instanceof DeliveryError) || error.kind !== "authentication")
      return;
    await db.transaction(async (tx) => {
      await lock(tx, row.organizationId);
      await tx
        .update(s.deliveryConnection)
        .set({ status: "invalid", lastError: error.message })
        .where(
          and(
            eq(s.deliveryConnection.organizationId, row.organizationId),
            eq(s.deliveryConnection.id, row.id),
          ),
        );
      await touch(tx, row.organizationId);
    });
  };

  // ---------------------------------------------------------------- plan

  async function plan(
    tx: Tx,
    request: ExportRequest,
  ): Promise<ExportPlan & { rows: PlanRows }> {
    const { organizationId } = request;
    const requested = request.rootId
      ? [request.rootId]
      : (request.itemIds ?? []);
    if (requested.length === 0)
      throw new DomainError(
        "validation",
        "Choose at least one item to export.",
      );
    const seeds = await tx
      .select()
      .from(s.workItem)
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          inArray(s.workItem.id, requested),
        ),
      );
    if (seeds.length !== new Set(requested).size)
      throw new DomainError("unavailable", "An item to export is unavailable.");
    const projectId = seeds[0]!.projectId;
    if (seeds.some((i) => i.projectId !== projectId))
      throw new DomainError(
        "validation",
        "Export items from one project at a time.",
      );
    const projectRow = (
      await tx
        .select()
        .from(s.project)
        .where(
          and(
            eq(s.project.organizationId, organizationId),
            eq(s.project.id, projectId),
          ),
        )
    )[0]!;
    const all = await tx
      .select()
      .from(s.workItem)
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          eq(s.workItem.projectId, projectId),
          isNull(s.workItem.archivedAt),
        ),
      )
      .orderBy(asc(s.workItem.rank), asc(s.workItem.createdAt));
    const types = new Map(
      (
        await tx
          .select()
          .from(s.workItemType)
          .where(eq(s.workItemType.organizationId, organizationId))
      ).map((t) => [t.id, t]),
    );
    const canceled = new Set(
      (
        await tx
          .select({ id: s.workflowStatus.id })
          .from(s.workflowStatus)
          .where(
            and(
              eq(s.workflowStatus.organizationId, organizationId),
              eq(s.workflowStatus.category, "canceled"),
            ),
          )
      ).map((x) => x.id),
    );
    const byId = new Map(all.map((i) => [i.id, i]));
    const children = new Map<string, ItemRow[]>();
    for (const item of all)
      if (item.parentId)
        children.set(item.parentId, [
          ...(children.get(item.parentId) ?? []),
          item,
        ]);

    // Parents first, then children in rank order.
    const ordered: { item: ItemRow; depth: number; under: boolean }[] = [];
    const visit = (item: ItemRow, depth: number, under: boolean) => {
      if (canceled.has(item.statusId)) return;
      ordered.push({ item, depth, under });
      if (request.rootId)
        for (const child of children.get(item.id) ?? [])
          visit(child, depth + 1, true);
    };
    if (request.rootId) visit(byId.get(request.rootId) ?? seeds[0]!, 0, false);
    else {
      const picked = new Set(requested);
      const depthOf = (i: ItemRow): number =>
        i.parentId && picked.has(i.parentId) && byId.get(i.parentId)
          ? depthOf(byId.get(i.parentId)!) + 1
          : 0;
      for (const item of seeds
        .filter((i) => !i.archivedAt)
        .sort((a, b) => depthOf(a) - depthOf(b)))
        ordered.push({ item, depth: depthOf(item), under: false });
    }

    const targets = await tx
      .select()
      .from(s.deliveryTarget)
      .innerJoin(
        s.deliveryConnection,
        and(
          eq(
            s.deliveryConnection.organizationId,
            s.deliveryTarget.organizationId,
          ),
          eq(s.deliveryConnection.id, s.deliveryTarget.connectionId),
        ),
      )
      .where(
        and(
          eq(s.deliveryTarget.organizationId, organizationId),
          isNull(s.deliveryConnection.archivedAt),
        ),
      );
    const targetFor = (teamId: string) =>
      targets.find((t) => t.delivery_target.teamId === teamId) ??
      targets.find((t) => t.delivery_target.teamId === null);
    const rootTarget = targetFor(ordered[0]!.item.teamId);
    const connection = rootTarget?.delivery_connection ?? null;

    const ids = ordered.map((o) => o.item.id);
    const links = connection
      ? await tx
          .select()
          .from(s.workItemExternalLink)
          .where(
            and(
              eq(s.workItemExternalLink.organizationId, organizationId),
              eq(s.workItemExternalLink.connectionId, connection.id),
              inArray(s.workItemExternalLink.workItemId, [
                ...ids,
                ...ordered.flatMap((o) =>
                  o.item.parentId ? [o.item.parentId] : [],
                ),
              ]),
            ),
          )
      : [];
    const linkOf = new Map(links.map((l) => [l.workItemId, l]));
    const revisions = await latestRevisions(tx, organizationId, ids);
    const labels = await labelNames(tx, organizationId, ids);

    const slug = await organizationSlug(tx, organizationId);
    const excluded = new Set<string>();
    const entries: PlanEntry[] = [];
    const payloads = new Map<string, Omit<DeliveryPayload, "parent">>();
    for (const { item, depth, under } of ordered) {
      const type = types.get(item.typeId);
      const key = `${projectRow.key}-${item.number}`;
      const link = linkOf.get(item.id);
      const entry: PlanEntry = {
        workItemId: item.id,
        parentId: item.parentId,
        key,
        title: item.title,
        typeName: type?.name ?? "Item",
        depth,
        action: "create",
        ...(link?.externalKey ? { externalKey: link.externalKey } : {}),
        ...(link?.externalUrl ? { externalUrl: link.externalUrl } : {}),
      };
      entries.push(entry);
      const skip = (action: PlanAction, reason: string) => {
        entry.action = action;
        entry.reason = reason;
        excluded.add(item.id);
      };
      if (under && item.parentId && excluded.has(item.parentId)) {
        skip("parent_excluded", "Its parent is not exported.");
        continue;
      }
      if (!type) {
        skip("unmapped", "Its work item type no longer exists.");
        continue;
      }
      if (type.hasSpecification && item.refinementState !== "ready") {
        if (depth === 0 && request.rootId)
          throw new DomainError(
            "validation",
            `${key} is not ready, so it and its children cannot be exported. Complete its readiness checks first.`,
          );
        skip("not_ready", "Not ready: readiness checks are incomplete.");
        continue;
      }
      if (!type.hasSpecification && !under) {
        skip(
          "not_ready",
          `${type.name} items have no specification to approve; export them with their parent.`,
        );
        continue;
      }
      const target = targetFor(item.teamId);
      if (!target || target.delivery_connection.id !== connection?.id) {
        skip(
          "no_target",
          connection
            ? "Its team exports to a different Jira connection. Export it separately."
            : "Connect Jira and choose a project in delivery settings.",
        );
        continue;
      }
      const externalTypeId = target.delivery_target.typeMapping[item.typeId];
      if (!externalTypeId) {
        skip(
          "unmapped",
          `Map ${type.name} to a Jira issue type in delivery settings.`,
        );
        continue;
      }
      const revision = revisions.get(item.id);
      const payload = {
        lictoryItemId: item.id,
        lictoryKey: key,
        lictoryUrl: `${appUrl()}${paths.item(
          slug,
          projectRow.key,
          type.level >= 2 ? "epics" : "stories",
          item.id,
        )}`,
        revisionNumber: revision?.number ?? 0,
        title: item.title,
        content: revision?.content ?? "",
        labels: labels.get(item.id) ?? [],
        externalTypeId,
      };
      payloads.set(item.id, payload);
      if (!link?.externalId) entry.action = "create";
      else {
        const parentLink = item.parentId
          ? linkOf.get(item.parentId)
          : undefined;
        const parent = parentRef(parentLink);
        entry.action =
          link.payloadHash && link.payloadHash === hash({ ...payload, parent })
            ? "unchanged"
            : "update";
        if (!link.externalUpdatedAt) entry.conflict = ["linked"];
      }
    }
    return {
      connectionId: connection?.id ?? null,
      connectionName: connection?.name ?? null,
      entries,
      rows: {
        projectId,
        connection,
        target: (teamId: string) => targetFor(teamId)?.delivery_target,
        links: linkOf,
        payloads,
        items: byId,
      },
    };
  }

  // ------------------------------------------------------------ commands

  return {
    async connect(
      userId: string,
      input: {
        organizationId: string;
        name: string;
        baseUrl: string;
        email: string;
        apiToken: string;
      },
    ) {
      const { organizationId } = input;
      await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireAdmin((await access(tx, userId, organizationId)).admin);
      });
      const provider = providers().jira_cloud;
      const baseUrl = provider.normalizeBaseUrl(input.baseUrl);
      const credential = {
        email: input.email.trim(),
        apiToken: input.apiToken.trim(),
      };
      // Network outside the lock.
      const { accountLabel } = await provider.verify({ baseUrl, credential });
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireAdmin((await access(tx, userId, organizationId)).admin);
        const encryptedCredential = encryptCredential(
          organizationId,
          credential,
        );
        const existing = (
          await tx
            .select()
            .from(s.deliveryConnection)
            .where(
              and(
                eq(s.deliveryConnection.organizationId, organizationId),
                eq(s.deliveryConnection.provider, "jira_cloud"),
                eq(s.deliveryConnection.baseUrl, baseUrl),
                isNull(s.deliveryConnection.archivedAt),
              ),
            )
        )[0];
        const values = {
          name: input.name.trim() || new URL(baseUrl).hostname,
          accountLabel,
          encryptedCredential,
          status: "active" as const,
          lastError: null,
          lastVerifiedAt: now(),
        };
        // Reconnecting the same site replaces the token and keeps every link.
        const id = existing
          ? (
              await tx
                .update(s.deliveryConnection)
                .set(values)
                .where(eq(s.deliveryConnection.id, existing.id))
                .returning({ id: s.deliveryConnection.id })
            )[0]!.id
          : (
              await tx
                .insert(s.deliveryConnection)
                .values({
                  organizationId,
                  provider: "jira_cloud",
                  baseUrl,
                  createdById: userId,
                  ...values,
                })
                .returning({ id: s.deliveryConnection.id })
            )[0]!.id;
        await touch(tx, organizationId);
        return { connectionId: id, accountLabel };
      });
    },

    // Archives the connection; links and publications stay as history, and
    // reconnecting the same site restores them.
    async disconnect(
      userId: string,
      organizationId: string,
      connectionId: string,
    ) {
      await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireAdmin((await access(tx, userId, organizationId)).admin);
        await connectionRow(tx, organizationId, connectionId);
        await tx
          .delete(s.deliveryTarget)
          .where(
            and(
              eq(s.deliveryTarget.organizationId, organizationId),
              eq(s.deliveryTarget.connectionId, connectionId),
            ),
          );
        await tx
          .update(s.deliveryConnection)
          .set({ archivedAt: now() })
          .where(
            and(
              eq(s.deliveryConnection.organizationId, organizationId),
              eq(s.deliveryConnection.id, connectionId),
            ),
          );
        await touch(tx, organizationId);
      });
    },

    async listProjects(
      userId: string,
      organizationId: string,
      connectionId: string,
      query?: string,
    ) {
      const row = await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const a = await access(tx, userId, organizationId);
        if (!a.admin) requirePublisher(a.capabilities);
        return connectionRow(tx, organizationId, connectionId);
      });
      const { provider, connection } = open(row);
      try {
        return await provider.listProjects(connection, query);
      } catch (error) {
        await markConnection(row, error);
        throw error;
      }
    },

    async describeProject(
      userId: string,
      organizationId: string,
      connectionId: string,
      projectKey: string,
    ) {
      const row = await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const a = await access(tx, userId, organizationId);
        if (!a.admin) requirePublisher(a.capabilities);
        return connectionRow(tx, organizationId, connectionId);
      });
      const { provider, connection } = open(row);
      try {
        return await provider.describeProject(connection, projectKey);
      } catch (error) {
        await markConnection(row, error);
        throw error;
      }
    },

    // Where a team's (or, with teamId null, every team's) exports land.
    async setTarget(
      userId: string,
      input: {
        organizationId: string;
        connectionId: string;
        teamId: string | null;
        projectKey: string;
        typeMapping: Record<string, string>;
      },
    ) {
      const { organizationId } = input;
      const row = await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireAdmin((await access(tx, userId, organizationId)).admin);
        return connectionRow(tx, organizationId, input.connectionId);
      });
      const { provider, connection } = open(row);
      const project = await provider.describeProject(
        connection,
        input.projectKey,
      );
      const external = new Map(project.types.map((t) => [t.id, t]));
      await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const { admin, roster } = await access(tx, userId, organizationId);
        requireAdmin(admin);
        if (input.teamId && !roster.teams.some((t) => t.id === input.teamId))
          throw new DomainError("unavailable", "The team is unavailable.");
        const mapping: Record<string, string> = {};
        for (const [typeId, externalTypeId] of Object.entries(
          input.typeMapping,
        )) {
          const type = roster.types.find((t) => t.id === typeId);
          if (!type)
            throw new DomainError(
              "validation",
              "A mapped work item type no longer exists.",
            );
          const externalType = external.get(externalTypeId);
          if (!externalType)
            throw new DomainError(
              "validation",
              `Jira project ${project.key} has no issue type ${externalTypeId} for ${type.name}.`,
            );
          if (externalType.unsupportedRequiredFields.length)
            throw new DomainError(
              "validation",
              `Jira requires ${externalType.unsupportedRequiredFields.map((f) => f.name).join(", ")} on ${externalType.name}, which Lictory cannot fill. Give the field a default in Jira or map ${type.name} to another type.`,
            );
          mapping[typeId] = externalTypeId;
        }
        await tx
          .delete(s.deliveryTarget)
          .where(
            and(
              eq(s.deliveryTarget.organizationId, organizationId),
              input.teamId
                ? eq(s.deliveryTarget.teamId, input.teamId)
                : isNull(s.deliveryTarget.teamId),
            ),
          );
        await tx.insert(s.deliveryTarget).values({
          organizationId,
          connectionId: input.connectionId,
          teamId: input.teamId,
          externalProjectId: project.id,
          externalProjectKey: project.key,
          typeMapping: mapping,
        });
        await touch(tx, organizationId);
      });
      return project;
    },

    async removeTarget(
      userId: string,
      organizationId: string,
      teamId: string | null,
    ) {
      await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireAdmin((await access(tx, userId, organizationId)).admin);
        await tx
          .delete(s.deliveryTarget)
          .where(
            and(
              eq(s.deliveryTarget.organizationId, organizationId),
              teamId
                ? eq(s.deliveryTarget.teamId, teamId)
                : isNull(s.deliveryTarget.teamId),
            ),
          );
        await touch(tx, organizationId);
      });
    },

    // What an export would do, including external edits since the last
    // export, without changing anything.
    async preview(userId: string, request: ExportRequest): Promise<ExportPlan> {
      const { rows, ...result } = await db.transaction(async (tx) => {
        await lock(tx, request.organizationId);
        requirePublisher(
          (await access(tx, userId, request.organizationId)).capabilities,
        );
        return plan(tx, request);
      });
      if (!rows.connection) return result;
      const { provider, connection } = open(rows.connection);
      try {
        await Promise.all(
          result.entries.map(async (entry) => {
            const link = rows.links.get(entry.workItemId);
            if (
              entry.action !== "update" ||
              !link?.externalId ||
              !link.externalUpdatedAt
            )
              return;
            const changed = await provider.changedSince(
              connection,
              refOf(link),
              link.externalUpdatedAt,
            );
            if (changed.length) entry.conflict = changed;
          }),
        );
      } catch (error) {
        await markConnection(rows.connection, error);
        throw error;
      }
      return result;
    },

    async publish(
      userId: string,
      request: ExportRequest & { overwriteItemIds?: string[] },
    ) {
      const publicationId = await db.transaction(async (tx) => {
        await lock(tx, request.organizationId);
        requirePublisher(
          (await access(tx, userId, request.organizationId)).capabilities,
        );
        const { rows, entries } = await plan(tx, request);
        if (!rows.connection)
          throw new DomainError(
            "validation",
            "Connect Jira and choose a project in delivery settings before exporting.",
          );
        if (rows.connection.status === "invalid")
          throw new DomainError(
            "validation",
            `The Jira connection needs attention: ${rows.connection.lastError ?? "reconnect it in delivery settings."}`,
          );
        const chosen = entries.filter((e) => exportable.has(e.action));
        if (chosen.length === 0)
          throw new DomainError(
            "validation",
            entries[0]?.reason
              ? `Nothing can be exported. ${entries[0].key}: ${entries[0].reason}`
              : "Nothing can be exported.",
          );
        const results: Record<
          string,
          { outcome: DeliveryItemOutcome; message?: string }
        > = {};
        for (const e of entries)
          results[e.workItemId] = exportable.has(e.action)
            ? { outcome: "pending" }
            : { outcome: "skipped", message: e.reason };
        const id = crypto.randomUUID();
        await tx.insert(s.deliveryPublication).values({
          id,
          organizationId: request.organizationId,
          projectId: rows.projectId,
          connectionId: rows.connection.id,
          requestedById: userId,
          rootItemId: request.rootId ?? null,
          itemIds: chosen.map((e) => e.workItemId),
          overwriteItemIds: (request.overwriteItemIds ?? []).filter((x) =>
            chosen.some((e) => e.workItemId === x),
          ),
          results,
        });
        // Reserve links before any external call.
        const ids = chosen.map((e) => e.workItemId);
        const before = await externalLinks(tx, request.organizationId, {
          workItemIds: ids,
        });
        await tx
          .insert(s.workItemExternalLink)
          .values(
            ids.map((workItemId) => ({
              organizationId: request.organizationId,
              workItemId,
              connectionId: rows.connection!.id,
            })),
          )
          .onConflictDoNothing();
        await tx
          .update(s.workItemExternalLink)
          .set({ status: "pending", lastError: null })
          .where(
            and(
              eq(s.workItemExternalLink.organizationId, request.organizationId),
              eq(s.workItemExternalLink.connectionId, rows.connection.id),
              inArray(s.workItemExternalLink.workItemId, ids),
            ),
          );
        const after = await externalLinks(tx, request.organizationId, {
          workItemIds: ids,
        });
        await publish(
          tx,
          request.organizationId,
          await emitChanges(
            tx,
            request.organizationId,
            before,
            after,
            await clock(tx, request.organizationId),
          ),
        );
        return id;
      });
      return this.process(publicationId);
    },

    // Link an item to an issue that already exists externally. Nothing is
    // written externally until the item is exported with overwrite confirmed.
    async linkExisting(
      userId: string,
      input: {
        organizationId: string;
        workItemId: string;
        externalKey: string;
      },
    ) {
      const { organizationId } = input;
      const prepared = await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requirePublisher(
          (await access(tx, userId, organizationId)).capabilities,
        );
        const item = await itemRow(tx, organizationId, input.workItemId);
        const target = (
          await tx
            .select()
            .from(s.deliveryTarget)
            .where(eq(s.deliveryTarget.organizationId, organizationId))
        )
          .sort(
            (a, b) =>
              Number(b.teamId === item.teamId) -
              Number(a.teamId === item.teamId),
          )
          .find((t) => t.teamId === item.teamId || t.teamId === null);
        if (!target)
          throw new DomainError(
            "validation",
            "Connect Jira and choose a project in delivery settings first.",
          );
        return {
          item,
          row: await connectionRow(tx, organizationId, target.connectionId),
        };
      });
      const { provider, connection } = open(prepared.row);
      const external = await provider.getItem(
        connection,
        input.externalKey.trim().toUpperCase(),
      );
      if (!external)
        throw new DomainError(
          "unavailable",
          `Jira issue ${input.externalKey} does not exist or is not visible to ${prepared.row.accountLabel}.`,
        );
      if (external.lictoryItemId && external.lictoryItemId !== input.workItemId)
        throw new DomainError(
          "conflict",
          `${external.key} was exported from another Lictory item.`,
        );
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requirePublisher(
          (await access(tx, userId, organizationId)).capabilities,
        );
        const taken = (
          await tx
            .select()
            .from(s.workItemExternalLink)
            .where(
              and(
                eq(s.workItemExternalLink.organizationId, organizationId),
                eq(s.workItemExternalLink.connectionId, prepared.row.id),
                or(
                  eq(s.workItemExternalLink.externalId, external.id),
                  eq(s.workItemExternalLink.workItemId, input.workItemId),
                ),
              ),
            )
        )[0];
        if (
          taken?.externalId === external.id &&
          taken.workItemId !== input.workItemId
        )
          throw new DomainError(
            "conflict",
            `${external.key} is already linked to another item.`,
          );
        if (taken?.workItemId === input.workItemId && taken.externalId)
          throw new DomainError(
            "conflict",
            `This item is already linked to ${taken.externalKey}. Unlink it first.`,
          );
        const before = await externalLinks(tx, organizationId, {
          workItemIds: [input.workItemId],
        });
        const values = {
          externalId: external.id,
          externalKey: external.key,
          externalUrl: external.url,
          externalStatus: external.status,
          status: "synced" as const,
          syncedAt: now(),
          // Never exported: the first export must be confirmed.
          payloadHash: null,
          publishedRevisionId: null,
          externalUpdatedAt: null,
          lastError: null,
        };
        if (taken)
          await tx
            .update(s.workItemExternalLink)
            .set(values)
            .where(eq(s.workItemExternalLink.id, taken.id));
        else
          await tx.insert(s.workItemExternalLink).values({
            organizationId,
            workItemId: input.workItemId,
            connectionId: prepared.row.id,
            ...values,
          });
        const activity = await recordActivity(
          tx,
          prepared.item,
          userId,
          "external_linked",
          {
            provider: prepared.row.provider,
            key: external.key,
            url: external.url,
          },
        );
        const after = await externalLinks(tx, organizationId, {
          workItemIds: [input.workItemId],
        });
        await publish(
          tx,
          organizationId,
          await emitChanges(
            tx,
            organizationId,
            before,
            [...after, activity],
            await clock(tx, organizationId),
            {
              projectId: prepared.item.projectId,
              workItemId: prepared.item.id,
            },
          ),
        );
        return after[0]!;
      });
    },

    // Removes the link; the external issue is left untouched. Publication
    // results and activity keep the history.
    async unlink(
      userId: string,
      input: {
        organizationId: string;
        workItemId: string;
        connectionId: string;
      },
    ) {
      const { organizationId } = input;
      await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requirePublisher(
          (await access(tx, userId, organizationId)).capabilities,
        );
        const item = await itemRow(tx, organizationId, input.workItemId);
        const before = await externalLinks(tx, organizationId, {
          workItemIds: [item.id],
        });
        const link = before.find((l) => l.connectionId === input.connectionId);
        if (!link) return;
        if (link.status === "pending")
          throw new DomainError(
            "conflict",
            "An export of this item is in progress. Try again when it finishes.",
          );
        await tx
          .delete(s.workItemExternalLink)
          .where(
            and(
              eq(s.workItemExternalLink.organizationId, organizationId),
              eq(s.workItemExternalLink.id, link.id),
            ),
          );
        const activity = await recordActivity(
          tx,
          item,
          userId,
          "external_unlinked",
          {
            key: link.externalKey,
            url: link.externalUrl,
          },
        );
        const after = await externalLinks(tx, organizationId, {
          workItemIds: [item.id],
        });
        await publish(
          tx,
          organizationId,
          await emitChanges(
            tx,
            organizationId,
            before,
            [...after, activity],
            await clock(tx, organizationId),
            {
              projectId: item.projectId,
              workItemId: item.id,
            },
          ),
        );
      });
    },

    async publication(
      userId: string,
      organizationId: string,
      publicationId: string,
    ) {
      return db.transaction(async (tx) => {
        await authorize(tx, userId, organizationId);
        const row = (
          await tx
            .select()
            .from(s.deliveryPublication)
            .where(
              and(
                eq(s.deliveryPublication.organizationId, organizationId),
                eq(s.deliveryPublication.id, publicationId),
              ),
            )
        )[0];
        if (!row)
          throw new DomainError("unavailable", "The export is unavailable.");
        return row;
      });
    },

    // --------------------------------------------------------------- worker

    // Advances one publication. Safe to call concurrently and repeatedly:
    // a lease keeps one runner, finished items are never redone.
    async process(publicationId: string) {
      const claimed = (
        await db
          .update(s.deliveryPublication)
          .set({ leaseUntil: new Date(now().getTime() + LEASE_MS) })
          .where(
            and(
              eq(s.deliveryPublication.id, publicationId),
              eq(s.deliveryPublication.status, "running"),
              or(
                isNull(s.deliveryPublication.leaseUntil),
                lt(s.deliveryPublication.leaseUntil, now()),
              ),
            ),
          )
          .returning()
      )[0];
      if (!claimed) return current(publicationId);
      const row = await connectionRow(
        db,
        claimed.organizationId,
        claimed.connectionId,
      ).catch(() => null);
      const results = { ...claimed.results };
      for (const itemId of claimed.itemIds) {
        if (results[itemId]?.outcome !== "pending") continue;
        if (!row) {
          const result = {
            outcome: "failed" as const,
            message:
              "The Jira connection was removed. Reconnect it and export again.",
          };
          await finishItem(claimed, itemId, result, null);
          results[itemId] = result;
          continue;
        }
        const result = await exportItem(claimed, row, itemId, results);
        if (result) results[itemId] = result;
      }
      const done = claimed.itemIds.every(
        (id) => results[id]?.outcome !== "pending",
      );
      const ok = claimed.itemIds.filter((id) =>
        succeeded(results[id]!.outcome),
      ).length;
      const status =
        ok === claimed.itemIds.length
          ? ("completed" as const)
          : ok === 0
            ? ("failed" as const)
            : ("partial" as const);
      await db.transaction(async (tx) => {
        const [finished] = await tx
          .update(s.deliveryPublication)
          .set({
            leaseUntil: null,
            ...(done ? { status, finishedAt: now() } : {}),
          })
          .where(
            and(
              eq(s.deliveryPublication.id, publicationId),
              eq(s.deliveryPublication.status, "running"),
            ),
          )
          .returning();
        // The requester hears once, when the run settles.
        if (done && finished) await notifyExport(tx, finished, status);
      });
      return current(publicationId);
    },

    // Resumes publications left running (deferred create confirmations,
    // crashed workers). Called by the scheduled job.
    async processPending() {
      const rows = await db
        .select({ id: s.deliveryPublication.id })
        .from(s.deliveryPublication)
        .where(
          and(
            eq(s.deliveryPublication.status, "running"),
            or(
              isNull(s.deliveryPublication.leaseUntil),
              lt(s.deliveryPublication.leaseUntil, now()),
            ),
          ),
        )
        .limit(50);
      for (const { id } of rows) await this.process(id);
      return { publications: rows.length };
    },
  };

  async function current(publicationId: string) {
    return (
      await db
        .select()
        .from(s.deliveryPublication)
        .where(eq(s.deliveryPublication.id, publicationId))
    )[0]!;
  }

  // Exports one item. Returns its final result, or undefined when it must be
  // retried later (a create attempt that cannot be confirmed yet).
  async function exportItem(
    publication: Publication,
    row: ConnectionRow,
    itemId: string,
    results: Publication["results"],
  ): Promise<ItemResult | undefined> {
    const { organizationId } = publication;
    // Re-plan under the lock with the original request shape: readiness,
    // mapping and content may have changed since the export was requested.
    const state = await db.transaction(async (tx) => {
      await lock(tx, organizationId);
      const request = publication.rootItemId
        ? { organizationId, rootId: publication.rootItemId }
        : { organizationId, itemIds: [itemId] };
      let planned: Awaited<ReturnType<typeof plan>> | DomainError;
      try {
        planned = await plan(tx, request);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        planned = error;
      }
      const linkFor = async (workItemId: string) =>
        (
          await tx
            .select()
            .from(s.workItemExternalLink)
            .where(
              and(
                eq(s.workItemExternalLink.organizationId, organizationId),
                eq(s.workItemExternalLink.connectionId, row.id),
                eq(s.workItemExternalLink.workItemId, workItemId),
              ),
            )
        )[0];
      const item = await itemRow(tx, organizationId, itemId);
      return {
        planned,
        item,
        link: await linkFor(itemId),
        parentLink: item.parentId ? await linkFor(item.parentId) : undefined,
      };
    });
    const settle = async (
      result: ItemResult,
      written: Written | null = null,
    ) => {
      await finishItem(publication, itemId, result, written);
      return result;
    };
    if (state.planned instanceof DomainError)
      return settle({ outcome: "skipped", message: state.planned.message });
    const entry = state.planned.entries.find((e) => e.workItemId === itemId);
    const key = entry?.key ?? "This item";
    if (!entry || !exportable.has(entry.action))
      return settle({
        outcome: "skipped",
        message: `${key} was not exported: ${entry?.reason ?? "it is no longer part of this export."}`,
      });
    const parentResult = state.item.parentId
      ? results[state.item.parentId]
      : undefined;
    // A parent that already exists externally (e.g. held as a conflict)
    // still anchors its children; only a parent with no external issue
    // blocks them.
    if (
      parentResult &&
      !succeeded(parentResult.outcome) &&
      !state.parentLink?.externalId
    )
      return settle({
        outcome: "skipped",
        message: `${key} was not exported because its parent was not. Export it again after fixing the parent.`,
      });
    const base = state.planned.rows.payloads.get(itemId)!;
    const target = state.planned.rows.target(state.item.teamId)!;
    const destination = {
      projectId: target.externalProjectId,
      projectKey: target.externalProjectKey,
    };
    const payload: DeliveryPayload = {
      ...base,
      parent: parentRef(state.parentLink),
    };
    const payloadHash = hash(payload);
    const link = state.link;
    if (!link)
      return settle({
        outcome: "skipped",
        message: `${key} was unlinked while exporting.`,
      });
    const { provider, connection } = open(row);
    const overwrite = publication.overwriteItemIds.includes(itemId);
    const revisionNumber = payload.revisionNumber;
    let creating = false;
    try {
      if (link.externalId) {
        const ref = refOf(link);
        if (!overwrite && !link.externalUpdatedAt)
          return settle({
            outcome: "conflict",
            message: `${key} is linked to ${link.externalKey} but was never exported. Confirm overwriting ${link.externalKey} to export it.`,
          });
        if (link.payloadHash === payloadHash) {
          const external = await provider.getItem(connection, ref.id);
          if (!external)
            return settle({
              outcome: "failed",
              message: `${link.externalKey} no longer exists in Jira. Unlink it to export a new issue.`,
            });
          return settle(
            { outcome: "unchanged", externalKey: external.key, revisionNumber },
            { externalStatus: external.status },
          );
        }
        if (!overwrite && link.externalUpdatedAt) {
          const changed = await provider.changedSince(
            connection,
            ref,
            link.externalUpdatedAt,
          );
          if (changed.length)
            return settle({
              outcome: "conflict",
              message: `${link.externalKey} was changed in Jira since the last export (${changed.map(fieldName).join(", ")}). Review it and confirm overwriting.`,
            });
        }
        const external = await provider.updateItem(connection, ref, payload);
        return settle(
          { outcome: "updated", externalKey: external.key, revisionNumber },
          { ...identity(external), payloadHash, revisionNumber },
        );
      }
      // Create, recovering a previous unrecorded attempt first.
      let external = null;
      if (link.createAttemptedAt) {
        external = await provider.findCreated(connection, destination, {
          lictoryItemId: itemId,
          title: payload.title,
          since: new Date(link.createAttemptedAt.getTime() - 60_000),
        });
        if (
          !external &&
          now().getTime() - link.createAttemptedAt.getTime() < CREATE_CONFIRM_MS
        )
          return undefined;
        if (external)
          external = await provider.updateItem(connection, external, payload);
      }
      if (!external) {
        await db
          .update(s.workItemExternalLink)
          .set({ createAttemptedAt: now() })
          .where(eq(s.workItemExternalLink.id, link.id));
        creating = true;
        external = await provider.createItem(connection, destination, payload);
        creating = false;
      }
      // The back-reference is a convenience; it never fails the export.
      await provider
        .linkBack(connection, external, payload)
        .catch(() => undefined);
      return settle(
        { outcome: "created", externalKey: external.key, revisionNumber },
        { ...identity(external), payloadHash, revisionNumber },
      );
    } catch (error) {
      await markConnection(row, error);
      // A definitive rejection proves nothing was created; an outage or
      // timeout does not, so that attempt stays for recovery.
      if (creating && error instanceof DeliveryError && !error.retryable)
        await db
          .update(s.workItemExternalLink)
          .set({ createAttemptedAt: null })
          .where(eq(s.workItemExternalLink.id, link.id));
      if (!(error instanceof DeliveryError))
        console.error(
          JSON.stringify({
            event: "delivery.export.error",
            publicationId: publication.id,
            itemId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return settle({
        outcome: "failed",
        message:
          error instanceof DeliveryError
            ? `${key} was not exported. ${error.message}`
            : `${key} was not exported because of an unexpected error. Try again.`,
      });
    }
  }

  // Records one item's result, link state and activity atomically with the
  // change log.
  async function finishItem(
    publication: Publication,
    itemId: string,
    result: ItemResult,
    written: Written | null,
  ) {
    const { organizationId } = publication;
    await db.transaction(async (tx) => {
      await lock(tx, organizationId);
      const item = await itemRow(tx, organizationId, itemId);
      const before = await externalLinks(tx, organizationId, {
        workItemIds: [itemId],
      });
      const linkWhere = and(
        eq(s.workItemExternalLink.organizationId, organizationId),
        eq(s.workItemExternalLink.connectionId, publication.connectionId),
        eq(s.workItemExternalLink.workItemId, itemId),
      );
      const existing = (
        await tx.select().from(s.workItemExternalLink).where(linkWhere)
      )[0];
      if (existing && written) {
        const revisionId = written.revisionNumber
          ? (
              await tx
                .select({ id: s.specificationRevision.id })
                .from(s.specificationRevision)
                .where(
                  and(
                    eq(s.specificationRevision.organizationId, organizationId),
                    eq(s.specificationRevision.workItemId, itemId),
                    eq(s.specificationRevision.number, written.revisionNumber),
                  ),
                )
            )[0]?.id
          : undefined;
        await tx
          .update(s.workItemExternalLink)
          .set({
            ...(written.externalId
              ? {
                  externalId: written.externalId,
                  externalKey: written.externalKey,
                  externalUrl: written.externalUrl,
                  externalUpdatedAt: written.externalUpdatedAt,
                  payloadHash: written.payloadHash,
                  publishedRevisionId: revisionId ?? null,
                  createAttemptedAt: null,
                }
              : {}),
            externalStatus: written.externalStatus,
            status: "synced",
            lastError: null,
            syncedAt: now(),
          })
          .where(linkWhere);
      } else if (existing) {
        if (!existing.externalId && !existing.createAttemptedAt)
          // A reservation that never reached Jira leaves no trace.
          await tx.delete(s.workItemExternalLink).where(linkWhere);
        else
          await tx
            .update(s.workItemExternalLink)
            .set(
              result.outcome === "skipped" && existing.externalId
                ? { status: "synced", lastError: null }
                : {
                    status:
                      result.outcome === "conflict" ? "conflict" : "failed",
                    lastError: result.message ?? null,
                  },
            )
            .where(linkWhere);
      }
      await tx
        .update(s.deliveryPublication)
        .set({
          results: sql`${s.deliveryPublication.results} || ${JSON.stringify({ [itemId]: result })}::jsonb`,
        })
        .where(eq(s.deliveryPublication.id, publication.id));
      const extra: Entity[] = [];
      if (written?.externalId)
        extra.push(
          await recordActivity(
            tx,
            item,
            publication.requestedById,
            "exported",
            {
              provider: "jira_cloud",
              key: written.externalKey,
              url: written.externalUrl,
              outcome: result.outcome,
              revision: result.revisionNumber,
              publicationId: publication.id,
            },
          ),
        );
      const after = await externalLinks(tx, organizationId, {
        workItemIds: [itemId],
      });
      await publish(
        tx,
        organizationId,
        await emitChanges(
          tx,
          organizationId,
          before,
          [...after, ...extra],
          await clock(tx, organizationId),
          { projectId: item.projectId, workItemId: item.id },
        ),
      );
    });
  }
}

type Publication = typeof s.deliveryPublication.$inferSelect;
type ItemResult = Publication["results"][string];
type Written = {
  externalId?: string;
  externalKey?: string;
  externalUrl?: string;
  externalStatus?: string;
  externalUpdatedAt?: Date;
  payloadHash?: string;
  revisionNumber?: number;
};

const succeeded = (outcome: DeliveryItemOutcome) =>
  outcome === "created" || outcome === "updated" || outcome === "unchanged";

function identity(external: {
  id: string;
  key: string;
  url: string;
  status: string;
  updatedAt: Date;
}): Written {
  return {
    externalId: external.id,
    externalKey: external.key,
    externalUrl: external.url,
    externalStatus: external.status,
    externalUpdatedAt: external.updatedAt,
  };
}

type PlanRows = {
  projectId: string;
  connection: ConnectionRow | null;
  target: (teamId: string) => typeof s.deliveryTarget.$inferSelect | undefined;
  links: Map<string, LinkRow>;
  payloads: Map<string, Omit<DeliveryPayload, "parent">>;
  items: Map<string, ItemRow>;
};

function refOf(link: LinkRow): ExternalRef {
  return {
    id: link.externalId!,
    key: link.externalKey ?? link.externalId!,
    url: link.externalUrl ?? "",
  };
}

function parentRef(link: LinkRow | undefined): ExternalRef | null {
  return link?.externalId ? refOf(link) : null;
}

function fieldName(field: OwnedField) {
  return field === "title"
    ? "summary"
    : field === "content"
      ? "description"
      : "labels";
}

export function hash(payload: DeliveryPayload) {
  const { parent, ...rest } = payload;
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...rest,
        parent: parent?.id ?? null,
        labels: [...rest.labels].sort(),
      }),
    )
    .digest("hex");
}

async function itemRow(tx: Tx, organizationId: string, workItemId: string) {
  const row = (
    await tx
      .select()
      .from(s.workItem)
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          eq(s.workItem.id, workItemId),
        ),
      )
  )[0];
  if (!row) throw new DomainError("unavailable", "This item is unavailable.");
  return row;
}

async function organizationSlug(tx: Tx, organizationId: string) {
  return (
    await tx
      .select({ slug: s.organization.slug })
      .from(s.organization)
      .where(eq(s.organization.id, organizationId))
  )[0]!.slug;
}

async function latestRevisions(tx: Tx, organizationId: string, ids: string[]) {
  const map = new Map<string, { number: number; content: string }>();
  if (!ids.length) return map;
  const rows = await tx
    .selectDistinctOn([s.specificationRevision.workItemId], {
      workItemId: s.specificationRevision.workItemId,
      number: s.specificationRevision.number,
      content: s.specificationRevision.content,
    })
    .from(s.specificationRevision)
    .where(
      and(
        eq(s.specificationRevision.organizationId, organizationId),
        inArray(s.specificationRevision.workItemId, ids),
      ),
    )
    .orderBy(
      s.specificationRevision.workItemId,
      sql`${s.specificationRevision.number} desc`,
    );
  for (const r of rows) map.set(r.workItemId, r);
  return map;
}

async function labelNames(tx: Tx, organizationId: string, ids: string[]) {
  const map = new Map<string, string[]>();
  if (!ids.length) return map;
  const rows = await tx
    .select({ workItemId: s.workItemLabel.workItemId, name: s.label.name })
    .from(s.workItemLabel)
    .innerJoin(
      s.label,
      and(
        eq(s.label.organizationId, s.workItemLabel.organizationId),
        eq(s.label.id, s.workItemLabel.labelId),
      ),
    )
    .where(
      and(
        eq(s.workItemLabel.organizationId, organizationId),
        inArray(s.workItemLabel.workItemId, ids),
        isNull(s.label.archivedAt),
      ),
    )
    .orderBy(asc(s.label.name));
  for (const r of rows)
    map.set(r.workItemId, [...(map.get(r.workItemId) ?? []), r.name]);
  return map;
}

async function recordActivity(
  tx: Tx,
  item: ItemRow,
  actorId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<EntityOf<"activity">> {
  const row = (
    await tx
      .insert(s.activity)
      .values({
        id: crypto.randomUUID(),
        organizationId: item.organizationId,
        projectId: item.projectId,
        workItemId: item.id,
        actorId,
        action,
        detail,
      })
      .returning()
  )[0]!;
  return serialize("activity", row) as EntityOf<"activity">;
}
