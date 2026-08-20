import type { Env } from "../../bindings";
import type { TriggerRow } from "../../infrastructure/database/rows";

type DeviceTokenRow = { token: string };

export async function sendTriggerNotification(
  env: Env,
  triggerId: string,
  userId: string,
): Promise<void> {
  const trigger = await env.DB.prepare(
    "SELECT * FROM triggers WHERE id = ? AND user_id = ? AND status = 'active'",
  )
    .bind(triggerId, userId)
    .first<TriggerRow>();
  if (!trigger) return;

  const { results: devices } = await env.DB.prepare(
    "SELECT token FROM device_tokens WHERE user_id = ?",
  )
    .bind(userId)
    .all<DeviceTokenRow>();

  if (devices.length > 0) {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(
        devices.map(({ token }) => ({
          to: token,
          title: trigger.title,
          body: trigger.body,
          sound: "default",
          data: { triggerId: trigger.id, triggerType: trigger.type },
        })),
      ),
    });
    if (!response.ok) {
      throw new Error(`Expo Push rejected the batch (${response.status})`);
    }
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE triggers SET status = 'triggered', triggered_at = ? WHERE id = ? AND status = 'active'",
  )
    .bind(now, trigger.id)
    .run();
}
