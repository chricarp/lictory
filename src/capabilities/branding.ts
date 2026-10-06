import { z } from "zod";
import { logoKinds, MAX_LOGO_SIZE } from "../branding/logo";
import { removeLogo, setLogo } from "../branding/server";
import {
  defineCapability,
  everywhere,
  organizationId,
  type AnyCapability,
} from "./core";

const kind = z
  .enum(logoKinds)
  .describe("`mark` is the square logomark; `full` the wide logo.");

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
  description: "Administrators: remove a logo; the initial is shown instead.",
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  idempotent: true,
  input: z.object({ organizationId, kind }),
  async run(ctx, input) {
    await removeLogo(
      ctx.db,
      input.organizationId,
      ctx.principal.userId,
      input.kind,
    );
    return { removed: true };
  },
});

export const brandingCapabilities = [
  setOrganizationLogo,
  removeOrganizationLogo,
] as AnyCapability[];
