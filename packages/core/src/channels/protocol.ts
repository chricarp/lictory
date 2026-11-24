import { z } from "zod";
import {
  CHANNEL_ATTACHMENTS_MAX,
  CHANNEL_MESSAGE_MAX,
} from "@lictory/core/channels/shared";

// Arguments of the conversation writer's operations as the browser sends
// them through Zero's `channels.*` mutators (packages/zero/src/mutators.ts).
// The server runs the same writer functions as the capabilities, inside
// Zero's transaction; the actor always comes from the verified session.

const id = z.string().min(1).max(160);
const scope = { organizationId: id, channelId: id };

export const sendMessageArgs = z.object({
  ...scope,
  // The browser's prediction and the stored row share this id.
  messageId: z.uuid(),
  threadRootId: id.nullable().optional(),
  body: z.string().max(CHANNEL_MESSAGE_MAX),
  attachmentIds: z.array(id).max(CHANNEL_ATTACHMENTS_MAX).optional(),
  // Shown in the prediction until the stored row arrives.
  attachments: z
    .array(
      z.object({
        id,
        filename: z.string().max(255),
        mimeType: z.string().max(200),
        size: z.number().int().min(1),
      }),
    )
    .max(CHANNEL_ATTACHMENTS_MAX)
    .optional(),
});
export const editMessageArgs = z.object({
  ...scope,
  messageId: id,
  body: z.string().max(CHANNEL_MESSAGE_MAX),
});
export const deleteMessageArgs = z.object({ ...scope, messageId: id });
export const reactArgs = z.object({
  ...scope,
  messageId: id,
  emoji: z.string().min(1).max(64),
  add: z.boolean(),
});
export const markReadArgs = z.object({
  ...scope,
  sequence: z.number().int().min(0),
  unread: z.boolean().optional(),
});
export const threadArgs = z.object({
  ...scope,
  rootMessageId: id,
  read: z.boolean().optional(),
  following: z.boolean().optional(),
});
