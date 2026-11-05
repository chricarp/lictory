import { z } from "zod";
import {
  CapabilityError,
  defineCapability,
  everywhere,
  humanOnlyReasons,
  type AnyCapability,
  type HumanOnly,
} from "@lictory/core/capabilities/core";

// What stays with the person in the browser, as product policy.
//
// Nearly everything a person can do in Lictory is a capability available to
// the web, MCP and Litto alike. The exceptions are of two kinds:
//
// - capabilities restricted to the web surface, which declare `humanOnly`
//   (enforced when the registry loads), and
// - browser operations that are not capabilities at all: Better Auth account
//   and membership flows and a few browser routes, listed below.
//
// Agents read the combined list through listHumanOnlyOperations, so they can
// say "this needs you in the browser" instead of searching for a tool. A
// static check (apps/api/src/surface-coverage.test.ts) keeps this list honest:
// every Better Auth call the browser makes and every API route must be a
// capability, an operation below, or a transport route.

export type BrowserOperation = HumanOnly & {
  name: string;
  title: string;
  // Better Auth client methods the browser calls for it (`organization.create`).
  authClient?: readonly string[];
  // API routes outside the capability registry (`POST /api/handle`).
  routes?: readonly string[];
};

export const browserOperations: readonly BrowserOperation[] = [
  {
    name: "signIn",
    title: "Sign in, sign up or sign out",
    reason: "account",
    where: "The sign-in page",
    authClient: [
      "signIn.email",
      "signIn.social",
      "signIn.passkey",
      "signUp.email",
      "signOut",
      "twoFactor.verifyTotp",
      "twoFactor.verifyBackupCode",
    ],
    routes: ["GET /api/session"],
  },
  {
    name: "manageTwoFactor",
    title: "Turn two-factor authentication on or off, or replace backup codes",
    reason: "account",
    where: "Account settings → Sign-in & security → Two-factor authentication",
    authClient: [
      "twoFactor.enable",
      "twoFactor.disable",
      "twoFactor.generateBackupCodes",
    ],
  },
  {
    name: "managePasskeys",
    title: "Add or remove passkeys",
    reason: "account",
    where: "Account settings → Sign-in & security → Passkeys",
    authClient: [
      "passkey.listUserPasskeys",
      "passkey.addPasskey",
      "passkey.deletePasskey",
    ],
  },
  {
    name: "verifyEmail",
    title: "Verify an email address",
    reason: "account",
    where: "The verification link sent by email",
    authClient: ["sendVerificationEmail"],
  },
  {
    name: "changePassword",
    title: "Set, change or reset a password",
    reason: "account",
    where:
      "Account settings → Sign-in & security → Password, or “Forgot password” on the sign-in page",
    authClient: ["changePassword", "requestPasswordReset", "resetPassword"],
  },
  {
    name: "changeEmail",
    title: "Change the account email",
    reason: "account",
    where: "Account settings → Identity → Email",
    authClient: ["changeEmail"],
  },
  {
    name: "manageConnectedAccounts",
    title: "Connect or disconnect a sign-in provider",
    reason: "account",
    where: "Account settings → Sign-in & security → Connected accounts",
    authClient: ["linkSocial", "unlinkAccount"],
  },
  {
    name: "manageSessions",
    title: "Review or sign out other sessions",
    reason: "account",
    where: "Account settings → Sign-in & security → Sessions",
    authClient: ["getSession", "revokeOtherSessions"],
    routes: ["GET /api/account"],
  },
  {
    name: "deleteAccount",
    title: "Delete the account",
    reason: "account",
    where: "Account settings → Danger zone",
    authClient: ["deleteUser"],
  },
  {
    name: "updateProfile",
    title: "Change name or profile photo",
    reason: "account",
    where: "Account settings → Identity → Profile",
    authClient: ["updateUser"],
    routes: ["PUT /api/profile/photo", "DELETE /api/profile/photo"],
  },
  {
    name: "chooseHandle",
    title: "Choose a username (handle)",
    reason: "account",
    where: "Account settings → Identity → Handle",
    routes: ["GET /api/handle", "POST /api/handle"],
  },
  {
    name: "createOrganization",
    title: "Create an organization",
    reason: "membership",
    where:
      "Onboarding, when the installation lets this person create organizations; otherwise an instance administrator creates it in the admin console",
    authClient: ["organization.create", "organization.checkSlug"],
  },
  {
    name: "administerInstance",
    title:
      "Manage the installation: accounts, instance administrators and organizations",
    reason: "administration",
    where: "The admin console (/admin), for instance administrators",
    routes: [
      "GET /api/admin/overview",
      "GET /api/admin/users",
      "POST /api/admin/users",
      "POST /api/admin/users/:id/administrator",
      "POST /api/admin/users/:id/deactivation",
      "POST /api/admin/users/:id/password",
      "POST /api/admin/users/:id/password-reset",
      "GET /api/admin/organizations",
      "POST /api/admin/organizations",
      "POST /api/admin/organizations/:id/members",
      "GET /api/admin/activity",
    ],
  },
  {
    name: "updateOrganization",
    title: "Rename an organization or change its handle",
    reason: "membership",
    where: "Organization settings → General",
    authClient: ["organization.update"],
  },
  {
    name: "inviteMember",
    title: "Invite people or cancel invitations",
    reason: "membership",
    where: "Organization settings → Members",
    authClient: ["organization.cancelInvitation"],
    routes: ["POST /api/invitations", "GET /api/invitations"],
  },
  {
    name: "acceptInvitation",
    title: "Accept an invitation",
    reason: "membership",
    where: "The invitation link, or onboarding",
    authClient: [
      "organization.getInvitation",
      "organization.listUserInvitations",
      "organization.acceptInvitation",
      "organization.getFullOrganization",
    ],
    routes: ["GET /api/invitations/:id/placement"],
  },
  {
    name: "changeApplicationRole",
    title: "Make someone an organization administrator or member",
    reason: "membership",
    where: "Organization settings → Members",
    alternative:
      "setProjectMember and setDisciplineMember change project roles and disciplines.",
    authClient: ["organization.updateMemberRole"],
  },
  {
    name: "exportAuditLog",
    title: "Export the audit log as CSV",
    reason: "audit",
    where: "Organization settings → Audit log → Export CSV",
    routes: ["GET /api/organizations/:id/audit-log.csv"],
  },
  {
    name: "downloadOrganizationExport",
    title: "Download an organization data export",
    reason: "export",
    where: "Organization settings → Data export",
    routes: ["GET /api/organizations/:id/exports/:exportId/archive"],
  },
  {
    name: "manageLittoChats",
    title: "Chat with Litto, or rename, stop or delete Litto conversations",
    reason: "conversation",
    where: "The Litto panel",
    routes: [
      "POST /api/intelligence/chat",
      "GET /api/intelligence/chats",
      "GET /api/intelligence/chats/:id",
      "POST /api/intelligence/chats/:id/stop",
      "PATCH /api/intelligence/chats/:id",
      "DELETE /api/intelligence/chats/:id",
      "POST /api/intelligence/transcription",
    ],
  },
  {
    name: "setAppearance",
    title: "Change appearance or theme",
    reason: "browser",
    where: "Account settings → Preferences → Appearance",
    routes: ["POST /api/appearance"],
  },
  {
    name: "reportPresence",
    title: "Show who is viewing a work item",
    reason: "browser",
    where: "Sent automatically by an open browser tab",
    routes: ["POST /api/presence"],
  },
];

// Routes that are not operations a person performs: infrastructure, protocol
// transports whose operations are capabilities, and served images. Only the
// coverage check reads this.
export const transportRoutes: Readonly<Record<string, string>> = {
  "GET /healthz": "Liveness probe.",
  "GET /readyz": "Readiness probe.",
  "GET /api/auth/*":
    "Better Auth; its browser calls are listed as browser operations.",
  "POST /api/auth/*":
    "Better Auth; its browser calls are listed as browser operations.",
  "POST /api/mcp": "MCP transport for capabilities.",
  "GET /api/mcp": "Refused: the MCP server has no server streams.",
  "DELETE /api/mcp": "Refused: the MCP server has no sessions.",
  "POST /api/zero/query": "Zero sync reads for the browser.",
  "POST /api/zero/mutate":
    "Zero sync writes: workspace commands, each also a capability.",
  "GET /api/events": "Realtime event stream for the browser.",
  "GET /api/organizations/:id/logo/:kind": "Serves an organization logo.",
  "GET /api/users/:id/photo": "Serves a profile photo.",
  "ALL /api/*": "Unknown API path fallback.",
};

export type HumanOnlyOperation = HumanOnly & {
  name: string;
  title: string;
  explanation: string;
};

function describe(
  name: string,
  title: string,
  humanOnly: HumanOnly,
): HumanOnlyOperation {
  return {
    name,
    title,
    reason: humanOnly.reason,
    explanation: humanOnlyReasons[humanOnly.reason],
    where: humanOnly.where,
    ...(humanOnly.alternative && { alternative: humanOnly.alternative }),
  };
}

// Capabilities that leave out an agent surface must say why, and web-only
// metadata must not decorate something agents can call.
export function assertHumanOnlyMetadata(
  capabilities: readonly AnyCapability[],
) {
  for (const c of capabilities) {
    const forAgents =
      c.surfaces.includes("mcp") && c.surfaces.includes("agent");
    if (!forAgents && !c.humanOnly)
      throw new Error(
        `Capability ${c.name} is not available to agents; declare humanOnly with its reason.`,
      );
    if (forAgents && c.humanOnly)
      throw new Error(
        `Capability ${c.name} is available to agents but declares humanOnly.`,
      );
  }
  const names = new Set(capabilities.map((c) => c.name));
  for (const operation of browserOperations)
    if (names.has(operation.name))
      throw new Error(
        `Browser operation ${operation.name} collides with a capability.`,
      );
}

export function humanOnlyOperations(
  capabilities: readonly AnyCapability[],
): HumanOnlyOperation[] {
  return [
    ...capabilities.flatMap((c) =>
      c.humanOnly ? [describe(c.name, c.title, c.humanOnly)] : [],
    ),
    ...browserOperations.map((o) => describe(o.name, o.title, o)),
  ];
}

// The refusal an agent receives when it calls a human-only operation by name.
export function humanOnlyRefusal(
  capabilities: readonly AnyCapability[],
  name: string,
) {
  const operation = humanOnlyOperations(capabilities).find(
    (o) => o.name === name,
  );
  if (!operation) return undefined;
  return new CapabilityError(
    "forbidden",
    `“${operation.title}” needs the person in the browser: ${operation.where}. ${operation.explanation}${operation.alternative ? ` Instead: ${operation.alternative}` : ""}`,
    { kind: "human_only" },
  );
}

export function humanOnlyCapability(all: () => readonly AnyCapability[]) {
  return defineCapability({
    name: "listHumanOnlyOperations",
    title: "List human-only operations",
    description:
      "What agents deliberately cannot do: operations that stay with the person in the browser (credentials, account security, organization membership and roles, the audit log, organization data exports, Litto conversations, browser preferences), with the reason and where the person does each one. Call it before telling someone a tool is missing.",
    kind: "query",
    surfaces: everywhere,
    idempotent: true,
    input: z.object({}),
    run: () => Promise.resolve({ operations: humanOnlyOperations(all()) }),
  });
}
