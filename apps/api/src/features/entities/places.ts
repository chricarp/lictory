import {
  type AddressParts,
  type EntityPlace,
  type PlacePrecision,
  type PlaceSource,
  SAME_PLACE_METERS,
  canonicalKey,
  distanceInMeters,
  geohashEncode,
  nameMatchScore,
  parseAddress,
  precisionForAddress,
} from "@lictory/contracts";
import { eq } from "drizzle-orm";

import type { Env } from "../../bindings";
import { database } from "../../infrastructure/database/client";
import type { EntityPlaceRow } from "../../infrastructure/database/rows";
import { entityPlaces } from "../../infrastructure/database/schema";

/**
 * Precision ordered from most to least specific. Used to decide whether newly
 * learned coordinates are an improvement worth overwriting with.
 */
const PRECISION_RANK: Record<PlacePrecision, number> = {
  exact: 5,
  street: 4,
  locality: 3,
  region: 2,
  country: 1,
  unknown: 0,
};

/** A user's own correction outranks anything the pipeline deduced. */
const SOURCE_RANK: Record<PlaceSource, number> = {
  user: 3,
  geocoder: 2,
  model: 1,
  inherited: 0,
};

export type PlaceFacts = {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  parts?: Partial<AddressParts>;
  /**
   * Who supplied these facts. A coordinate a person typed in outranks anything
   * deduced, and must not be overwritten the next time a note is processed.
   */
  origin?: "ai" | "user";
};

export type ResolvedPlace = {
  address: AddressParts;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  geohash: string | null;
  precision: PlacePrecision;
  source: PlaceSource;
  parentEntityId: string | null;
};

/**
 * Geohash prefix length that brackets roughly a square kilometre. Candidates
 * are narrowed with it in SQL and then measured exactly with haversine, so the
 * bucket only has to be generous, not correct.
 */
const GEOHASH_BUCKET = 5;

/**
 * How alike two place names must be before one lends the other its position.
 * Lower than identity matching on purpose: "Milano" and "Milan" are obviously
 * the same city, and the worst case is an approximate coordinate that is
 * labelled approximate.
 */
const INHERIT_SCORE = 0.8;

/**
 * Works out where a place actually is.
 *
 * Coordinates are taken from the model when it offers them, then from a real
 * geocoder if one is configured, and otherwise inherited from a broader place
 * the user already has — knowing "Via Roma 1, Milano" is somewhere in Milano is
 * far more useful than knowing nothing, as long as the imprecision is recorded
 * rather than hidden. `precision` and `parentEntityId` are what keep an
 * inherited position honest and re-derivable.
 */
export async function resolvePlace(
  env: Env,
  userId: string,
  facts: PlaceFacts,
): Promise<ResolvedPlace> {
  const parsed = parseAddress(facts.address);
  const address: AddressParts = {
    street: facts.parts?.street ?? parsed.street,
    locality: facts.parts?.locality ?? parsed.locality,
    region: facts.parts?.region ?? parsed.region,
    postalCode: facts.parts?.postalCode ?? parsed.postalCode,
    country: facts.parts?.country ?? parsed.country,
  };

  const formattedAddress =
    facts.address?.trim() ||
    [address.street, address.postalCode, address.locality, address.country]
      .filter(Boolean)
      .join(", ") ||
    null;

  const hasModelCoordinates =
    typeof facts.latitude === "number" && typeof facts.longitude === "number";

  if (hasModelCoordinates) {
    const latitude = facts.latitude as number;
    const longitude = facts.longitude as number;
    return {
      address,
      formattedAddress,
      latitude,
      longitude,
      geohash: geohashEncode(latitude, longitude),
      // The model volunteered a position, so the address decides how precisely
      // that position describes the place rather than defaulting to "exact".
      precision:
        precisionForAddress(address) === "unknown"
          ? "locality"
          : precisionForAddress(address),
      source: facts.origin === "user" ? "user" : "model",
      parentEntityId: null,
    };
  }

  const geocoded = await geocode(env, formattedAddress);
  if (geocoded) {
    return {
      address,
      formattedAddress,
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
      geohash: geohashEncode(geocoded.latitude, geocoded.longitude),
      precision: precisionForAddress(address),
      source: "geocoder",
      parentEntityId: null,
    };
  }

  const inherited = await inheritFromKnownPlace(
    env,
    userId,
    address,
    facts.name,
  );
  if (inherited) {
    return {
      address,
      formattedAddress,
      latitude: inherited.latitude,
      longitude: inherited.longitude,
      geohash: geohashEncode(inherited.latitude, inherited.longitude),
      // An inherited coordinate is only ever as good as the place it came from,
      // and never better than a locality.
      precision: "locality",
      source: "inherited",
      parentEntityId: inherited.entityId,
    };
  }

  return {
    address,
    formattedAddress,
    latitude: null,
    longitude: null,
    geohash: null,
    precision: precisionForAddress(address),
    source: facts.origin === "user" ? "user" : "model",
    parentEntityId: null,
  };
}

/**
 * Borrows coordinates from a broader place the user already has. The locality
 * is the useful handle: it is what an address reliably yields and what people
 * actually name as a separate place.
 *
 * The match is scored rather than exact because localities are written every
 * which way — a note saying "Milano" should still find the "Milan" the user
 * already has. The bar is deliberately lower than for identity, since the
 * result is only ever recorded as an approximate position, never as the place
 * itself.
 */
async function inheritFromKnownPlace(
  env: Env,
  userId: string,
  address: AddressParts,
  name: string,
): Promise<{ latitude: number; longitude: number; entityId: string } | null> {
  const target = address.locality ?? address.region ?? address.country;
  if (!target) return null;

  const key = canonicalKey("place", target);
  if (!key) return null;
  // A place cannot inherit from itself.
  if (canonicalKey("place", name) === key) return null;

  const { results } = await env.DB.prepare(
    `SELECT p.entity_id AS entity_id, p.latitude AS latitude, p.longitude AS longitude,
            p.locality AS locality, p.precision AS precision, e.name AS name
       FROM entity_places p
       JOIN entities e ON e.id = p.entity_id
      WHERE p.user_id = ? AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
      LIMIT 200`,
  )
    .bind(userId)
    .all<{
      entity_id: string;
      latitude: number;
      longitude: number;
      locality: string | null;
      precision: string;
      name: string;
    }>();

  let best: {
    latitude: number;
    longitude: number;
    entityId: string;
    score: number;
  } | null = null;

  for (const row of results ?? []) {
    const score = Math.max(
      nameMatchScore("place", target, row.name),
      row.locality ? nameMatchScore("place", target, row.locality) : 0,
    );
    if (score < INHERIT_SCORE) continue;
    // Prefer a broader place: a city's centre describes an address in it far
    // better than another specific address in the same city does.
    const weighted = score + (row.precision === "locality" ? 0.05 : 0);
    if (!best || weighted > best.score) {
      best = {
        latitude: row.latitude,
        longitude: row.longitude,
        entityId: row.entity_id,
        score: weighted,
      };
    }
  }

  if (!best) return null;
  return {
    latitude: best.latitude,
    longitude: best.longitude,
    entityId: best.entityId,
  };
}

/**
 * Optional forward geocoding. Deliberately absent in local development so the
 * pipeline needs no key to run, and deliberately non-fatal: a place without
 * coordinates is a smaller problem than a note that fails to process.
 */
async function geocode(
  env: Env,
  address: string | null,
): Promise<{ latitude: number; longitude: number } | null> {
  if (!env.GEOCODER_URL || !address) return null;
  try {
    const url = env.GEOCODER_URL.includes("{query}")
      ? env.GEOCODER_URL.replace("{query}", encodeURIComponent(address))
      : `${env.GEOCODER_URL}${env.GEOCODER_URL.includes("?") ? "&" : "?"}q=${encodeURIComponent(address)}`;

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        ...(env.GEOCODER_TOKEN
          ? { authorization: `Bearer ${env.GEOCODER_TOKEN}` }
          : {}),
      },
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    const first = Array.isArray(payload)
      ? payload[0]
      : ((payload as { results?: unknown[] })?.results?.[0] ?? null);
    if (!first || typeof first !== "object") return null;

    const record = first as Record<string, unknown>;
    const latitude = Number(record.lat ?? record.latitude);
    const longitude = Number(record.lon ?? record.lng ?? record.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}

/**
 * Finds a place the user already has that sits essentially on top of this one.
 * Proximity alone is not enough — two shops share a doorway — so the name still
 * has to look like the same thing.
 */
export async function findPlaceByProximity(
  env: Env,
  userId: string,
  name: string,
  latitude: number,
  longitude: number,
  threshold: number,
): Promise<{ entityId: string; score: number } | null> {
  const bucket = geohashEncode(latitude, longitude, GEOHASH_BUCKET);

  const rows = await env.DB.prepare(
    `SELECT p.entity_id AS entity_id, p.latitude AS latitude, p.longitude AS longitude, e.name AS name
       FROM entity_places p
       JOIN entities e ON e.id = p.entity_id
      WHERE p.user_id = ?
        AND p.latitude IS NOT NULL
        AND substr(p.geohash, 1, ?) = ?
      LIMIT 50`,
  )
    .bind(userId, GEOHASH_BUCKET, bucket)
    .all<{
      entity_id: string;
      latitude: number;
      longitude: number;
      name: string;
    }>();

  let best: { entityId: string; score: number } | null = null;
  for (const row of rows.results ?? []) {
    const metres = distanceInMeters(
      { latitude, longitude },
      { latitude: row.latitude, longitude: row.longitude },
    );
    if (metres > SAME_PLACE_METERS) continue;
    const score = nameMatchScore("place", name, row.name);
    if (score < threshold) continue;
    if (!best || score > best.score) {
      best = { entityId: row.entity_id, score };
    }
  }
  return best;
}

/**
 * Writes the place facet, keeping whichever coordinate is better sourced and
 * more precise. Address components merge field by field so a note that only
 * mentions the city never erases a street already learned elsewhere.
 */
export async function upsertPlaceFacet(
  env: Env,
  userId: string,
  entityId: string,
  resolved: ResolvedPlace,
): Promise<void> {
  const db = database(env);
  const now = new Date().toISOString();

  const existing = await db
    .select()
    .from(entityPlaces)
    .where(eq(entityPlaces.entity_id, entityId))
    .get();

  if (!existing) {
    await db
      .insert(entityPlaces)
      .values({
        entity_id: entityId,
        user_id: userId,
        formatted_address: resolved.formattedAddress,
        street: resolved.address.street,
        locality: resolved.address.locality,
        region: resolved.address.region,
        postal_code: resolved.address.postalCode,
        country: resolved.address.country,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        geohash: resolved.geohash,
        precision: resolved.precision,
        source: resolved.source,
        parent_entity_id: resolved.parentEntityId,
        created_at: now,
        updated_at: now,
      })
      .onConflictDoNothing();
    return;
  }

  // Keep the better-sourced position, and among equals the more precise one.
  // A user's correction is therefore never undone by re-processing a note.
  const incomingRank = SOURCE_RANK[resolved.source];
  const existingRank = SOURCE_RANK[existing.source];
  const hasIncoming = resolved.latitude !== null && resolved.longitude !== null;
  const hasExisting = existing.latitude !== null && existing.longitude !== null;

  const takeIncoming =
    hasIncoming &&
    (!hasExisting ||
      incomingRank > existingRank ||
      // An inherited position is a derivation, not a fact. Re-deriving it keeps
      // it in step with the parent place it was borrowed from.
      (resolved.source === "inherited" && existing.source === "inherited") ||
      (incomingRank === existingRank &&
        PRECISION_RANK[resolved.precision] >
          PRECISION_RANK[existing.precision]));

  // Precision describes how specifically the place is pinned down, which a
  // better address improves even when no new coordinates arrive. Without this,
  // a place that only ever learns its street stays reported as "unknown".
  const nextPrecision = takeIncoming
    ? resolved.precision
    : !hasExisting &&
        PRECISION_RANK[resolved.precision] > PRECISION_RANK[existing.precision]
      ? resolved.precision
      : existing.precision;

  await db
    .update(entityPlaces)
    .set({
      formatted_address:
        resolved.formattedAddress ?? existing.formatted_address,
      street: resolved.address.street ?? existing.street,
      locality: resolved.address.locality ?? existing.locality,
      region: resolved.address.region ?? existing.region,
      postal_code: resolved.address.postalCode ?? existing.postal_code,
      country: resolved.address.country ?? existing.country,
      latitude: takeIncoming ? resolved.latitude : existing.latitude,
      longitude: takeIncoming ? resolved.longitude : existing.longitude,
      geohash: takeIncoming ? resolved.geohash : existing.geohash,
      precision: nextPrecision,
      source: takeIncoming ? resolved.source : existing.source,
      parent_entity_id: takeIncoming
        ? resolved.parentEntityId
        : existing.parent_entity_id,
      updated_at: now,
    })
    .where(eq(entityPlaces.entity_id, entityId));
}

/** Row → contract shape for the place facet. */
export function placeRecord(row: EntityPlaceRow): EntityPlace {
  return {
    formattedAddress: row.formatted_address,
    street: row.street,
    locality: row.locality,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    geohash: row.geohash,
    precision: row.precision,
    source: row.source,
    parentEntityId: row.parent_entity_id,
  };
}
