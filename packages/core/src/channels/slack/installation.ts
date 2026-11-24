import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  isAdmin,
  lock,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import {
  decryptCredential,
  derivedCredentialsKeyInProduction,
  encryptCredential,
} from "@lictory/core/delivery/credentials";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import type { Environment } from "@lictory/core/lib/env";
import {
  SLACK_AUTHORIZE_URL,
  SlackError,
  type SlackClient,
} from "@lictory/core/channels/slack/api";

// The Slack connection of an organization (docs/internals/channels.md#slack).
// Each organization installs its own Slack app, created from a manifest
// Lictory generates for this installation, as an internal app of the
// customer's workspace. Credentials are entered by an organization
// administrator in the browser only (web-only capabilities), encrypted at
// rest and bound to the organization, and never returned. Network calls to
// Slack never run inside a transaction.

export type InstallationRow = typeof s.slackInstallation.$inferSelect;

// What the app may do, and nothing more: read and write messages and
// reactions in channels it was invited to, post with the author's name and
// avatar, read people's names and confirmed emails to map them, read file
// metadata and its own message metadata (idempotent posting).
export const SLACK_BOT_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "chat:write",
  "chat:write.customize",
  "reactions:read",
  "reactions:write",
  "users:read",
  "users:read.email",
  "files:read",
  "metadata.message:read",
] as const;

export const SLACK_BOT_EVENTS = [
  "message.channels",
  "message.groups",
  "reaction_added",
  "reaction_removed",
  "channel_rename",
  "group_rename",
  "member_left_channel",
  "channel_archive",
  "group_archive",
  "app_uninstalled",
  "tokens_revoked",
] as const;

const STATE_TTL_MS = 10 * 60_000;

export function slackUrls(
  organizationId: string,
  environment: Environment = process.env,
) {
  const base = platformUrl(environment).replace(/\/$/, "");
  const org = encodeURIComponent(organizationId);
  return {
    events: `${base}/api/slack/events/${org}`,
    interactivity: `${base}/api/slack/interactivity/${org}`,
    redirect: `${base}/api/slack/oauth/callback`,
  };
}

/** The exact app manifest an administrator pastes into Slack. */
export function slackAppManifest(
  organizationId: string,
  organizationName: string,
  environment: Environment = process.env,
) {
  const urls = slackUrls(organizationId, environment);
  return {
    display_information: {
      name: "Lictory",
      description: `Keeps ${organizationName.slice(0, 60)}'s Lictory channels and Slack channels in one conversation.`,
      background_color: "#1f2937",
    },
    features: {
      bot_user: { display_name: "Lictory", always_online: true },
    },
    oauth_config: {
      redirect_urls: [urls.redirect],
      scopes: { bot: [...SLACK_BOT_SCOPES] },
    },
    settings: {
      event_subscriptions: {
        request_url: urls.events,
        bot_events: [...SLACK_BOT_EVENTS],
      },
      interactivity: { is_enabled: true, request_url: urls.interactivity },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

export type SlackConnectionSummary = {
  status: InstallationRow["status"] | "none";
  appId: string | null;
  teamId: string | null;
  teamName: string | null;
  teamUrl: string | null;
  installedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastEventAt: string | null;
  linkedChannels: number;
  intelligenceReads: boolean;
};

function summary(
  row: InstallationRow | undefined,
  linkedChannels: number,
): SlackConnectionSummary {
  return {
    status: row?.status ?? "none",
    appId: row?.appId ?? null,
    teamId: row?.teamId ?? null,
    teamName: row?.teamName ?? null,
    teamUrl: row?.teamUrl ?? null,
    installedAt: row?.installedAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
    lastEventAt: row?.lastEventAt?.toISOString() ?? null,
    linkedChannels,
    intelligenceReads: row?.intelligenceReads ?? false,
  };
}

export async function installationOf(
  db: Database | Tx,
  organizationId: string,
): Promise<InstallationRow | undefined> {
  const [row] = await db
    .select()
    .from(s.slackInstallation)
    .where(eq(s.slackInstallation.organizationId, organizationId));
  return row;
}

async function requireAdmin(tx: Tx, userId: string, organizationId: string) {
  const membership = await authorize(tx, userId, organizationId);
  if (!isAdmin(membership))
    throw new DomainError(
      "forbidden",
      "An organization administrator must manage the Slack connection.",
    );
}

export function botToken(row: InstallationRow): string {
  if (row.status !== "connected" || !row.encryptedBotToken)
    throw new SlackError(
      "authentication",
      "Slack is not connected. An organization administrator must install the Slack app.",
      "not_connected",
    );
  return decryptCredential<string>(row.organizationId, row.encryptedBotToken);
}

export function signingSecret(row: InstallationRow): string {
  return decryptCredential<string>(
    row.organizationId,
    row.encryptedSigningSecret,
  );
}

async function linkedCount(db: Database | Tx, organizationId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.channelExternalLink)
    .where(
      and(
        eq(s.channelExternalLink.organizationId, organizationId),
        eq(s.channelExternalLink.source, "slack"),
        isNull(s.channelExternalLink.unlinkedAt),
      ),
    );
  return row?.count ?? 0;
}

/**
 * The connection as an organization member sees it (status and workspace);
 * administrators also get the manifest for this installation.
 */
export async function readSlackConnection(
  db: Database,
  userId: string,
  organizationId: string,
) {
  return db.transaction(async (tx) => {
    const membership = await authorize(tx, userId, organizationId);
    const row = await installationOf(tx, organizationId);
    const connection = summary(row, await linkedCount(tx, organizationId));
    if (!isAdmin(membership)) return { connection, manifest: null, urls: null };
    const [org] = await tx
      .select({ name: s.organization.name })
      .from(s.organization)
      .where(eq(s.organization.id, organizationId));
    return {
      connection,
      manifest: slackAppManifest(organizationId, org?.name ?? "Lictory"),
      urls: slackUrls(organizationId),
    };
  });
}

const appIdPattern = /^A[A-Z0-9]{6,20}$/;
const clientIdPattern = /^\d{6,20}\.\d{6,20}$/;

/**
 * Saves (or replaces) the app's credentials from its Basic Information
 * page. Replacing the secrets of the installed app keeps the installation;
 * a different app needs Slack disconnected first.
 */
export async function saveSlackApp(
  db: Database,
  userId: string,
  input: {
    organizationId: string;
    appId: string;
    clientId: string;
    clientSecret: string;
    signingSecret: string;
  },
  environment: Environment = process.env,
) {
  const appId = input.appId.trim();
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  const secret = input.signingSecret.trim();
  if (!appIdPattern.test(appId))
    throw new DomainError(
      "validation",
      "The App ID starts with A, as shown on the app's Basic Information page.",
    );
  if (!clientIdPattern.test(clientId))
    throw new DomainError(
      "validation",
      "The Client ID looks like 1234567890.1234567890 (Basic Information → App Credentials).",
    );
  if (
    !/^[a-f0-9]{16,64}$/i.test(clientSecret) ||
    !/^[a-f0-9]{16,64}$/i.test(secret)
  )
    throw new DomainError(
      "validation",
      "Copy the Client Secret and Signing Secret from Basic Information → App Credentials (Show, then copy).",
    );
  return db.transaction(async (tx) => {
    const { organizationId } = input;
    await lock(tx, organizationId);
    await requireAdmin(tx, userId, organizationId);
    await requireCredentialsKey(tx, environment);
    const existing = await installationOf(tx, organizationId);
    if (
      existing &&
      existing.appId !== appId &&
      (existing.status === "connected" || existing.status === "invalid")
    )
      throw new DomainError(
        "conflict",
        "Slack is connected with another app. Disconnect Slack first, then save the new app.",
        undefined,
        "invalid_state",
      );
    const values = {
      appId,
      clientId,
      encryptedClientSecret: encryptCredential(organizationId, clientSecret),
      encryptedSigningSecret: encryptCredential(organizationId, secret),
    };
    if (existing)
      await tx
        .update(s.slackInstallation)
        .set({
          ...values,
          ...(existing.appId !== appId || existing.status === "disconnected"
            ? { status: "pending" as const, lastError: null, lastErrorAt: null }
            : {}),
        })
        .where(eq(s.slackInstallation.id, existing.id));
    else
      await tx.insert(s.slackInstallation).values({
        organizationId,
        createdById: userId,
        status: "pending",
        ...values,
      });
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: "slack.app_saved",
      target: { type: "slack_app", id: appId },
    });
    return summary(
      await installationOf(tx, organizationId),
      await linkedCount(tx, organizationId),
    );
  });
}

// A new installation without DELIVERY_CREDENTIALS_KEY in production must
// not store credentials derived from BETTER_AUTH_SECRET (as for Jira).
async function requireCredentialsKey(tx: Tx, environment: Environment) {
  if (!derivedCredentialsKeyInProduction(environment)) return;
  const [delivery] = await tx
    .select({ id: s.deliveryConnection.id })
    .from(s.deliveryConnection)
    .limit(1);
  const [slack] = await tx
    .select({ id: s.slackInstallation.id })
    .from(s.slackInstallation)
    .limit(1);
  if (!delivery && !slack)
    throw new DomainError(
      "unavailable",
      "Slack cannot be connected yet: this Lictory installation has no DELIVERY_CREDENTIALS_KEY. An operator must set it and restart Lictory (see docs/operations/configuration.md).",
    );
}

const hashState = (state: string) =>
  createHash("sha256").update(state).digest("hex");

/** Starts the OAuth install: the Slack URL the browser opens. */
export async function startSlackInstall(
  db: Database,
  userId: string,
  organizationId: string,
) {
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    await requireAdmin(tx, userId, organizationId);
    const row = await installationOf(tx, organizationId);
    if (!row)
      throw new DomainError(
        "conflict",
        "Save the Slack app's credentials first.",
        undefined,
        "invalid_state",
      );
    const state = randomBytes(24).toString("base64url");
    await tx
      .update(s.slackInstallation)
      .set({
        oauthStateHash: hashState(state),
        oauthStateUserId: userId,
        oauthStateExpiresAt: new Date(Date.now() + STATE_TTL_MS),
      })
      .where(eq(s.slackInstallation.id, row.id));
    const url = new URL(SLACK_AUTHORIZE_URL);
    url.searchParams.set("client_id", row.clientId);
    url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
    url.searchParams.set("redirect_uri", slackUrls(organizationId).redirect);
    url.searchParams.set("state", state);
    return { url: url.toString() };
  });
}

/**
 * Finishes the OAuth install (the redirect from Slack): the signed-in
 * person must be the administrator who started it, within ten minutes.
 * Exchanges the code outside any transaction, then stores the bot token.
 */
export async function completeSlackInstall(
  db: Database,
  client: SlackClient,
  input: { userId: string; state: string; code: string },
): Promise<{ organizationId: string }> {
  const [row] = input.state
    ? await db
        .select()
        .from(s.slackInstallation)
        .where(eq(s.slackInstallation.oauthStateHash, hashState(input.state)))
    : [];
  if (
    row?.oauthStateUserId !== input.userId ||
    !row.oauthStateExpiresAt ||
    row.oauthStateExpiresAt < new Date()
  )
    throw new DomainError(
      "validation",
      "This Slack authorization is no longer valid. Start the installation again from Lictory's Slack settings.",
    );
  const organizationId = row.organizationId;
  const clientSecret = decryptCredential<string>(
    organizationId,
    row.encryptedClientSecret,
  );
  let granted: Awaited<ReturnType<SlackClient["exchangeCode"]>>;
  let identity: Awaited<ReturnType<SlackClient["authTest"]>>;
  try {
    granted = await client.exchangeCode({
      clientId: row.clientId,
      clientSecret,
      code: input.code,
      redirectUri: slackUrls(organizationId).redirect,
    });
    identity = await client.authTest(granted.accessToken);
  } catch (error) {
    await recordInstallationError(db, row.id, error);
    throw error;
  }
  if (granted.appId && granted.appId !== row.appId)
    throw new DomainError(
      "validation",
      `Slack installed app ${granted.appId}, but this organization saved app ${row.appId}. Save the app you installed.`,
    );
  if (granted.enterprise)
    throw new DomainError(
      "validation",
      "Install the Lictory app in one Slack workspace, not organization-wide.",
    );
  await db.transaction(async (tx) => {
    await lock(tx, organizationId);
    await requireAdmin(tx, input.userId, organizationId);
    const [current] = await tx
      .select()
      .from(s.slackInstallation)
      .where(eq(s.slackInstallation.id, row.id))
      .for("update");
    if (current?.oauthStateHash !== row.oauthStateHash)
      throw new DomainError(
        "conflict",
        "Another Slack installation started meanwhile. Start it again.",
      );
    // Another workspace than the one already linked would orphan links.
    if (current.teamId && current.teamId !== granted.teamId) {
      const links = await linkedCount(tx, organizationId);
      if (links)
        throw new DomainError(
          "conflict",
          `Lictory channels are linked to channels of ${current.teamName ?? "another workspace"}. Unlink them before installing in another workspace.`,
        );
    }
    await tx
      .update(s.slackInstallation)
      .set({
        encryptedBotToken: encryptCredential(
          organizationId,
          granted.accessToken,
        ),
        teamId: granted.teamId,
        teamName: identity.teamName || granted.teamName,
        teamUrl: identity.url || null,
        botUserId: granted.botUserId || identity.userId,
        botId: identity.botId || null,
        scopes: granted.scopes,
        status: "connected",
        lastError: null,
        lastErrorAt: null,
        oauthStateHash: null,
        oauthStateUserId: null,
        oauthStateExpiresAt: null,
        installedById: input.userId,
        installedAt: new Date(),
      })
      .where(eq(s.slackInstallation.id, row.id));
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: input.userId },
      action: "slack.installed",
      target: {
        type: "slack_workspace",
        id: granted.teamId,
        label: identity.teamName || granted.teamName,
      },
    });
    // Links that failed because the token was revoked work again.
    await tx
      .update(s.channelExternalLink)
      .set({ health: "ok", lastError: null, lastErrorAt: null })
      .where(
        and(
          eq(s.channelExternalLink.organizationId, organizationId),
          eq(s.channelExternalLink.source, "slack"),
          isNull(s.channelExternalLink.unlinkedAt),
        ),
      );
  });
  return { organizationId };
}

async function recordInstallationError(
  db: Database,
  installationId: string,
  error: unknown,
) {
  const message =
    error instanceof SlackError || error instanceof DomainError
      ? error.message
      : "Slack could not be reached.";
  await db
    .update(s.slackInstallation)
    .set({ lastError: message, lastErrorAt: new Date() })
    .where(eq(s.slackInstallation.id, installationId));
}

/**
 * Disconnects Slack: revokes the bot token (best effort, outside the
 * transaction), forgets it and unlinks every channel. Both sides keep their
 * history; the app's credentials stay so installing again needs no new app.
 */
export async function disconnectSlack(
  db: Database,
  client: SlackClient,
  userId: string,
  organizationId: string,
) {
  const row = await db.transaction(async (tx) => {
    await requireAdmin(tx, userId, organizationId);
    return installationOf(tx, organizationId);
  });
  if (!row) return { ok: true };
  if (row.encryptedBotToken)
    try {
      await client.revoke(
        decryptCredential<string>(organizationId, row.encryptedBotToken),
      );
    } catch {
      // Revoked or unreachable already: forgetting the token is what counts.
    }
  await db.transaction(async (tx) => {
    await lock(tx, organizationId);
    await requireAdmin(tx, userId, organizationId);
    await unlinkAll(tx, organizationId, userId);
    await tx
      .update(s.slackInstallation)
      .set({
        encryptedBotToken: null,
        status: "disconnected",
        lastError: null,
        lastErrorAt: null,
        oauthStateHash: null,
        oauthStateUserId: null,
        oauthStateExpiresAt: null,
      })
      .where(eq(s.slackInstallation.id, row.id));
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: "slack.disconnected",
      target: {
        type: "slack_workspace",
        id: row.teamId ?? row.appId,
        label: row.teamName,
      },
    });
  });
  return { ok: true };
}

// Unlinks every Slack link of the organization (exclusive lock held).
async function unlinkAll(tx: Tx, organizationId: string, userId: string) {
  const links = await tx
    .update(s.channelExternalLink)
    .set({ unlinkedAt: new Date(), unlinkedById: userId })
    .where(
      and(
        eq(s.channelExternalLink.organizationId, organizationId),
        eq(s.channelExternalLink.source, "slack"),
        isNull(s.channelExternalLink.unlinkedAt),
      ),
    )
    .returning({ channelId: s.channelExternalLink.channelId });
  for (const link of links)
    await tx
      .update(s.channel)
      .set({ externalSource: null, externalId: null })
      .where(
        and(
          eq(s.channel.organizationId, organizationId),
          eq(s.channel.id, link.channelId),
        ),
      );
  // Nothing more is sent for unlinked channels.
  await tx
    .update(s.channelMirror)
    .set({ dueAt: null, leasedUntil: null })
    .where(eq(s.channelMirror.organizationId, organizationId));
}

/**
 * Slack refused the token (revoked, uninstalled): the installation needs an
 * administrator. Links stay, marked failing, so reinstalling resumes them.
 */
export async function markInstallationInvalid(
  tx: Tx,
  installationId: string,
  message: string,
) {
  const [row] = await tx
    .update(s.slackInstallation)
    .set({
      status: "invalid",
      encryptedBotToken: null,
      lastError: message,
      lastErrorAt: new Date(),
    })
    .where(
      and(
        eq(s.slackInstallation.id, installationId),
        eq(s.slackInstallation.status, "connected"),
      ),
    )
    .returning({ organizationId: s.slackInstallation.organizationId });
  if (!row) return;
  await tx
    .update(s.channelExternalLink)
    .set({ health: "failing", lastError: message, lastErrorAt: new Date() })
    .where(
      and(
        eq(s.channelExternalLink.organizationId, row.organizationId),
        eq(s.channelExternalLink.source, "slack"),
        isNull(s.channelExternalLink.unlinkedAt),
      ),
    );
}
