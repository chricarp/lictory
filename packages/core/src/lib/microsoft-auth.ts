import type { BetterAuthOptions } from "better-auth";
import { getOAuthState } from "better-auth/api";

// Entra email is tenant-managed profile data, not proof of mailbox ownership.
// First sign-in verifies it through Lictory. Returning sign-ins use Better
// Auth's stable provider account key and retain the local verification state.
export const microsoftEmailPolicy = {
  requireEmailVerification: true,
  mapProfileToUser: () => ({ emailVerified: false }),
};

type ValidateUserInfo = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]
>;

export const validateMicrosoftAccountLink: ValidateUserInfo = async (
  { user, source },
  context,
) => {
  if (
    source.oauth?.providerId !== "microsoft" ||
    source.action !== "link-account"
  )
    return;

  // Better Auth owns `link` in validated OAuth state; client additionalData
  // cannot replace it. The session check also supports explicit ID-token links.
  const link = (await getOAuthState())?.link;
  if (
    user.id &&
    (link?.userId === user.id || context.context.session?.user.id === user.id)
  )
    return;

  return { error: "account_not_linked" };
};
