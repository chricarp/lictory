import { passkeyClient } from "@better-auth/passkey/client";
import {
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // The sign-in form handles `twoFactorRedirect` itself (no page redirect).
  plugins: [organizationClient(), twoFactorClient(), passkeyClient()],
});
