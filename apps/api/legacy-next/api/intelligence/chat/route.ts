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
import { z } from "zod";
import { errorResponse, requireSameOrigin } from "@lictory/core/capabilities/http";
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
  getChat,
  openChat,
  saveMessages,
  updateChat,
} from "@lictory/core/intelligence/chat/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const titleSchema = z.object({ title: z.string() });

const body = z.object({
  id: z.uuid(),
  organizationId: z.string().min(1),
  // Where the conversation runs: the Intelligence page, or the dock present
  // on every other page (unlisted until continued on the page).
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

// One turn of a Lictory Intelligence conversation, streamed to the browser.
// The stored transcript is authoritative; the browser only adds its newest
// message. The assistant acts as the signed-in person (surface `agent`), so
// every tool call is authorized like the same action in the app.
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = body.parse(await request.json());
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
      {
        userId: owner.userId,
        surface: "agent",
        client: "Lictory Intelligence",
      },
      request.headers,
    );
    const tools = assistantTools(ctx);
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
          ? `Lictory Intelligence stopped: ${error.message}`
          : "Lictory Intelligence stopped unexpectedly. Try again.",
      onEnd: async ({ messages: final }) => {
        await saveMessages(db, owner, input.id, final).catch((error) =>
          console.error("Saving an Intelligence chat failed", error),
        );
      },
    });
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    return errorResponse(error);
  }
}
