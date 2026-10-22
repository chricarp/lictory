import { z } from "zod";
import { publicationProperties } from "@lictory/core/lib/analytics/publication";
import { createDeliveryService } from "@lictory/core/delivery/service";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  webOnly,
  type AnyCapability,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";

// Delivery actions talk to external systems: they are online-only and never
// enter the client mutation queue. Results reach other clients through the
// normal sync change log.

function service(ctx: CapabilityContext) {
  return createDeliveryService(ctx.db, {
    providers: ctx.deliveryProviders,
    onPublicationCompleted: (publication) =>
      ctx.effects.publicationCompleted?.(publication),
  });
}
function track(
  ctx: CapabilityContext,
  event: string,
  properties: Record<string, string | number | boolean | null | string[]>,
) {
  ctx.effects.track(event, {
    provider: "jira",
    ...properties,
    ...(ctx.principal.surface === "web"
      ? {}
      : { surface: ctx.principal.surface }),
  });
}

const exportScope = {
  organizationId,
  rootId: id
    .optional()
    .describe("Export this item and its subtree (usually a ready Epic)."),
  itemIds: z
    .array(id)
    .max(500)
    .optional()
    .describe("Or export exactly these items."),
};

// Credentials are entered by an integration manager in the browser only: an API
// token must never pass through an agent's transcript.
const connectDelivery = defineCapability({
  name: "connectDelivery",
  title: "Connect Jira",
  description:
    "Organization administrators: connect a Jira site with an API token. Projects then choose a Jira project on this connection to hand work off to.",
  kind: "command",
  surfaces: webOnly,
  external: true,
  input: z.object({
    organizationId,
    name: z.string().max(120).default(""),
    baseUrl: z.string().min(1).max(300),
    email: z.string().trim().min(1).max(320),
    apiToken: z.string().trim().min(1).max(2000),
  }),
  async run(ctx, input) {
    const result = await service(ctx).connect(ctx.principal.userId, input);
    track(ctx, "delivery_connection_created", {
      organization_id: input.organizationId,
    });
    return result;
  },
});

const disconnectDelivery = defineCapability({
  name: "disconnectDelivery",
  title: "Disconnect delivery tool",
  description:
    "Organization administrators: remove a Jira connection. Projects using it lose their hand-off target; existing links keep their history.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  input: z.object({ organizationId, connectionId: id }),
  async run(ctx, input) {
    await service(ctx).disconnect(
      ctx.principal.userId,
      input.organizationId,
      input.connectionId,
    );
    track(ctx, "delivery_connection_removed", {
      organization_id: input.organizationId,
    });
    return { ok: true };
  },
});

const listDeliveryProjects = defineCapability({
  name: "listDeliveryProjects",
  title: "List Jira projects",
  description:
    "Jira projects visible through a connection. Organization administrators, or with `projectId`, that project's administrators and the people who can hand its work off.",
  kind: "query",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    connectionId: id,
    query: z.string().max(120).optional(),
    projectId: id.optional(),
  }),
  run: (ctx, input) =>
    service(ctx).listProjects(
      ctx.principal.userId,
      input.organizationId,
      input.connectionId,
      input.query,
      input.projectId,
    ),
});

const describeDeliveryProject = defineCapability({
  name: "describeDeliveryProject",
  title: "Describe Jira project",
  description:
    "Issue types of an external project, for mapping work item types.",
  kind: "query",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    connectionId: id,
    projectKey: z.string().min(1).max(64),
    projectId: id.optional(),
  }),
  run: (ctx, input) =>
    service(ctx).describeProject(
      ctx.principal.userId,
      input.organizationId,
      input.connectionId,
      input.projectKey,
      input.projectId,
    ),
});

const setDeliveryTarget = defineCapability({
  name: "setDeliveryTarget",
  title: "Set delivery target",
  description:
    "Project administrators: choose the Jira project (on an organization connection) this project hands work off to, and map work item type ids to Jira issue types.",
  kind: "command",
  surfaces: everywhere,
  external: true,
  idempotent: true,
  input: z.object({
    organizationId,
    connectionId: id,
    projectId: id,
    projectKey: z.string().min(1).max(64),
    typeMapping: z.record(id, z.string().min(1).max(64)),
  }),
  async run(ctx, input) {
    const result = await service(ctx).setTarget(ctx.principal.userId, input);
    track(ctx, "delivery_target_configured", {
      organization_id: input.organizationId,
      project_id: input.projectId,
    });
    return result ?? { ok: true };
  },
});

const removeDeliveryTarget = defineCapability({
  name: "removeDeliveryTarget",
  title: "Remove delivery target",
  description:
    "Project administrators: stop handing this project's work off to its Jira project. Existing links keep their history.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  input: z.object({ organizationId, projectId: id }),
  async run(ctx, input) {
    await service(ctx).removeTarget(
      ctx.principal.userId,
      input.organizationId,
      input.projectId,
    );
    track(ctx, "delivery_target_removed", {
      organization_id: input.organizationId,
      project_id: input.projectId,
    });
    return { ok: true };
  },
});

const previewDeliveryExport = defineCapability({
  name: "previewDeliveryExport",
  title: "Preview export",
  description:
    "What exporting would do for each item (create, update, unchanged, or why it is skipped), including external edits that need overwrite confirmation. Changes nothing.",
  kind: "query",
  surfaces: everywhere,
  external: true,
  input: z.object(exportScope),
  async run(ctx, input) {
    const result = await service(ctx).preview(ctx.principal.userId, input);
    track(ctx, "delivery_publish_previewed", {
      organization_id: input.organizationId,
    });
    return result;
  },
});

const publishDelivery = defineCapability({
  name: "publishDelivery",
  decision: true,
  title: "Export to delivery tool",
  description:
    "Hand ready work off to the project's Jira project: create or update issues. Only for projects delivered in Jira, and only when the person explicitly asked to export. Requires the hand-off capability in the project. Returns per-item results; failed items can be exported again on their own. Items edited externally are only overwritten when listed in overwriteItemIds.",
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({
    ...exportScope,
    overwriteItemIds: z.array(id).max(500).optional(),
  }),
  async run(ctx, input) {
    const result = await service(ctx).publish(ctx.principal.userId, input);
    track(ctx, "delivery_publish_requested", {
      organization_id: input.organizationId,
      ...publicationProperties(result),
    });
    return result;
  },
});

const refreshDeliveryStatus = defineCapability({
  name: "refreshDeliveryStatus",
  title: "Refresh Jira status",
  description:
    "Read the current Jira status, status category and assignee of every issue a project handed off. Read-only in Jira and in Lictory's own fields.",
  kind: "command",
  surfaces: everywhere,
  external: true,
  idempotent: true,
  input: z.object({ organizationId, projectId: id }),
  async run(ctx, input) {
    const result = await service(ctx).refreshProject(
      ctx.principal.userId,
      input.organizationId,
      input.projectId,
    );
    track(ctx, "delivery_status_refreshed", {
      organization_id: input.organizationId,
      project_id: input.projectId,
      refreshed: result.refreshed,
    });
    return result;
  },
});

const getDeliveryPublication = defineCapability({
  name: "getDeliveryPublication",
  title: "Get export result",
  description: "Status and per-item results of an export.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, publicationId: id }),
  run: (ctx, input) =>
    service(ctx).publication(
      ctx.principal.userId,
      input.organizationId,
      input.publicationId,
    ),
});

const linkExternalItem = defineCapability({
  name: "linkExternalItem",
  title: "Link existing issue",
  description:
    "Link a work item to an existing external issue by key (e.g. PAY-12 in Jira). Nothing is written externally until the item is exported with overwrite confirmed.",
  kind: "command",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    workItemId: id,
    externalKey: z.string().trim().min(1).max(64),
  }),
  async run(ctx, input) {
    const result = await service(ctx).linkExisting(ctx.principal.userId, input);
    track(ctx, "delivery_item_linked", {
      organization_id: input.organizationId,
      work_item_id: input.workItemId,
    });
    return result ?? { ok: true };
  },
});

const unlinkExternalItem = defineCapability({
  name: "unlinkExternalItem",
  title: "Unlink external issue",
  description:
    "Remove the link between a work item and its external issue. The external issue is not deleted.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  input: z.object({ organizationId, workItemId: id, connectionId: id }),
  async run(ctx, input) {
    await service(ctx).unlink(ctx.principal.userId, input);
    track(ctx, "delivery_item_unlinked", {
      organization_id: input.organizationId,
      work_item_id: input.workItemId,
    });
    return { ok: true };
  },
});

export const deliveryCapabilities = [
  connectDelivery,
  disconnectDelivery,
  listDeliveryProjects,
  describeDeliveryProject,
  setDeliveryTarget,
  removeDeliveryTarget,
  previewDeliveryExport,
  publishDelivery,
  refreshDeliveryStatus,
  getDeliveryPublication,
  linkExternalItem,
  unlinkExternalItem,
] as AnyCapability[];
