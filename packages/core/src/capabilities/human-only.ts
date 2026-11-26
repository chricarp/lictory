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
      "GET /api/admin/ai",
      "PUT /api/admin/ai",
      "POST /api/admin/ai/test",
      "POST /api/admin/ai/check",
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
      "POST /api/intelligence/transcription/segment",
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
  "GET /api/organizations/:id/logo/:kind/:sha":
    "Serves an organization logo to email clients, by its content hash.",
  "GET /api/users/:id/photo": "Serves a profile photo.",
  "ALL /api/*": "Unknown API path fallback.",
  // The runner protocol (docs/internals/factory.md#protocol): machines
  // authenticated with a runner credential, not people or agents.
  "POST /api/runner/v1/register":
    "Runner protocol: exchanges a one-time registration token for a runner credential.",
  "POST /api/runner/v1/heartbeat":
    "Runner protocol: heartbeat and lease renewal.",
  "POST /api/runner/v1/claim":
    "Runner protocol: long-poll for an agent session to run.",
  "POST /api/runner/v1/sessions/:id/start":
    "Runner protocol: the claimed session started.",
  "POST /api/runner/v1/sessions/:id/events":
    "Runner protocol: session event batches.",
  "POST /api/runner/v1/sessions/:id/inputs":
    "Runner protocol: long-poll for steering inputs.",
  "POST /api/runner/v1/sessions/:id/workspace":
    "Runner protocol: the session's repository and brokered credentials.",
  "POST /api/runner/v1/sessions/:id/complete":
    "Runner protocol: the session's result.",
  "POST /api/runner/v1/sessions/:id/release":
    "Runner protocol: a runner shutting down returns the session to the queue.",
  "POST /api/runner/v1/sessions/:id/model":
    "Runner protocol: model calls of the built-in harness through the server's AI provider.",
  "POST /api/code/webhooks/:connectionId":
    "Code host webhooks, authenticated by the host's signature (code/ingest.ts).",
  // Slack (docs/internals/channels.md#slack): requests Slack signs, and the
  // redirect that finishes an administrator's install (startSlackInstall).
  "POST /api/slack/events/:organizationId":
    "Slack Events API deliveries, verified by Slack's signature and processed by the worker.",
  "POST /api/slack/interactivity/:organizationId":
    "Slack interactivity payloads (link buttons on Lictory cards), verified and acknowledged.",
  "GET /api/slack/oauth/callback":
    "Slack's OAuth redirect finishing the install an administrator started with startSlackInstall.",
};

// Decisions stay with people (docs/internals/software-factory.md, rule 3).
// Every `decision` capability an agent surface lists says here where the
// person makes it. A Factory agent calling one is refused by the server
// whatever its token allows, and does not see it in tools/list; a person's
// own access token keeps it, to call when the person asked.
const specification = "The work item's specification";
export const personDecisions: Record<string, Omit<HumanOnly, "reason">> = {
  decideReview: {
    where: `${specification} → Reviews (Approve or Request changes)`,
    alternative:
      "propose changes with createBranch → commitBranch → createPullRequest, and ask with requestReview or replyToThread",
  },
  decidePullRequest: {
    where: `${specification} → the pull request (Approve or Request changes)`,
    alternative: "requestPullRequestReview, or comment with replyToThread",
  },
  mergePullRequest: {
    where: `${specification} → the pull request → Merge`,
    alternative: "requestPullRequestReview to ask the people who merge",
  },
  decideSuggestion: {
    where: `${specification} → the suggestion (Approve or Request changes)`,
  },
  mergeSuggestion: { where: `${specification} → the suggestion → Merge` },
  setThreadState: {
    where: `${specification} → the discussion (Resolve, Reopen, Blocking)`,
    alternative: "replyToThread with what you found",
  },
  commitSpecificationDraft: {
    where: `${specification} → the editor (Save)`,
    alternative: "createBranch → commitBranch → createPullRequest",
  },
  acceptDeliveryScope: {
    where: "The work item → Delivery scope → Accept",
    alternative: "askQuestion or a channel message to the person",
  },
  recordDecision: {
    where: "The work item → Decisions → Record decision",
    alternative: "replyToThread proposing the conclusion",
  },
  setDecisionArchived: { where: "The work item → Decisions" },
  signOffReadinessCheck: {
    where: "The work item → Readiness → Sign off",
  },
  publishReadinessChecks: {
    where: "Project settings → Readiness",
    alternative: "previewReadinessChecks",
  },
  setAiPolicy: { where: "Organization settings → Intelligence" },
  publishDelivery: {
    where: "The work item → Delivery → Export",
    alternative: "previewDeliveryExport",
  },
  mergeCodePullRequest: {
    where:
      "Code → the pull request → Merge (or Autopilot, when the project's autonomy policy merges passing agent pull requests)",
    alternative: "reviewCodePullRequest or requestCodeReview",
  },
  resolvePageThread: {
    where: "The page in Spaces → the discussion → Resolve",
    alternative: "replyToPageThread with what you found",
  },
  reopenPageThread: { where: "The page in Spaces → the discussion → Reopen" },
  setPageThreadBlocking: { where: "The page in Spaces → the discussion" },
  commitDraft: {
    where: "The page in Spaces → Publish or Commit",
    alternative: "proposePageChange",
  },
  decidePagePullRequest: {
    where: "The page in Spaces → Pull requests (Approve or Request changes)",
  },
  mergePagePullRequest: {
    where: "The page in Spaces → Pull requests → Merge",
    alternative: "requestPageReview",
  },
  promoteMessageToDecision: {
    where: "The message's More actions → Record as decision",
    alternative: "promoteMessageToDiscussion",
  },
  linkSlackChannel: { where: "The channel's header → Link to a Slack channel" },
  answerAgentApproval: {
    where: "The approval card in the session's thread, Home or Factory",
  },
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
  for (const c of capabilities) {
    const forAgents =
      c.surfaces.includes("mcp") || c.surfaces.includes("agent");
    if (c.decision && forAgents && !personDecisions[c.name])
      throw new Error(
        `Capability ${c.name} records a person's decision; say where the person makes it in personDecisions.`,
      );
    if (personDecisions[c.name] && !c.decision)
      throw new Error(
        `Capability ${c.name} is listed in personDecisions but is not a decision.`,
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

// The decisions a Factory agent is refused, with where its person makes them.
export function personDecisionOperations(
  capabilities: readonly AnyCapability[],
): HumanOnlyOperation[] {
  return capabilities.flatMap((c) => {
    const decision = personDecisions[c.name];
    return decision && c.decision
      ? [describe(c.name, c.title, { reason: "decision", ...decision })]
      : [];
  });
}

// The refusal a Factory agent receives for a decision: the person decides it,
// and where.
export function personDecisionRefusal(
  capability: AnyCapability,
  agentName: string,
) {
  const decision = personDecisions[capability.name];
  return new CapabilityError(
    "forbidden",
    `${agentName} is an agent: “${capability.title}” is a person's decision, made in ${decision?.where ?? "the browser"}. ${humanOnlyReasons.decision}${decision?.alternative ? ` Instead: ${decision.alternative}.` : ""}`,
    { kind: "human_only" },
  );
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
      "What agents deliberately cannot do: operations that stay with the person in the browser (credentials, account security, organization membership and roles, the audit log, organization data exports, Litto conversations, browser preferences) and, for a Factory agent, the decisions its person makes (approvals, merges, accepted scope, resolved discussions, recorded decisions, exports), with the reason and where the person does each one. Call it before telling someone a tool is missing.",
    kind: "query",
    surfaces: everywhere,
    idempotent: true,
    input: z.object({}),
    run: (ctx) =>
      Promise.resolve({
        operations: [
          ...humanOnlyOperations(all()),
          ...(ctx.principal.agent ? personDecisionOperations(all()) : []),
        ],
      }),
  });
}
