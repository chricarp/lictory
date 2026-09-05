import {
  createAskConversationRequestSchema,
  createAskMessageRequestSchema,
  updateAskMessageRequestSchema,
} from "@lictory/contracts";
import { Hono } from "hono";

import type { AppBindings } from "../../bindings";
import { errorBody } from "../../http/errors";
import {
  appendAskMessage,
  AskMutationError,
  createAskConversation,
  deleteAskConversation,
  listAskConversations,
  loadAskConversation,
  regenerateAskMessage,
  updateAskUserMessage,
} from "./service";

const asks = new Hono<AppBindings>();

function mutationFailure(error: unknown): {
  code: string;
  message: string;
  status: 400 | 404;
} | null {
  if (!(error instanceof AskMutationError)) return null;
  switch (error.code) {
    case "conversation_not_found":
      return {
        code: "ask_conversation_not_found",
        message: "Conversation not found",
        status: 404,
      };
    case "message_not_found":
      return {
        code: "ask_message_not_found",
        message: "Message not found",
        status: 404,
      };
    case "message_not_user":
      return {
        code: "ask_message_not_editable",
        message: "Only sent messages can be edited",
        status: 400,
      };
    case "message_not_assistant":
      return {
        code: "ask_message_not_regeneratable",
        message: "Only received messages can be regenerated",
        status: 400,
      };
  }
}

asks.get("/", async (c) =>
  c.json({
    conversations: await listAskConversations(c.env, c.get("userId")),
  }),
);

asks.post("/", async (c) => {
  const parsed = createAskConversationRequestSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_ask_message",
        "The message is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }
  const conversation = await createAskConversation(
    c.env,
    c.get("userId"),
    parsed.data.message,
  );
  return c.json({ conversation }, 201);
});

asks.get("/:conversationId", async (c) => {
  const conversation = await loadAskConversation(
    c.env,
    c.get("userId"),
    c.req.param("conversationId"),
  );
  if (!conversation) {
    return c.json(
      errorBody(
        "ask_conversation_not_found",
        "Conversation not found",
        c.get("requestId"),
      ),
      404,
    );
  }
  return c.json({ conversation });
});

asks.post("/:conversationId/messages", async (c) => {
  const parsed = createAskMessageRequestSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_ask_message",
        "The message is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }
  try {
    const conversation = await appendAskMessage(
      c.env,
      c.get("userId"),
      c.req.param("conversationId"),
      parsed.data.message,
    );
    return c.json({ conversation }, 201);
  } catch (error) {
    const failure = mutationFailure(error);
    if (!failure) throw error;
    return c.json(
      errorBody(failure.code, failure.message, c.get("requestId")),
      failure.status,
    );
  }
});

asks.patch("/:conversationId/messages/:messageId", async (c) => {
  const parsed = updateAskMessageRequestSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_ask_message",
        "The message is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }
  try {
    const conversation = await updateAskUserMessage(
      c.env,
      c.get("userId"),
      c.req.param("conversationId"),
      c.req.param("messageId"),
      parsed.data.message,
    );
    return c.json({ conversation });
  } catch (error) {
    const failure = mutationFailure(error);
    if (!failure) throw error;
    return c.json(
      errorBody(failure.code, failure.message, c.get("requestId")),
      failure.status,
    );
  }
});

asks.post("/:conversationId/messages/:messageId/regenerate", async (c) => {
  try {
    const conversation = await regenerateAskMessage(
      c.env,
      c.get("userId"),
      c.req.param("conversationId"),
      c.req.param("messageId"),
    );
    return c.json({ conversation });
  } catch (error) {
    const failure = mutationFailure(error);
    if (!failure) throw error;
    return c.json(
      errorBody(failure.code, failure.message, c.get("requestId")),
      failure.status,
    );
  }
});

asks.delete("/:conversationId", async (c) => {
  const deleted = await deleteAskConversation(
    c.env,
    c.get("userId"),
    c.req.param("conversationId"),
  );
  if (!deleted) {
    return c.json(
      errorBody(
        "ask_conversation_not_found",
        "Conversation not found",
        c.get("requestId"),
      ),
      404,
    );
  }
  return c.body(null, 204);
});

export { asks as askRoutes };
