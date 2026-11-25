// The Slack Web API methods Lictory calls, behind one small client so the
// rest of the module never sees HTTP. Everything Slack-specific about
// errors is translated here into `SlackError` kinds the domain acts on:
//
// - `rate_limited` (HTTP 429): retry after `retryAfterSeconds`;
// - `authentication` (invalid_auth, token_revoked, account_inactive…): the
//   installation needs an administrator;
// - `channel` (channel_not_found, not_in_channel, is_archived…): the link
//   needs a channel administrator;
// - `transient` (network, 5xx): retry with backoff;
// - `rejected`: Slack refused this one request (message too long…).
//
// Tests and the browser suite substitute `fetch` (scripts/e2e-fakes/slack.ts);
// the base URL never changes, so the transport, not the code, is swapped.

export const SLACK_API = "https://slack.com/api";
export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

const TIMEOUT_MS = 15_000;

export type SlackErrorKind =
  "rate_limited" | "authentication" | "channel" | "transient" | "rejected";

export class SlackError extends Error {
  constructor(
    readonly kind: SlackErrorKind,
    message: string,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SlackError";
  }
}

const authenticationCodes = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "missing_scope",
  "no_permission",
  "team_access_not_granted",
  "invalid_client_id",
  "bad_client_secret",
  "invalid_code",
  "bad_redirect_uri",
  "code_already_used",
  "oauth_authorization_url_mismatch",
]);
const channelCodes = new Set([
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "restricted_action",
  "restricted_action_read_only_channel",
  "restricted_action_thread_only_channel",
  "restricted_action_non_threadable_channel",
  "ekm_access_denied",
]);

// What a person can act on, in their words.
function describe(method: string, code: string): string {
  switch (code) {
    case "invalid_auth":
    case "not_authed":
    case "token_revoked":
    case "token_expired":
    case "account_inactive":
      return "Slack no longer accepts Lictory's token. An organization administrator must install the Slack app again.";
    case "missing_scope":
      return "The Slack app lacks a permission Lictory needs. Update the app from the manifest in Lictory's Slack settings and reinstall it.";
    case "invalid_client_id":
    case "bad_client_secret":
      return "Slack refused the app's client ID or secret. Copy them again from the app's Basic Information page.";
    case "invalid_code":
    case "code_already_used":
      return "The Slack authorization expired. Start the installation again.";
    case "bad_redirect_uri":
    case "oauth_authorization_url_mismatch":
      return "The Slack app's redirect URL does not match this installation. Update the app from Lictory's manifest.";
    case "channel_not_found":
      return "The Slack channel no longer exists or the Lictory app cannot see it.";
    case "not_in_channel":
      return "The Lictory app is not in the Slack channel. Add it with /invite @Lictory.";
    case "is_archived":
      return "The Slack channel is archived.";
    case "msg_too_long":
      return "The message is too long for Slack.";
    case "message_not_found":
      return "The message no longer exists in Slack.";
    default:
      return `Slack refused ${method} (${code}).`;
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type SlackApiOptions = {
  fetch?: Fetch;
  signal?: AbortSignal;
};

type SlackResponse = { ok: boolean; error?: string } & Record<string, unknown>;

export type SlackUserInfo = {
  id: string;
  name: string;
  isBot: boolean;
  deleted: boolean;
  // Present only when Slack confirmed the address.
  confirmedEmail: string | null;
};

export type SlackChannelInfo = {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  isArchived: boolean;
};

export type SlackMessage = {
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  app_id?: string;
  username?: string;
  subtype?: string;
  text?: string;
  files?: SlackFile[];
  reply_count?: number;
  edited?: { user?: string; ts?: string };
  metadata?: { event_type?: string; event_payload?: Record<string, unknown> };
  bot_profile?: { name?: string; app_id?: string };
};

export type SlackFile = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  size?: number;
  permalink?: string;
  mode?: string;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function slackClient(options: SlackApiOptions = {}) {
  const fetcher: Fetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function call(
    method: string,
    token: string | null,
    params: Record<string, unknown>,
    as: "json" | "form" = "json",
  ): Promise<SlackResponse> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: string;
    if (as === "form") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      ).toString();
    } else {
      headers["Content-Type"] = "application/json; charset=utf-8";
      body = JSON.stringify(params);
    }
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetcher(`${SLACK_API}/${method}`, {
        method: "POST",
        headers,
        body,
        signal,
        redirect: "error",
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new SlackError(
        "transient",
        "Slack could not be reached. Lictory retries shortly.",
        "network",
      );
    }
    if (response.status === 429) {
      const retry = Number(response.headers.get("retry-after"));
      throw new SlackError(
        "rate_limited",
        "Slack is limiting requests. Lictory retries when Slack allows it.",
        "ratelimited",
        Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : 30,
      );
    }
    if (response.status >= 500)
      throw new SlackError(
        "transient",
        `Slack answered ${response.status}. Lictory retries shortly.`,
        `http_${response.status}`,
      );
    let data: SlackResponse;
    try {
      data = (await response.json()) as SlackResponse;
    } catch {
      throw new SlackError(
        "transient",
        "Slack sent an unreadable answer. Lictory retries shortly.",
        "invalid_response",
      );
    }
    if (!data.ok) {
      const code = str(data.error) || "unknown_error";
      if (code === "ratelimited")
        throw new SlackError("rate_limited", describe(method, code), code, 30);
      const kind: SlackErrorKind = authenticationCodes.has(code)
        ? "authentication"
        : channelCodes.has(code)
          ? "channel"
          : code === "internal_error" ||
              code === "fatal_error" ||
              code === "service_unavailable" ||
              code === "request_timeout"
            ? "transient"
            : "rejected";
      throw new SlackError(kind, describe(method, code), code);
    }
    return data;
  }

  return {
    /** Exchanges an OAuth code for the bot token (oauth.v2.access). */
    async exchangeCode(input: {
      clientId: string;
      clientSecret: string;
      code: string;
      redirectUri: string;
    }) {
      const data = await call(
        "oauth.v2.access",
        null,
        {
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        },
        "form",
      );
      const team = (data.team ?? {}) as Record<string, unknown>;
      const accessToken = str(data.access_token);
      if (!accessToken.startsWith("xoxb-") || !str(team.id))
        throw new SlackError(
          "rejected",
          "Slack did not return a bot token. Check the app's bot scopes in the manifest.",
          "no_bot_token",
        );
      return {
        accessToken,
        appId: str(data.app_id),
        botUserId: str(data.bot_user_id),
        scopes: str(data.scope),
        teamId: str(team.id),
        teamName: str(team.name),
        enterprise: data.enterprise != null,
      };
    },

    /**
     * Checks an app's Client ID and Client Secret before it is installed:
     * Slack answers an unknown authorization code with `invalid_code` only
     * when the client credentials are right (no token exists yet, so
     * auth.test cannot be used). Throws a SlackError otherwise.
     */
    async checkAppCredentials(input: {
      clientId: string;
      clientSecret: string;
    }) {
      try {
        await call(
          "oauth.v2.access",
          null,
          {
            client_id: input.clientId,
            client_secret: input.clientSecret,
            code: "lictory-credentials-check",
          },
          "form",
        );
      } catch (error) {
        if (error instanceof SlackError && error.code === "invalid_code")
          return;
        throw error;
      }
    },

    /** Who the token is (auth.test): the workspace URL and bot id. */
    async authTest(token: string) {
      const data = await call("auth.test", token, {});
      return {
        teamId: str(data.team_id),
        teamName: str(data.team),
        url: str(data.url),
        userId: str(data.user_id),
        botId: str(data.bot_id),
      };
    },

    async revoke(token: string) {
      await call("auth.revoke", token, {}, "form");
    },

    async userInfo(token: string, user: string): Promise<SlackUserInfo> {
      const data = await call("users.info", token, { user }, "form");
      const u = (data.user ?? {}) as Record<string, unknown>;
      const profile = (u.profile ?? {}) as Record<string, unknown>;
      const email = str(profile.email);
      return {
        id: str(u.id) || user,
        name:
          str(profile.display_name) ||
          str(profile.real_name) ||
          str(u.real_name) ||
          str(u.name) ||
          user,
        isBot: u.is_bot === true || u.id === "USLACKBOT",
        deleted: u.deleted === true,
        // Slack confirms workspace members' addresses; an explicit `false`
        // means it did not, and an address it did not confirm maps no one.
        confirmedEmail:
          email && u.is_email_confirmed !== false ? email.toLowerCase() : null,
      };
    },

    /** The Slack person with this email, if any (users.lookupByEmail). */
    async lookupByEmail(token: string, email: string) {
      try {
        const data = await call(
          "users.lookupByEmail",
          token,
          { email },
          "form",
        );
        const u = (data.user ?? {}) as Record<string, unknown>;
        return str(u.id) || null;
      } catch (error) {
        if (error instanceof SlackError && error.code === "users_not_found")
          return null;
        throw error;
      }
    },

    /** Channels the bot is a member of, by name (users.conversations). */
    async botChannels(token: string, limit = 400) {
      const channels: SlackChannelInfo[] = [];
      let cursor = "";
      do {
        const data = await call(
          "users.conversations",
          token,
          {
            types: "public_channel,private_channel",
            exclude_archived: true,
            limit: 200,
            ...(cursor ? { cursor } : {}),
          },
          "form",
        );
        for (const c of (data.channels ?? []) as Record<string, unknown>[])
          channels.push(channelInfo(c, true));
        cursor = str(
          (data.response_metadata as Record<string, unknown> | undefined)
            ?.next_cursor,
        );
      } while (cursor && channels.length < limit);
      return channels.sort((a, b) => a.name.localeCompare(b.name));
    },

    async channelInfo(token: string, channel: string) {
      const data = await call("conversations.info", token, { channel }, "form");
      return channelInfo((data.channel ?? {}) as Record<string, unknown>);
    },

    /** The latest `limit` messages of a channel, newest first. */
    async history(
      token: string,
      channel: string,
      limit: number,
      options: { includeMetadata?: boolean } = {},
    ) {
      const data = await call(
        "conversations.history",
        token,
        {
          channel,
          limit,
          ...(options.includeMetadata ? { include_all_metadata: true } : {}),
        },
        "form",
      );
      return (data.messages ?? []) as SlackMessage[];
    },

    /** A thread's messages (its root first), at most `limit`. */
    async replies(token: string, channel: string, ts: string, limit: number) {
      const data = await call(
        "conversations.replies",
        token,
        { channel, ts, limit },
        "form",
      );
      return (data.messages ?? []) as SlackMessage[];
    },

    async postMessage(
      token: string,
      message: {
        channel: string;
        text: string;
        blocks?: unknown[];
        threadTs?: string | null;
        username?: string;
        iconUrl?: string | null;
        // Idempotency: the Lictory message id, readable again from history.
        lictoryMessageId: string;
      },
    ) {
      const data = await call("chat.postMessage", token, {
        channel: message.channel,
        text: message.text,
        ...(message.blocks ? { blocks: message.blocks } : {}),
        ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
        ...(message.username ? { username: message.username } : {}),
        ...(message.iconUrl ? { icon_url: message.iconUrl } : {}),
        unfurl_links: false,
        unfurl_media: false,
        metadata: {
          event_type: "lictory_message",
          event_payload: { message_id: message.lictoryMessageId },
        },
      });
      return { ts: str(data.ts) };
    },

    async updateMessage(
      token: string,
      message: {
        channel: string;
        ts: string;
        text: string;
        blocks?: unknown[];
      },
    ) {
      await call("chat.update", token, {
        channel: message.channel,
        ts: message.ts,
        text: message.text,
        ...(message.blocks ? { blocks: message.blocks } : { blocks: [] }),
      });
    },

    async deleteMessage(token: string, channel: string, ts: string) {
      try {
        await call("chat.delete", token, { channel, ts });
      } catch (error) {
        // Already gone: what we wanted.
        if (error instanceof SlackError && error.code === "message_not_found")
          return;
        throw error;
      }
    },

    async addReaction(
      token: string,
      channel: string,
      ts: string,
      name: string,
    ) {
      try {
        await call("reactions.add", token, { channel, timestamp: ts, name });
      } catch (error) {
        if (error instanceof SlackError && error.code === "already_reacted")
          return;
        throw error;
      }
    },

    async removeReaction(
      token: string,
      channel: string,
      ts: string,
      name: string,
    ) {
      try {
        await call("reactions.remove", token, { channel, timestamp: ts, name });
      } catch (error) {
        if (
          error instanceof SlackError &&
          (error.code === "no_reaction" || error.code === "message_not_found")
        )
          return;
        throw error;
      }
    },
  };
}

export type SlackClient = ReturnType<typeof slackClient>;

function channelInfo(
  c: Record<string, unknown>,
  member?: boolean,
): SlackChannelInfo {
  return {
    id: str(c.id),
    name: str(c.name) || str(c.id),
    isPrivate: c.is_private === true,
    isMember: member ?? c.is_member === true,
    isArchived: c.is_archived === true,
  };
}

// The client the API and the worker use. The browser suite routes
// slack.com to its stand-in at the transport (route-fake-sites.ts); domain
// tests pass the fake's `fetch` to `slackClient` instead.
export function defaultSlackClient(signal?: AbortSignal) {
  return slackClient({ signal });
}
