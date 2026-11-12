import { z } from "zod";
import { logoKinds, MAX_LOGO_SIZE } from "@lictory/core/branding/logo";
import {
  removeLogo,
  setBrandColor,
  setLogo,
} from "@lictory/core/branding/server";
import {
  defineCapability,
  everywhere,
  organizationId,
  type AnyCapability,
} from "@lictory/core/capabilities/core";

const kind = z
  .enum(logoKinds)
  .describe(
    "`mark` is the square logomark; `full` the wide logo; `icon` the browser tab icon.",
  );

const setOrganizationLogo = defineCapability({
  name: "setOrganizationLogo",
  title: "Set organization logo",
  description:
    "Administrators: upload a PNG, JPEG or WebP logo (at most 512 KB).",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({
    organizationId,
    kind,
    contentBase64: z
      .string()
      .max(Math.ceil((MAX_LOGO_SIZE * 4) / 3) + 4)
      .describe("The image bytes, base64-encoded."),
  }),
  run: (ctx, input) =>
    setLogo(
      ctx.db,
      input.organizationId,
      ctx.principal.userId,
      input.kind,
      Uint8Array.from(Buffer.from(input.contentBase64, "base64")),
    ),
});

const removeOrganizationLogo = defineCapability({
  name: "removeOrganizationLogo",
  title: "Remove organization logo",
  description:
    "Administrators: remove a logo. Without a logomark the initial is shown, without a full logo the name, and without a browser icon the logomark or Lictory's icon.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  idempotent: true,
  input: z.object({ organizationId, kind }),
  async run(ctx, input) {
    return removeLogo(
      ctx.db,
      input.organizationId,
      ctx.principal.userId,
      input.kind,
    );
  },
});

const setOrganizationBrandColor = defineCapability({
  name: "setOrganizationBrandColor",
  title: "Set organization brand color",
  description:
    "Administrators: set the color that tints primary actions and accents for everyone in the organization, and the button and links of its email. Pass null to return to Lictory's colors. The interface adjusts the shade where needed to keep text readable.",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({
    organizationId,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .describe("Six hexadecimal digits, for example #1d4ed8, or null."),
  }),
  run: (ctx, input) =>
    setBrandColor(
      ctx.db,
      input.organizationId,
      ctx.principal.userId,
      input.color,
    ),
});

export const brandingCapabilities = [
  setOrganizationLogo,
  removeOrganizationLogo,
  setOrganizationBrandColor,
] as AnyCapability[];
