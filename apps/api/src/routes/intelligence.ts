import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  smoothStream,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai";
import { Hono } from "hono";
import { z } from "zod";
import { CapabilityError } from "@lictory/core/capabilities/core";
import { errorResponse } from "@lictory/core/capabilities/http";
import { serverContext } from "@lictory/core/capabilities/server";
import { db } from "@lictory/core/db";
import {
  assistantTools,
  chatModel,
  generateTitle,
  systemPrompt,
} from "@lictory/core/intelligence/chat/assistant";
import { chatOwner } from "@lictory/core/intelligence/chat/http";
import {
  chatContextSchema,
  contextPrompt,
  type ChatMessage,
} from "@lictory/core/intelligence/chat/shared";
import {
  deleteChat,
  getChat,
  listChats,
  openChat,
  saveMessages,
  updateChat,
} from "@lictory/core/intelligence/chat/store";
import { createDictationSession } from "@lictory/core/intelligence/voice/transcription";
import { limit, MB, noStore } from "@lictory/api/middleware";

const titleSchema = z.object({ title: z.string() });

const turn = z.object({
  id: z.uuid(),
  organizationId: z.string().min(1),
  // The Intelligence page, or the dock on every other page (unlisted until
  // continued on the page).
  surface: z.enum(["page", "dock"]).default("page"),
  // Only the newest message travels: a new user prompt, or the last assistant
  // message carrying tool approvals or clarification answers.
  message: z.object({
    id: z.string().min(1).max(200),
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.unknown()).max(500),
    metadata: z.object({ workedMs: z.number().nonnegative() }).optional(),
  }),
});

const patch = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    pinned: z.boolean().optional(),
    // Continuing a dock conversation on the page adds it to the history.
    listed: z.literal(true).optional(),
  })
  .strict();

const notFound = () =>
  new CapabilityError("validation", "This conversation no longer exists.", {
    status: 404,
  });

// One turn of a Litto conversation, streamed to the browser.
// The stored transcript is authoritative; the browser only adds its newest
// message. The assistant acts as the signed-in person (surface `agent`), so
// every tool call is authorized like the same action in the app.
async function chatTurn(request: Request) {
  const input = turn.parse(await request.json());
  const { owner, roster } = await chatOwner(request, input.organizationId, {
    requireAi: true,
  });
  await openChat(db, owner, input.id, { listed: input.surface === "page" });
  const stored = (await getChat(db, owner, input.id))!;
  if (input.surface === "page" && !stored.chat.listed)
    await updateChat(db, owner, input.id, { listed: true });

  const incoming = input.message as ChatMessage;
  const history = [...stored.messages];
  const at = history.findIndex((m) => m.id === incoming.id);
  if (at >= 0) {
    // Continuing the same message (answers, approvals). Roles never change.
    if (history[at]!.role !== incoming.role)
      throw new z.ZodError([
        {
          code: "custom",
          path: ["message", "role"],
          message: "Message role cannot change.",
          input: incoming.role,
        },
      ]);
    history[at] = incoming;
    history.length = at + 1;
  } else history.push(incoming);

  const ctx = serverContext(
    { userId: owner.userId, surface: "agent", client: "Litto" },
    request.headers,
  );
  const tools = assistantTools(ctx, owner.organizationId);
  const messages = await validateUIMessages<ChatMessage>({
    messages: history,
    tools,
    dataSchemas: { title: titleSchema, context: chatContextSchema },
  });
  await saveMessages(db, owner, input.id, messages);

  const me = roster.members.find((m) => m.id === owner.userId);
  const firstPrompt =
    !stored.chat.title && incoming.role === "user"
      ? incoming.parts
          .flatMap((p) => (p.type === "text" ? [p.text] : []))
          .join("\n")
      : "";

  const stream = createUIMessageStream<ChatMessage>({
    originalMessages: messages,
    execute: async ({ writer }) => {
      // Answers and approvals continue the last assistant message; a new
      // prompt starts a new one. Ids are fixed here so the stored transcript
      // and the browser agree.
      const last = messages.at(-1);
      const continuing = last?.role === "assistant";
      const startedAt = Date.now();
      const workedBefore = continuing ? (last.metadata?.workedMs ?? 0) : 0;
      writer.write({
        type: "start",
        messageId: continuing ? last.id : crypto.randomUUID(),
      });
      const title = firstPrompt ? generateTitle(firstPrompt) : null;
      const result = streamText({
        model: chatModel(),
        system: systemPrompt({
          roster,
          organizationId: owner.organizationId,
          user: { id: owner.userId, name: me?.name ?? "this person" },
          now: new Date(),
        }),
        messages: await convertToModelMessages<ChatMessage>(messages, {
          tools,
          convertDataPart: (part) =>
            part.type === "data-context"
              ? { type: "text", text: contextPrompt(part.data) }
              : undefined,
        }),
        tools,
        stopWhen: isStepCount(24),
        experimental_transform: smoothStream({ chunking: "word" }),
        providerOptions: { openai: { store: false } },
        abortSignal: request.signal,
      });
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          sendReasoning: true,
          sendStart: false,
          messageMetadata: ({ part }) =>
            part.type === "finish"
              ? { workedMs: workedBefore + Date.now() - startedAt }
              : undefined,
        }),
      );
      const named = await title;
      if (named) {
        await updateChat(db, owner, input.id, { title: named });
        writer.write({
          type: "data-title",
          data: { title: named },
          transient: true,
        });
      }
    },
    onError: (error) =>
      error instanceof Error
        ? `Litto stopped: ${error.message}`
        : "Litto stopped unexpectedly. Try again.",
    onEnd: async ({ messages: final }) => {
      await saveMessages(db, owner, input.id, final).catch((error) =>
        console.error("Saving an Intelligence chat failed", error),
      );
    },
  });
  // Proxies must pass the stream through as it is produced.
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "X-Accel-Buffering": "no",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export function intelligenceRoutes() {
  const app = new Hono();

  app.post("/api/intelligence/chat", limit(10 * MB), async (c) => {
    try {
      return await chatTurn(c.req.raw);
    } catch (error) {
      return errorResponse(error);
    }
  });

  // The signed-in person's own conversations in one organization.
  app.get("/api/intelligence/chats", async (c) => {
    try {
      const { owner } = await chatOwner(
        c.req.raw,
        c.req.query("organizationId"),
      );
      return c.json({ chats: await listChats(db, owner) }, 200, noStore);
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.get("/api/intelligence/chats/:id", async (c) => {
    try {
      const { owner } = await chatOwner(
        c.req.raw,
        c.req.query("organizationId"),
      );
      const found = await getChat(db, owner, c.req.param("id"));
      if (!found) return c.json({ chat: null, messages: [] }, 200, noStore);
      return c.json(
        {
          chat: {
            id: found.chat.id,
            title: found.chat.title,
            pinned: found.chat.pinned,
          },
          messages: found.messages,
        },
        200,
        noStore,
      );
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.patch("/api/intelligence/chats/:id", async (c) => {
    try {
      const { owner } = await chatOwner(
        c.req.raw,
        c.req.query("organizationId"),
      );
      const chat = await updateChat(
        db,
        owner,
        c.req.param("id"),
        patch.parse(await c.req.json()),
      );
      if (!chat) throw notFound();
      return c.json({ ok: true }, 200, noStore);
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.delete("/api/intelligence/chats/:id", async (c) => {
    try {
      const { owner } = await chatOwner(
        c.req.raw,
        c.req.query("organizationId"),
      );
      if (!(await deleteChat(db, owner, c.req.param("id")))) throw notFound();
      return c.json({ ok: true }, 200, noStore);
    } catch (error) {
      return errorResponse(error);
    }
  });

  // A short-lived, transcription-only credential: the composer streams the
  // microphone straight to the provider; no audio passes through here.
  app.post("/api/intelligence/transcription", async (c) => {
    try {
      const input = z
        .object({ organizationId: z.string().min(1) })
        .parse(await c.req.json());
      const { owner } = await chatOwner(c.req.raw, input.organizationId, {
        requireAi: true,
      });
      return c.json(await createDictationSession(owner.userId), 200, noStore);
    } catch (error) {
      return errorResponse(error);
    }
  });

  return app;
}
