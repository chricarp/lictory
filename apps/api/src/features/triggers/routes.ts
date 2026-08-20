import {
  createTriggerRequestSchema,
  isInsideGeofence,
  locationEventRequestSchema,
  registerDeviceRequestSchema,
} from "@lictory/contracts";
import { Hono } from "hono";

import type { AppBindings } from "../../bindings";
import { errorBody } from "../../http/errors";
import { triggerRecord } from "../../infrastructure/database/records";
import type { TriggerRow } from "../../infrastructure/database/rows";

const triggers = new Hono<AppBindings>();

triggers.get("/triggers", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM triggers WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
  )
    .bind(c.get("userId"))
    .all<TriggerRow>();
  return c.json({ triggers: results.map(triggerRecord) });
});

triggers.post("/triggers", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const parsed = createTriggerRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_trigger",
        "The trigger is invalid",
        c.get("requestId"),
        parsed.error.flatten(),
      ),
      400,
    );
  }
  if (
    parsed.data.type === "time" &&
    Date.parse(parsed.data.scheduledFor) <= Date.now()
  ) {
    return c.json(
      errorBody(
        "trigger_in_past",
        "scheduledFor must be in the future",
        c.get("requestId"),
      ),
      400,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const time = parsed.data.type === "time" ? parsed.data : null;
  const location = parsed.data.type === "location" ? parsed.data : null;
  const noteId = typeof body.noteId === "string" ? body.noteId : null;
  const entityId = typeof body.entityId === "string" ? body.entityId : null;

  await c.env.DB.prepare(
    `INSERT INTO triggers
      (id, user_id, type, status, title, body, scheduled_for, timezone, location_label,
       latitude, longitude, radius_meters, location_event, note_id, entity_id, created_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      c.get("userId"),
      parsed.data.type,
      parsed.data.title,
      parsed.data.body,
      time?.scheduledFor ?? null,
      time?.timezone ?? null,
      location?.label ?? null,
      location?.latitude ?? null,
      location?.longitude ?? null,
      location?.radiusMeters ?? null,
      location?.event ?? null,
      noteId,
      entityId,
      now,
    )
    .run();

  if (time) {
    await c.env.FIRE_TRIGGER.create({
      id: `trigger-${id}`,
      params: { triggerId: id, scheduledFor: time.scheduledFor },
    });
  }

  const row = await c.env.DB.prepare("SELECT * FROM triggers WHERE id = ?")
    .bind(id)
    .first<TriggerRow>();
  if (!row) throw new Error("The trigger row was not persisted");
  return c.json({ trigger: triggerRecord(row) }, 201);
});

triggers.post("/devices", async (c) => {
  const parsed = registerDeviceRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_device",
        "The device token is invalid",
        c.get("requestId"),
      ),
      400,
    );
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO device_tokens (id, user_id, token, platform, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(),
      c.get("userId"),
      parsed.data.token,
      parsed.data.platform,
      now,
      now,
    )
    .run();
  return c.json({ registered: true as const });
});

triggers.post("/location-events", async (c) => {
  const parsed = locationEventRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      errorBody(
        "invalid_location_event",
        "The location event is invalid",
        c.get("requestId"),
      ),
      400,
    );
  }
  const userId = c.get("userId");
  await c.env.DB.prepare(
    `INSERT INTO location_events
      (id, user_id, trigger_id, event, latitude, longitude, occurred_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      parsed.data.triggerId ?? null,
      parsed.data.event,
      parsed.data.latitude,
      parsed.data.longitude,
      parsed.data.occurredAt,
      new Date().toISOString(),
    )
    .run();

  const query = parsed.data.triggerId
    ? "SELECT * FROM triggers WHERE id = ? AND user_id = ? AND type = 'location' AND status = 'active' AND location_event = ?"
    : "SELECT * FROM triggers WHERE user_id = ? AND type = 'location' AND status = 'active' AND location_event = ?";
  const statement = parsed.data.triggerId
    ? c.env.DB.prepare(query).bind(
        parsed.data.triggerId,
        userId,
        parsed.data.event,
      )
    : c.env.DB.prepare(query).bind(userId, parsed.data.event);
  const { results } = await statement.all<TriggerRow>();

  const matches = results.filter((trigger) => {
    // Trigger-specific events were already evaluated by the OS geofencer.
    if (parsed.data.triggerId) return true;
    if (
      trigger.latitude === null ||
      trigger.longitude === null ||
      trigger.radius_meters === null
    ) {
      return false;
    }
    const inside = isInsideGeofence(
      { latitude: parsed.data.latitude, longitude: parsed.data.longitude },
      { latitude: trigger.latitude, longitude: trigger.longitude },
      trigger.radius_meters,
    );
    return parsed.data.event === "enter" ? inside : !inside;
  });

  await Promise.all(
    matches.map((trigger) =>
      c.env.JOBS.send({
        type: "send-notification",
        triggerId: trigger.id,
        userId,
      }),
    ),
  );
  return c.json({ matched: matches.length });
});

export { triggers as triggerRoutes };
