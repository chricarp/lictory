import { Hono } from "hono";
import { z } from "zod";
import { CapabilityError } from "@lictory/core/capabilities/core";
import { errorResponse } from "@lictory/core/capabilities/http";
import { db } from "@lictory/core/db";
import { chatOwner } from "@lictory/core/intelligence/chat/http";
import {
  cancelChatRun,
  submitChatRun,
} from "@lictory/core/intelligence/chat/runs";
import { chatContextSchema } from "@lictory/core/intelligence/chat/shared";
import {
  deleteChat,
  getChatSnapshot,
  listChats,
  openChat,
  updateChat,
} from "@lictory/core/intelligence/chat/store";
import { createDictationSession } from "@lictory/core/intelligence/voice/transcription";
import { limit, MB, noStore } from "@lictory/api/middleware";

const turn = z
  .object({
    id: z.uuid(),
    organizationId: z.string().min(1),
    surface: z.enum(["page", "dock"]).default("page"),
    requestId: z.uuid(),
    message: z
      .object({
        id: z.string().min(1).max(200),
        role: z.literal("user"),
        parts: z
          .array(
            z.union([
              z.object({
                type: z.literal("text"),
                text: z.string().max(200_000),
              }),
              z.object({
                type: z.literal("data-context"),
                data: chatContextSchema,
              }),
            ]),
          )
          .min(1)
          .max(20),
      })
      .optional(),
    response: z
      .union([
        z.object({
          toolCallId: z.string().min(1).max(200),
          output: z.unknown(),
        }),
        z.object({
          approvalId: z.string().min(1).max(500),
          approved: z.boolean(),
        }),
      ])
      .optional(),
    retry: z.literal(true).optional(),
    runId: z.string().min(1).max(200).optional(),
  })
  .refine((v) => !v.retry || !!v.runId, "Identify the turn to retry.")
  .refine(
    (v) => Number(!!v.message) + Number(!!v.response) + Number(!!v.retry) === 1,
    "Submit one message, response or retry.",
  );

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

export function intelligenceRoutes() {
  const app = new Hono();

  app.post("/api/intelligence/chat", limit(10 * MB), async (c) => {
    try {
      const { id, organizationId, surface, ...input } = turn.parse(
        await c.req.json(),
      );
      const { owner } = await chatOwner(c.req.raw, organizationId, {
        requireAi: true,
      });
      await openChat(db, owner, id, { listed: surface === "page" });
      if (surface === "page") await updateChat(db, owner, id, { listed: true });
      await submitChatRun(db, owner, id, input);
      return c.json(await getChatSnapshot(db, owner, id), 202, noStore);
    } catch (error) {
      return errorResponse(error);
    }
  });
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
      return c.json(
        await getChatSnapshot(db, owner, c.req.param("id")),
        200,
        noStore,
      );
    } catch (error) {
      return errorResponse(error);
    }
  });
  app.post("/api/intelligence/chats/:id/stop", async (c) => {
    try {
      const { owner } = await chatOwner(
        c.req.raw,
        c.req.query("organizationId"),
      );
      const { runId, requestId } = z
        .object({ runId: z.uuid(), requestId: z.uuid().optional() })
        .parse(await c.req.json());
      const id = c.req.param("id");
      // Stop may arrive before the original submit request.
      await openChat(db, owner, id);
      await cancelChatRun(db, owner, id, runId, requestId);
      return c.json(await getChatSnapshot(db, owner, id), 200, noStore);
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
      const id = c.req.param("id");
      if (!(await deleteChat(db, owner, id))) throw notFound();
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
