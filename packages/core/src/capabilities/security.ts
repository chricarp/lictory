import { z } from "zod";
import {
  defineCapability,
  id,
  organizationId,
  webOnly,
  type AnyCapability,
  type HumanOnly,
} from "@lictory/core/capabilities/core";
import {
  getOrganizationSecurity as readSecurity,
  resetMemberTwoFactor as resetTwoFactor,
  setTwoFactorRequirement as setRequirement,
} from "@lictory/core/domain/two-factor-policy";

// Organization sign-in requirements and second-factor recovery. People
// decide these in the browser: an agent must not weaken a sign-in
// requirement or remove someone's second factor.
const humanOnly: HumanOnly = {
  reason: "membership",
  where: "Organization settings → Security",
};

const getOrganizationSecurity = defineCapability({
  name: "getOrganizationSecurity",
  title: "Get organization security",
  description:
    "Administrators: whether members must use two-factor authentication, and which members have it.",
  kind: "query",
  surfaces: webOnly,
  humanOnly,
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    readSecurity(ctx.db, ctx.principal.userId, input.organizationId),
});

const setTwoFactorRequirement = defineCapability({
  name: "setTwoFactorRequirement",
  title: "Require two-factor authentication",
  description:
    "Administrators: require (or stop requiring) two-factor authentication for every member. Requiring it needs your own two-factor first.",
  kind: "command",
  surfaces: webOnly,
  humanOnly,
  idempotent: true,
  input: z.object({ organizationId, required: z.boolean() }),
  async run(ctx, input) {
    const result = await setRequirement(
      ctx.db,
      ctx.principal.userId,
      input.organizationId,
      input.required,
    );
    if (result.changed)
      ctx.effects.track("two_factor_requirement_changed", {
        organization_id: input.organizationId,
        required: input.required,
      });
    return result;
  },
});

const resetMemberTwoFactor = defineCapability({
  name: "resetMemberTwoFactor",
  title: "Reset a member's two-factor authentication",
  description:
    "Administrators: remove a member's authenticator app and backup codes after they lost access to both. Recorded in the organization's audit history.",
  kind: "command",
  surfaces: webOnly,
  humanOnly,
  destructive: true,
  input: z.object({ organizationId, userId: id }),
  async run(ctx, input) {
    const result = await resetTwoFactor(
      ctx.db,
      ctx.principal.userId,
      input.organizationId,
      input.userId,
    );
    ctx.effects.track("member_two_factor_reset", {
      organization_id: input.organizationId,
    });
    return result;
  },
});

export const securityCapabilities = [
  getOrganizationSecurity,
  setTwoFactorRequirement,
  resetMemberTwoFactor,
] as AnyCapability[];
