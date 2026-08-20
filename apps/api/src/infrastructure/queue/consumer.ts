import { sendTriggerNotification } from "../../features/triggers/notifications";
import type { Env, JobMessage } from "../../bindings";

async function consumeJob(message: Message<JobMessage>, env: Env) {
  if (message.body.type === "process-media") {
    await env.PROCESS_MEDIA.create({
      id: `media-${message.body.assetId}`,
      params: { assetId: message.body.assetId },
    });
    return;
  }

  if (message.body.type === "process-note") {
    await env.PROCESS_NOTE.create({
      id: `note-${message.body.noteId}-${Date.now()}`,
      params: { noteId: message.body.noteId, userId: message.body.userId },
    });
    return;
  }

  await sendTriggerNotification(
    env,
    message.body.triggerId,
    message.body.userId,
  );
}

export async function consumeJobs(
  batch: MessageBatch<JobMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await consumeJob(message, env);
      message.ack();
    } catch (error) {
      console.error("Job failed", message.id, error);
      message.retry();
    }
  }
}
