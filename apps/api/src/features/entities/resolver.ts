import {
  AUTO_MERGE_SCORE,
  type EntityInput,
  type EntityType,
  SUGGEST_SCORE,
  aliasKeysFor,
  nameMatchScore,
  normalizeEntityKey,
} from "@lictory/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { Env } from "../../bindings";
import { database } from "../../infrastructure/database/client";
import type { EntityRow } from "../../infrastructure/database/rows";
import {
  entityAliases,
  entityDuplicates,
  entities as entitiesTable,
} from "../../infrastructure/database/schema";
import { findPlaceByProximity, resolvePlace, upsertPlaceFacet } from "./places";
import { type ResolvedMoment, resolveMoment } from "./moments";

const ENTITY_COLORS: Record<EntityType, string> = {
  person: "#f4a261",
  place: "#5eead4",
  time: "#a78bfa",
  topic: "#93c5fd",
  organization: "#fca5a5",
};

/** How the incoming mention found its node — surfaced so resolution is legible. */
export type MatchKind =
  "identity" | "alias" | "similarity" | "proximity" | "created";

export type ResolveResult = {
  row: EntityRow;
  match: MatchKind;
  /** A near-miss recorded for a human to judge, rather than acted on. */
  suspected: boolean;
  /** The normalized moment, when the entity is a time. */
  moment: ResolvedMoment | null;
};

/**
 * Scanning every same-type entity is fine for a personal graph — a heavy user
 * has hundreds of people, not millions — but the cap keeps a pathological
 * account from turning one mention into an unbounded query.
 */
const CANDIDATE_LIMIT = 400;

/**
 * Resolves an extracted mention onto exactly one node in the user's graph.
 *
 * Identity is decided in order of how much evidence each signal carries:
 *
 *   1. the exact identity key, unchanged from before so no existing graph moves;
 *   2. the alias index, which folds away legal suffixes, honorifics, plurals
 *      and acronyms — "OpenAI Inc." lands on OpenAI;
 *   3. name similarity, which auto-merges only on structural matches and
 *      otherwise records a duplicate suspicion for a human;
 *   4. for places, physical proximity, because the same café written two ways
 *      is still one café.
 *
 * Anything it cannot place confidently becomes a new node plus a reviewable
 * suspicion. Silently fusing two people who share a first name is the one
 * mistake the graph cannot recover from, so the resolver never makes it.
 */
export async function resolveEntity(
  env: Env,
  userId: string,
  input: EntityInput,
  origin: "ai" | "user" = "ai",
): Promise<ResolveResult> {
  const identityKey = normalizeEntityKey(input.type, input.name);
  if (!identityKey) throw new Error("Entity name cannot be empty");

  const db = database(env);
  const aliasKeys = aliasKeysFor(input.type, input.name);

  // Places are the one type whose identity is physical as well as textual, so
  // their coordinates have to be worked out before we can ask what they are.
  const place =
    input.type === "place"
      ? await resolvePlace(env, userId, {
          name: input.name,
          address: input.address,
          latitude: input.latitude,
          longitude: input.longitude,
          parts: {
            street: input.street,
            locality: input.locality,
            region: input.region,
            postalCode: input.postalCode,
            country: input.country,
          },
          origin,
        })
      : null;

  const found = await findExisting(
    env,
    userId,
    input,
    identityKey,
    aliasKeys,
    place?.latitude ?? null,
    place?.longitude ?? null,
  );

  const row = found.row
    ? await enrich(env, found.row, input, origin)
    : await create(env, userId, input, identityKey, origin);

  const match: MatchKind = found.row ? found.match : "created";

  await writeAliases(env, userId, input.type, row.id, aliasKeys, origin);

  if (place) await upsertPlaceFacet(env, userId, row.id, place);

  const moment =
    input.type === "time"
      ? resolveMoment({
          kind: input.timeKind ?? row.time_kind,
          startsAt: input.startsAt ?? row.starts_at,
          endsAt: input.endsAt ?? row.ends_at,
          allDay: input.allDay ?? row.all_day === 1,
          timezone: input.timezone ?? row.timezone,
          recurrenceText: input.recurrence ?? row.recurrence,
          recurrence: input.recurrenceRule ?? null,
          needsReminder: input.needsReminder ?? row.needs_reminder === 1,
          reminderReason: input.reminderReason ?? row.reminder_reason,
        })
      : null;

  let suspected = false;
  if (found.suspect && found.suspect.entityId !== row.id) {
    suspected = await recordSuspicion(
      env,
      userId,
      input.type,
      row.id,
      found.suspect.entityId,
      found.suspect.score,
      found.suspect.reason,
    );
  }

  return { row, match, suspected, moment };
}

type Found = {
  row: EntityRow | null;
  match: MatchKind;
  suspect: {
    entityId: string;
    score: number;
    reason: string;
  } | null;
};

async function findExisting(
  env: Env,
  userId: string,
  input: EntityInput,
  identityKey: string,
  aliasKeys: string[],
  latitude: number | null,
  longitude: number | null,
): Promise<Found> {
  const db = database(env);

  const identityHit = await db
    .select()
    .from(entitiesTable)
    .where(
      and(
        eq(entitiesTable.user_id, userId),
        eq(entitiesTable.type, input.type),
        eq(entitiesTable.normalized_key, identityKey),
      ),
    )
    .get();
  if (identityHit) {
    return { row: identityHit, match: "identity", suspect: null };
  }

  if (aliasKeys.length > 0) {
    const aliasHit = await db
      .select({ entity: entitiesTable })
      .from(entityAliases)
      .innerJoin(entitiesTable, eq(entitiesTable.id, entityAliases.entity_id))
      .where(
        and(
          eq(entityAliases.user_id, userId),
          eq(entityAliases.type, input.type),
          inArray(entityAliases.alias_key, aliasKeys),
        ),
      )
      .get();
    if (aliasHit?.entity) {
      return { row: aliasHit.entity, match: "alias", suspect: null };
    }
  }

  // Same place, different words: coordinates settle it where names cannot.
  if (input.type === "place" && latitude !== null && longitude !== null) {
    const near = await findPlaceByProximity(
      env,
      userId,
      input.name,
      latitude,
      longitude,
      SUGGEST_SCORE,
    );
    if (near) {
      const row = await db
        .select()
        .from(entitiesTable)
        .where(eq(entitiesTable.id, near.entityId))
        .get();
      if (row) return { row, match: "proximity", suspect: null };
    }
  }

  const candidates = await db
    .select({
      id: entitiesTable.id,
      name: entitiesTable.name,
    })
    .from(entitiesTable)
    .where(
      and(
        eq(entitiesTable.user_id, userId),
        eq(entitiesTable.type, input.type),
      ),
    )
    .limit(CANDIDATE_LIMIT);

  let best: { id: string; name: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = nameMatchScore(input.type, input.name, candidate.name);
    if (score < SUGGEST_SCORE) continue;
    if (!best || score > best.score) {
      best = { id: candidate.id, name: candidate.name, score };
    }
  }

  if (!best) return { row: null, match: "created", suspect: null };

  if (best.score >= AUTO_MERGE_SCORE) {
    const row = await db
      .select()
      .from(entitiesTable)
      .where(eq(entitiesTable.id, best.id))
      .get();
    if (row) return { row, match: "similarity", suspect: null };
  }

  return {
    row: null,
    match: "created",
    suspect: {
      entityId: best.id,
      score: best.score,
      reason: `"${input.name}" looks like "${best.name}"`,
    },
  };
}

/**
 * Merges newly learned attributes onto an existing node. A null never erases a
 * value that is already known, which is what lets a passing mention enrich a
 * place without a later vaguer mention hollowing it out again.
 */
async function enrich(
  env: Env,
  existing: EntityRow,
  input: EntityInput,
  origin: "ai" | "user",
): Promise<EntityRow> {
  const now = new Date().toISOString();
  const merged: EntityRow = {
    ...existing,
    // Topics are intentionally name-only. Clearing a legacy value while the
    // node is touched prevents old extraction prose from lingering forever.
    description:
      input.type === "topic"
        ? null
        : (input.description ?? existing.description),
    latitude: input.latitude ?? existing.latitude,
    longitude: input.longitude ?? existing.longitude,
    radius_meters: input.radiusMeters ?? existing.radius_meters,
    address: input.address ?? existing.address,
    starts_at: input.startsAt ?? existing.starts_at,
    ends_at: input.endsAt ?? existing.ends_at,
    all_day:
      input.allDay === undefined || input.allDay === null
        ? existing.all_day
        : Number(input.allDay),
    timezone: input.timezone ?? existing.timezone,
    recurrence: input.recurrence ?? existing.recurrence,
    time_kind: input.timeKind ?? existing.time_kind,
    needs_reminder:
      input.needsReminder === undefined || input.needsReminder === null
        ? existing.needs_reminder
        : Number(input.needsReminder),
    reminder_reason: input.reminderReason ?? existing.reminder_reason,
    color: input.color ?? existing.color,
    // A human curating the graph promotes the entity out of "AI guessed it".
    origin: origin === "user" ? "user" : existing.origin,
    updated_at: now,
  };

  await database(env)
    .update(entitiesTable)
    .set({
      description: merged.description,
      latitude: merged.latitude,
      longitude: merged.longitude,
      radius_meters: merged.radius_meters,
      address: merged.address,
      starts_at: merged.starts_at,
      ends_at: merged.ends_at,
      all_day: merged.all_day,
      timezone: merged.timezone,
      recurrence: merged.recurrence,
      time_kind: merged.time_kind,
      needs_reminder: merged.needs_reminder,
      reminder_reason: merged.reminder_reason,
      color: merged.color,
      origin: merged.origin,
      updated_at: now,
    })
    .where(eq(entitiesTable.id, existing.id));

  return merged;
}

async function create(
  env: Env,
  userId: string,
  input: EntityInput,
  identityKey: string,
  origin: "ai" | "user",
): Promise<EntityRow> {
  const db = database(env);
  const now = new Date().toISOString();

  const row: EntityRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    type: input.type,
    name: input.name.trim(),
    normalized_key: identityKey,
    description: input.type === "topic" ? null : (input.description ?? null),
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    radius_meters: input.radiusMeters ?? (input.type === "place" ? 250 : null),
    address: input.address ?? null,
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
    all_day: Number(input.allDay ?? false),
    timezone: input.timezone ?? null,
    recurrence: input.recurrence ?? null,
    time_kind: input.timeKind ?? null,
    needs_reminder: Number(input.needsReminder ?? false),
    reminder_reason: input.reminderReason ?? null,
    color: input.color ?? ENTITY_COLORS[input.type],
    origin,
    created_at: now,
    updated_at: now,
  };

  await db
    .insert(entitiesTable)
    .values(row)
    .onConflictDoNothing({
      target: [
        entitiesTable.user_id,
        entitiesTable.type,
        entitiesTable.normalized_key,
      ],
    });

  // A concurrent insert may have won the identity index; read back so both
  // writers agree on which row is the node.
  const stored = await db
    .select()
    .from(entitiesTable)
    .where(
      and(
        eq(entitiesTable.user_id, userId),
        eq(entitiesTable.type, input.type),
        eq(entitiesTable.normalized_key, identityKey),
      ),
    )
    .get();

  return stored ?? row;
}

/**
 * Indexes the surface forms this entity can be recognised by. `DO NOTHING` on
 * the unique index means the first entity to claim an alias keeps it: a later
 * node never steals a name out from under an earlier one.
 */
async function writeAliases(
  env: Env,
  userId: string,
  type: EntityType,
  entityId: string,
  aliasKeys: string[],
  origin: "ai" | "user",
): Promise<void> {
  if (aliasKeys.length === 0) return;
  const now = new Date().toISOString();

  await database(env)
    .insert(entityAliases)
    .values(
      aliasKeys.map((alias) => ({
        id: crypto.randomUUID(),
        user_id: userId,
        type,
        alias_key: alias,
        entity_id: entityId,
        source: origin === "user" ? ("user" as const) : ("derived" as const),
        created_at: now,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Records a pair the resolver could not separate confidently. Stored under a
 * stable ordering so the same pair seen from either direction is one row, and
 * never re-opened once a human has dismissed it.
 */
async function recordSuspicion(
  env: Env,
  userId: string,
  type: EntityType,
  entityId: string,
  candidateId: string,
  score: number,
  reason: string,
): Promise<boolean> {
  const [first, second] =
    entityId < candidateId ? [entityId, candidateId] : [candidateId, entityId];

  const result = await database(env)
    .insert(entityDuplicates)
    .values({
      id: crypto.randomUUID(),
      user_id: userId,
      type,
      entity_id: first,
      candidate_entity_id: second,
      score,
      reason,
      status: "open",
      created_at: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [
        entityDuplicates.entity_id,
        entityDuplicates.candidate_entity_id,
      ],
      // Only sharpen the score; a dismissed pair stays dismissed.
      set: { score: sql`max(${entityDuplicates.score}, excluded.score)` },
    });

  return (result.meta?.changes ?? 0) > 0;
}

/** Re-derives the alias index for an entity after a human renames it. */
export async function reindexAliases(
  env: Env,
  userId: string,
  entity: EntityRow,
): Promise<void> {
  const db = database(env);
  await db.delete(entityAliases).where(eq(entityAliases.entity_id, entity.id));
  await writeAliases(
    env,
    userId,
    entity.type,
    entity.id,
    aliasKeysFor(entity.type, entity.name),
    "user",
  );
}
