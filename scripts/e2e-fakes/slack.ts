// A stand-in for Slack: the Web API methods Lictory's Slack adapter calls
// (packages/core/src/channels/slack/api.ts), with Slack's shapes and errors,
// the OAuth authorize page, and the people on Slack's side, who post, edit,
// delete and react. Those actions are delivered to Lictory as Events API
// requests signed with the app's signing secret, exactly as Slack signs them,
// so verification, dedupe, ingest and loop prevention run unchanged. Like
// Slack, the fake also sends events for the bot's own posts and reactions.
//
// Domain tests use it in process (`createFakeSlack().fetch` as the adapter's
// transport, `deliver` straight into the route handler). The browser suite
// starts it on 127.0.0.1 (`startFakeSlack`) and routes https://slack.com to it
// through route-fake-sites.ts; tests drive Slack's side through /__fake/*.
// Production images contain neither file.
import { createHmac } from "node:crypto";
import { json, listen, send } from "./http";

export type FakeSlackApp = {
  appId: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
  teamId: string;
  teamName: string;
  botUserId: string;
  botId: string;
  // Where events go (the organization's Events API URL).
  eventsUrl?: string;
};

type Message = {
  ts: string;
  channel: string;
  user?: string;
  bot_id?: string;
  app_id?: string;
  username?: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  edited?: { user: string; ts: string };
  metadata?: { event_type: string; event_payload: Record<string, unknown> };
  files?: Record<string, unknown>[];
  blocks?: unknown[];
  reactions: Map<string, Set<string>>;
  deleted?: boolean;
};

type Channel = {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  members: Set<string>;
};

type Person = {
  id: string;
  name: string;
  email?: string;
  confirmed?: boolean;
  isBot?: boolean;
};

export type Delivery = (request: {
  url: string;
  headers: Headers;
  body: string;
}) => Promise<{ status: number; body: string }>;

const str = (value: unknown) => (typeof value === "string" ? value : "");

export const FAKE_SLACK_APP: FakeSlackApp = {
  appId: "A0E2EFAKE01",
  clientId: "1111111111.2222222222",
  clientSecret: "0123456789abcdef0123456789abcdef",
  signingSecret: "fedcba9876543210fedcba9876543210",
  teamId: "T0E2EFAKE",
  teamName: "Acme Slack",
  botUserId: "U0LICTORY",
  botId: "B0LICTORY",
};

export function signSlackBody(
  signingSecret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const signature = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
  return new Headers({
    "Content-Type": "application/json",
    "X-Slack-Request-Timestamp": String(timestamp),
    "X-Slack-Signature": signature,
  });
}

const httpDelivery: Delivery = async ({ url, headers, body }) => {
  const response = await fetch(url, { method: "POST", headers, body });
  return { status: response.status, body: await response.text() };
};

export function createFakeSlack(
  options: { app?: FakeSlackApp; deliver?: Delivery; teamUrl?: string } = {},
) {
  const app: FakeSlackApp = { ...FAKE_SLACK_APP, ...options.app };
  const deliver = options.deliver ?? httpDelivery;
  const teamUrl = options.teamUrl ?? "https://acme-e2e.slack.com/";
  const token = `xoxb-fake-${app.teamId.toLowerCase()}`;
  const codes = new Map<string, string>();
  const channels = new Map<string, Channel>();
  const messages: Message[] = [];
  const people = new Map<string, Person>([
    [app.botUserId, { id: app.botUserId, name: "Lictory", isBot: true }],
  ]);
  let clock = 1_800_000_000;
  let eventSequence = 0;
  let revoked = false;
  const delivered: { eventId: string; status: number; type: string }[] = [];
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const pending: Promise<unknown>[] = [];
  const rateLimits = new Map<string, number>();
  const failures = new Map<string, string>();
  const lostAnswers = new Set<string>();

  const nextTs = () => `${++clock}.${String(++eventSequence).padStart(6, "0")}`;
  const find = (channel: string, ts: string) =>
    messages.find((m) => m.channel === channel && m.ts === ts && !m.deleted);
  const view = (m: Message) => ({
    type: "message",
    ts: m.ts,
    ...(m.user ? { user: m.user } : {}),
    ...(m.bot_id
      ? { bot_id: m.bot_id, app_id: m.app_id, username: m.username }
      : {}),
    text: m.text,
    ...(m.thread_ts ? { thread_ts: m.thread_ts } : {}),
    ...(m.reply_count ? { reply_count: m.reply_count } : {}),
    ...(m.edited ? { edited: m.edited } : {}),
    ...(m.metadata ? { metadata: m.metadata } : {}),
    ...(m.files ? { files: m.files } : {}),
    ...(m.reactions.size
      ? {
          reactions: [...m.reactions].map(([name, users]) => ({
            name,
            users: [...users],
            count: users.size,
          })),
        }
      : {}),
  });

  /** Delivers one event the way Slack does: signed, to the app's URL. */
  async function sendEvent(event: Record<string, unknown>, eventId?: string) {
    if (!app.eventsUrl) return null;
    const id = eventId ?? `Ev${String(++eventSequence).padStart(8, "0")}`;
    const body = JSON.stringify({
      token: "deprecated-verification-token",
      team_id: app.teamId,
      api_app_id: app.appId,
      event,
      type: "event_callback",
      event_id: id,
      event_time: clock,
    });
    const result = await deliver({
      url: app.eventsUrl,
      headers: signSlackBody(app.signingSecret, body),
      body,
    });
    delivered.push({
      eventId: id,
      status: result.status,
      type: String(event.type),
    });
    return { eventId: id, ...result };
  }
  // Events caused by the bot's own API calls are sent after the answer, as
  // Slack does; tests await `settled()` to see them.
  const later = (event: Record<string, unknown>) => {
    pending.push(Promise.resolve().then(() => sendEvent(event)));
  };

  function ok(body: Record<string, unknown> = {}) {
    return new Response(JSON.stringify({ ok: true, ...body }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  function error(code: string) {
    return new Response(JSON.stringify({ ok: false, error: code }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async function api(
    method: string,
    params: Record<string, unknown>,
    auth: string | null,
  ) {
    calls.push({ method, params });
    const limited = rateLimits.get(method);
    if (limited !== undefined) {
      rateLimits.delete(method);
      return new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
        status: 429,
        headers: {
          "Retry-After": String(limited),
          "Content-Type": "application/json",
        },
      });
    }
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      return error(failure);
    }
    if (method === "oauth.v2.access") {
      if (params.client_id !== app.clientId) return error("invalid_client_id");
      if (params.client_secret !== app.clientSecret)
        return error("bad_client_secret");
      const code = str(params.code);
      if (!codes.has(code)) return error("invalid_code");
      if (codes.get(code) !== params.redirect_uri)
        return error("bad_redirect_uri");
      codes.delete(code);
      revoked = false;
      return ok({
        access_token: token,
        token_type: "bot",
        scope: "channels:history,chat:write",
        bot_user_id: app.botUserId,
        app_id: app.appId,
        team: { id: app.teamId, name: app.teamName },
        enterprise: null,
        authed_user: { id: "U0ADMIN" },
      });
    }
    if (auth !== `Bearer ${token}` || revoked) return error("invalid_auth");
    const channelOf = (id: unknown) => channels.get(str(id));
    switch (method) {
      case "auth.test":
        return ok({
          url: teamUrl,
          team: app.teamName,
          user: "lictory",
          team_id: app.teamId,
          user_id: app.botUserId,
          bot_id: app.botId,
        });
      case "auth.revoke":
        revoked = true;
        return ok({ revoked: true });
      case "users.info": {
        const person = people.get(str(params.user));
        if (!person) return error("user_not_found");
        return ok({
          user: {
            id: person.id,
            name: person.name.toLowerCase().replace(/\s+/g, "."),
            real_name: person.name,
            is_bot: person.isBot ?? false,
            deleted: false,
            is_email_confirmed: person.confirmed ?? true,
            profile: {
              display_name: person.name,
              real_name: person.name,
              ...(person.email ? { email: person.email } : {}),
            },
          },
        });
      }
      case "users.lookupByEmail": {
        const person = [...people.values()].find(
          (p) => p.email?.toLowerCase() === str(params.email).toLowerCase(),
        );
        return person
          ? ok({ user: { id: person.id } })
          : error("users_not_found");
      }
      case "users.conversations":
        return ok({
          channels: [...channels.values()]
            .filter((c) => c.members.has(app.botUserId) && !c.isArchived)
            .map((c) => ({ id: c.id, name: c.name, is_private: c.isPrivate })),
          response_metadata: { next_cursor: "" },
        });
      case "conversations.info": {
        const channel = channelOf(params.channel);
        if (!channel) return error("channel_not_found");
        return ok({
          channel: {
            id: channel.id,
            name: channel.name,
            is_private: channel.isPrivate,
            is_archived: channel.isArchived,
            is_member: channel.members.has(app.botUserId),
          },
        });
      }
      case "conversations.history": {
        const channel = channelOf(params.channel);
        if (!channel) return error("channel_not_found");
        if (!channel.members.has(app.botUserId)) return error("not_in_channel");
        const list = messages
          .filter(
            (m) =>
              m.channel === channel.id &&
              !m.deleted &&
              (!m.thread_ts || m.thread_ts === m.ts),
          )
          .reverse()
          .slice(0, Number(params.limit ?? 100))
          .map(view);
        return ok({ messages: list, has_more: false });
      }
      case "conversations.replies": {
        const channel = channelOf(params.channel);
        if (!channel) return error("channel_not_found");
        const root = str(params.ts);
        return ok({
          messages: messages
            .filter(
              (m) =>
                m.channel === channel.id &&
                !m.deleted &&
                (m.ts === root || m.thread_ts === root),
            )
            .slice(0, Number(params.limit ?? 100))
            .map(view),
        });
      }
      case "chat.postMessage": {
        const channel = channelOf(params.channel);
        if (!channel) return error("channel_not_found");
        if (!channel.members.has(app.botUserId)) return error("not_in_channel");
        if (channel.isArchived) return error("is_archived");
        const threadTs = str(params.thread_ts) || undefined;
        if (threadTs && !find(channel.id, threadTs))
          return error("thread_not_found");
        const message: Message = {
          ts: nextTs(),
          channel: channel.id,
          bot_id: app.botId,
          app_id: app.appId,
          username: str(params.username) || "Lictory",
          text: str(params.text),
          ...(threadTs ? { thread_ts: threadTs } : {}),
          ...(params.metadata
            ? { metadata: params.metadata as Message["metadata"] }
            : {}),
          ...(params.blocks ? { blocks: params.blocks as unknown[] } : {}),
          reactions: new Map(),
        };
        messages.push(message);
        if (threadTs) {
          const root = find(channel.id, threadTs)!;
          root.reply_count = (root.reply_count ?? 0) + 1;
        }
        later({ type: "message", channel: channel.id, ...view(message) });
        if (lostAnswers.delete("chat.postMessage"))
          return new Response("upstream timeout", { status: 504 });
        return ok({
          channel: channel.id,
          ts: message.ts,
          message: view(message),
        });
      }
      case "chat.update": {
        const message = find(str(params.channel), str(params.ts));
        if (!message) return error("message_not_found");
        if (message.bot_id !== app.botId) return error("cant_update_message");
        message.text = str(params.text);
        message.edited = { user: app.botUserId, ts: nextTs() };
        later({
          type: "message",
          subtype: "message_changed",
          channel: message.channel,
          hidden: true,
          message: view(message),
          ts: message.edited.ts,
        });
        return ok({ channel: message.channel, ts: message.ts });
      }
      case "chat.delete": {
        const message = find(str(params.channel), str(params.ts));
        if (!message) return error("message_not_found");
        message.deleted = true;
        later({
          type: "message",
          subtype: "message_deleted",
          channel: message.channel,
          hidden: true,
          deleted_ts: message.ts,
          previous_message: view(message),
          ts: nextTs(),
        });
        return ok({ channel: message.channel, ts: message.ts });
      }
      case "reactions.add":
      case "reactions.remove": {
        const message = find(str(params.channel), str(params.timestamp));
        if (!message) return error("message_not_found");
        const name = str(params.name);
        const users = message.reactions.get(name) ?? new Set<string>();
        const add = method === "reactions.add";
        if (add && users.has(app.botUserId)) return error("already_reacted");
        if (!add && !users.has(app.botUserId)) return error("no_reaction");
        if (add) users.add(app.botUserId);
        else users.delete(app.botUserId);
        if (users.size) message.reactions.set(name, users);
        else message.reactions.delete(name);
        later({
          type: add ? "reaction_added" : "reaction_removed",
          user: app.botUserId,
          reaction: name,
          item: { type: "message", channel: message.channel, ts: message.ts },
          event_ts: nextTs(),
        });
        return ok();
      }
      default:
        return error("unknown_method");
    }
  }

  /** The adapter's transport: answers https://slack.com/api/* requests. */
  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = url.pathname.replace(/^\/api\//, "");
    const text = await request.text();
    const type = request.headers.get("content-type") ?? "";
    const params: Record<string, unknown> = type.includes("application/json")
      ? (json<Record<string, unknown>>(text) ?? {})
      : Object.fromEntries(new URLSearchParams(text));
    return api(method, params, request.headers.get("authorization"));
  }

  const fakeFetch = (input: string | URL | Request, init?: RequestInit) =>
    handle(input instanceof Request ? input : new Request(String(input), init));

  return {
    app,
    token,
    calls,
    delivered,
    fetch: fakeFetch,
    handle,
    setEventsUrl(url: string) {
      app.eventsUrl = url;
    },
    /** What Slack's authorize page hands back to the redirect URL. */
    authorize(redirectUri: string) {
      const code = `fake-code-${++eventSequence}`;
      codes.set(code, redirectUri);
      return code;
    },
    addPerson(person: Person) {
      people.set(person.id, person);
    },
    addChannel(channel: {
      id: string;
      name: string;
      isPrivate?: boolean;
      botMember?: boolean;
    }) {
      channels.set(channel.id, {
        id: channel.id,
        name: channel.name,
        isPrivate: channel.isPrivate ?? false,
        isArchived: false,
        members: new Set(channel.botMember === false ? [] : [app.botUserId]),
      });
    },
    removeBot(channelId: string) {
      channels.get(channelId)?.members.delete(app.botUserId);
      return sendEvent({
        type: "member_left_channel",
        user: app.botUserId,
        channel: channelId,
      });
    },
    revokeToken() {
      revoked = true;
    },
    rateLimitNext(method: string, retryAfterSeconds: number) {
      rateLimits.set(method, retryAfterSeconds);
    },
    failNext(method: string, code: string) {
      failures.set(method, code);
    },
    /** The next post is stored, but its answer is lost (a timeout). */
    loseNextPostAnswer() {
      lostAnswers.add("chat.postMessage");
    },
    messages(channel: string) {
      return messages
        .filter((m) => m.channel === channel && !m.deleted)
        .map(view);
    },
    /** A person posts in Slack. */
    async say(input: {
      channel: string;
      user: string;
      text: string;
      threadTs?: string;
      files?: Record<string, unknown>[];
      eventId?: string;
    }) {
      const message: Message = {
        ts: nextTs(),
        channel: input.channel,
        user: input.user,
        text: input.text,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        ...(input.files ? { files: input.files } : {}),
        reactions: new Map(),
      };
      messages.push(message);
      if (input.threadTs) {
        const root = find(input.channel, input.threadTs);
        if (root) root.reply_count = (root.reply_count ?? 0) + 1;
      }
      const sent = await sendEvent(
        {
          type: "message",
          channel: input.channel,
          ...(input.files ? { subtype: "file_share" } : {}),
          ...view(message),
        },
        input.eventId,
      );
      return { ts: message.ts, event: sent };
    },
    /** Re-sends an earlier event (Slack's retries). */
    resend(event: Record<string, unknown>, eventId: string) {
      return sendEvent(event, eventId);
    },
    async edit(input: { channel: string; ts: string; text: string }) {
      const message = messages.find(
        (m) => m.channel === input.channel && m.ts === input.ts,
      );
      if (!message) throw new Error("No such message in the fake Slack.");
      message.text = input.text;
      message.edited = { user: message.user ?? app.botUserId, ts: nextTs() };
      return sendEvent({
        type: "message",
        subtype: "message_changed",
        channel: input.channel,
        hidden: true,
        message: view(message),
        ts: message.edited.ts,
      });
    },
    async remove(input: { channel: string; ts: string }) {
      const message = messages.find(
        (m) => m.channel === input.channel && m.ts === input.ts,
      );
      if (!message) throw new Error("No such message in the fake Slack.");
      message.deleted = true;
      return sendEvent({
        type: "message",
        subtype: "message_deleted",
        channel: input.channel,
        hidden: true,
        deleted_ts: input.ts,
        ts: nextTs(),
      });
    },
    async react(input: {
      channel: string;
      ts: string;
      user: string;
      name: string;
      add?: boolean;
    }) {
      const message = messages.find(
        (m) => m.channel === input.channel && m.ts === input.ts,
      );
      if (!message) throw new Error("No such message in the fake Slack.");
      const add = input.add ?? true;
      const users = message.reactions.get(input.name) ?? new Set<string>();
      if (add) users.add(input.user);
      else users.delete(input.user);
      message.reactions.set(input.name, users);
      return sendEvent({
        type: add ? "reaction_added" : "reaction_removed",
        user: input.user,
        reaction: input.name,
        item: { type: "message", channel: input.channel, ts: input.ts },
        event_ts: nextTs(),
      });
    },
    renameChannel(channelId: string, name: string) {
      const channel = channels.get(channelId);
      if (channel) channel.name = name;
      return sendEvent({
        type: "channel_rename",
        channel: { id: channelId, name, created: clock },
      });
    },
    sendEvent,
    /** Waits for events the bot's own calls caused. */
    async settled() {
      while (pending.length) await Promise.all(pending.splice(0));
    },
  };
}

export type FakeSlack = ReturnType<typeof createFakeSlack>;

/**
 * The browser suite's Slack on 127.0.0.1. Slack's side is driven through
 * /__fake/slack/* (people, channels, posts, edits); the OAuth authorize page
 * redirects straight back with a code.
 */
export async function startFakeSlack(port: number) {
  const fake = createFakeSlack();
  const server = await listen(port, async (request, response) => {
    const url = new URL(request.url, "http://fake");
    const path = url.pathname;
    if (process.env.E2E_VERBOSE)
      console.log(`[fake slack] ${request.method} ${path}`);
    if (path === "/oauth/v2/authorize") {
      const redirect = url.searchParams.get("redirect_uri") ?? "";
      const state = url.searchParams.get("state") ?? "";
      if (url.searchParams.get("client_id") !== fake.app.clientId)
        return send(response, 400, { error: "invalid_client_id" });
      const code = fake.authorize(redirect);
      return send(response, 302, undefined, {
        Location: `${redirect}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      });
    }
    if (path.startsWith("/api/")) {
      const answer = await fake.handle(
        new Request(`https://slack.com${path}`, {
          method: "POST",
          headers: {
            "content-type": String(request.headers["content-type"] ?? ""),
            ...(request.headers.authorization
              ? { authorization: String(request.headers.authorization) }
              : {}),
          },
          body: request.body,
        }),
      );
      const headers: Record<string, string> = {};
      answer.headers.forEach((value, key) => (headers[key] = value));
      response.writeHead(answer.status, headers).end(await answer.text());
      return;
    }
    const body = json<Record<string, unknown>>(request.body) ?? {};
    switch (`${request.method} ${path}`) {
      case "GET /__fake/slack/app":
        return send(response, 200, fake.app);
      case "POST /__fake/slack/events-url":
        fake.setEventsUrl(String(body.url));
        return send(response, 204);
      case "POST /__fake/slack/people":
        fake.addPerson(body as unknown as Person);
        return send(response, 204);
      case "POST /__fake/slack/channels":
        fake.addChannel(
          body as { id: string; name: string; isPrivate?: boolean },
        );
        return send(response, 204);
      case "POST /__fake/slack/say":
        return send(
          response,
          200,
          await fake.say(
            body as {
              channel: string;
              user: string;
              text: string;
              threadTs?: string;
            },
          ),
        );
      case "POST /__fake/slack/edit":
        return send(
          response,
          200,
          await fake.edit(
            body as { channel: string; ts: string; text: string },
          ),
        );
      case "GET /__fake/slack/messages":
        await fake.settled();
        return send(
          response,
          200,
          fake.messages(url.searchParams.get("channel") ?? ""),
        );
      default:
        return send(response, 404, { error: "unknown fake route" });
    }
  });
  return { ...server, fake };
}
