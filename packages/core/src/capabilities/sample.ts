import { z } from "zod";
import {
  archiveSampleProject,
  createSampleProject,
} from "@lictory/core/domain/sample-project";
import type { Actor } from "@lictory/core/domain/service";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  type AnyCapability,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";

// The sample project (docs/internals/onboarding.md#sample-project). Its
// commands run as one transaction of ordinary domain commands. Analytics
// record the sample as one event rather than the commands inside it, so
// sample content never counts as the person's own activity.

const actorOf = (ctx: CapabilityContext): Actor => ({
  userId: ctx.principal.userId,
  surface: ctx.principal.surface,
  client: ctx.principal.client,
  agentId: ctx.principal.tokenId ?? null,
  agentName: ctx.principal.agentName ?? null,
});

const create = defineCapability({
  name: "createSampleProject",
  title: "Create the sample project",
  description:
    "Organization administrators: create Lictory's sample project, a clearly labelled project for exploring the review workflow without colleagues. It holds one specification with three revisions, an open blocking discussion anchored to its text, a recorded decision, a requested review, a pull request awaiting review and a Space page that references the item. The person asking is the author of everything; no other people are added and nothing is approved. `fromProjectId` copies that project's delivery mode and readiness policy. An organization has at most one sample project: a second request is refused, and an archived sample is restored instead (archiveProject). Remove it with archiveSampleProject.",
  kind: "command",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    fromProjectId: id
      .optional()
      .describe("Project whose delivery choices the sample follows."),
  }),
  async run(ctx, input) {
    const sample = await ctx.db.transaction((tx) =>
      createSampleProject(tx, actorOf(ctx), input),
    );
    ctx.effects.track("sample_project_created", {
      organization_id: input.organizationId,
      project_id: sample.projectId,
      delivery_mode: sample.deliveryMode,
      ...(ctx.principal.surface === "web"
        ? {}
        : { surface: ctx.principal.surface }),
    });
    return sample;
  },
});

const archive = defineCapability({
  name: "archiveSampleProject",
  title: "Archive the sample project",
  description:
    "Organization administrators: archive the sample project and the spaces homed in it. History is kept; restore them with archiveProject and archiveSpace.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  input: z.object({ organizationId }),
  async run(ctx, input) {
    const result = await ctx.db.transaction((tx) =>
      archiveSampleProject(tx, actorOf(ctx), input),
    );
    ctx.effects.track("sample_project_archived", {
      organization_id: input.organizationId,
      project_id: result.projectId,
    });
    return result;
  },
});

export const sampleCapabilities = [create, archive] as AnyCapability[];
