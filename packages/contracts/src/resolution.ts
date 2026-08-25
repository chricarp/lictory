import {
  type AddressParts,
  type EntityType,
  type MomentPrecision,
  type PlacePrecision,
  type TimeKind,
  normalizeEntityKey,
} from "./notes";
import { type MomentRecurrence, nextOccurrence } from "./moments";

/* -------------------------------------------------------------------------- */
/*                            Name canonicalization                           */
/* -------------------------------------------------------------------------- */

/**
 * `normalizeEntityKey` is the identity of a node and must never change meaning
 * without re-sharding the whole graph. Canonicalization is the *widening* layer
 * that sits on top of it: it folds away honorifics, legal suffixes and plurals
 * so that "OpenAI Inc." and "OpenAI" can be recognised as the same thing
 * without either of them losing its own identity key.
 *
 * Everything here is pure and deterministic so it can be unit tested and run
 * identically on every surface.
 */

/** Titles that decorate a person but say nothing about who they are. */
const PERSON_PREFIXES = [
  "mr",
  "mrs",
  "ms",
  "miss",
  "mx",
  "dr",
  "doctor",
  "prof",
  "professor",
  "sir",
  "dame",
  "lord",
  "lady",
  "rev",
  "fr",
  "sig",
  "sig ra",
  "dott",
  "dott ssa",
  "ing",
  "avv",
];

/** Generational and post-nominal noise. */
const PERSON_SUFFIXES = [
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "phd",
  "md",
  "esq",
  "cpa",
];

/**
 * Legal-form suffixes across the jurisdictions we are likely to see. Stripped
 * repeatedly from the tail, so "Acme Holdings Ltd" folds to "acme".
 */
const ORGANIZATION_SUFFIXES = [
  "inc",
  "incorporated",
  "llc",
  "llp",
  "ltd",
  "limited",
  "plc",
  "gmbh",
  "mbh",
  "ag",
  "bv",
  "nv",
  "sa",
  "sas",
  "sarl",
  "spa",
  "srl",
  "srls",
  "snc",
  "sas di",
  "corp",
  "corporation",
  "co",
  "company",
  "group",
  "holding",
  "holdings",
  "partners",
  "oy",
  "ab",
  "as",
  "aps",
  "kft",
  "zrt",
  "doo",
  "pty",
  "kk",
];

/** Leading articles that carry no identity. */
const LEADING_ARTICLES = ["the", "a", "an", "il", "lo", "la", "le", "gli", "i"];

/** Words too generic to serve as an acronym seed or a matching signal. */
const WEAK_TOKENS = new Set([
  "of",
  "and",
  "for",
  "the",
  "de",
  "di",
  "da",
  "del",
  "della",
  "von",
  "van",
  "el",
  "al",
]);

function foldDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/** Lowercase, strip accents, and reduce every separator to a single space. */
export function basicNormalize(value: string): string {
  return foldDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripLeading(tokens: string[], words: string[]): string[] {
  let out = tokens;
  while (out.length > 1 && out[0] !== undefined && words.includes(out[0])) {
    out = out.slice(1);
  }
  return out;
}

function stripTrailing(tokens: string[], words: string[]): string[] {
  let out = tokens;
  while (out.length > 1) {
    const last = out[out.length - 1];
    if (last === undefined || !words.includes(last)) break;
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * Very small English/Italian de-pluralizer. Topics are short thematic tags, so
 * a rule table beats a stemmer here: it is predictable, and a wrong fold on a
 * tag is far cheaper than a wrong fold on a person's name.
 */
function singularize(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (/(ch|sh|ss|x|z|s)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith("ss")) return token;
  if (token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/** Canonical token list for a name, per entity type. */
export function canonicalTokens(type: EntityType, name: string): string[] {
  let tokens = basicNormalize(name).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  tokens = stripLeading(tokens, LEADING_ARTICLES);

  if (type === "person") {
    tokens = stripLeading(tokens, PERSON_PREFIXES);
    tokens = stripTrailing(tokens, PERSON_SUFFIXES);
  }

  if (type === "organization") {
    tokens = stripTrailing(tokens, ORGANIZATION_SUFFIXES);
  }

  if (type === "topic") {
    tokens = tokens.map(singularize);
  }

  return tokens;
}

/**
 * The widened key used for alias lookup. Two names sharing a canonical key are
 * considered the same node without any further evidence.
 */
export function canonicalKey(type: EntityType, name: string): string {
  return canonicalTokens(type, name).join(" ");
}

/** Uppercase-free initialism, e.g. "Massachusetts Institute of Technology" → "mit". */
function acronymOf(tokens: string[]): string | null {
  const strong = tokens.filter((token) => !WEAK_TOKENS.has(token));
  if (strong.length < 3) return null;
  return strong.map((token) => token.slice(0, 1)).join("");
}

/**
 * Alias keys are written to a unique index, so only *unambiguous* variants
 * belong here. A risky variant — "Chris" for "Christian Carpinelli" — would
 * hijack every future Chris, so it is left to `nameMatchScore`, which produces
 * a reviewable suggestion instead of a silent identity.
 */
export function aliasKeysFor(type: EntityType, name: string): string[] {
  const keys = new Set<string>();
  const identity = normalizeEntityKey(type, name);
  if (identity) keys.add(identity);

  const tokens = canonicalTokens(type, name);
  const canonical = tokens.join(" ");
  if (canonical) keys.add(canonical);

  if (type === "person" && tokens.length > 2) {
    // Drop middle names: "Christian Maria Carpinelli" → "christian carpinelli".
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (first && last) keys.add(`${first} ${last}`);
  }

  if (type === "organization") {
    const acronym = acronymOf(tokens);
    if (acronym) keys.add(acronym);
  }

  return [...keys].filter((key) => key.length > 0);
}

/* -------------------------------------------------------------------------- */
/*                               Match scoring                                */
/* -------------------------------------------------------------------------- */

/**
 * Above this, two names are treated as the same node automatically. Reserved
 * for signals that are structural rather than fuzzy: identical canonical form,
 * a full multi-token subset, an organisation acronym, or an initialled surname.
 */
export const AUTO_MERGE_SCORE = 0.9;

/**
 * Above this but below auto-merge, the pair is recorded as a duplicate
 * suspicion for a human to accept or dismiss. Below it, the names are simply
 * different things.
 */
export const SUGGEST_SCORE = 0.6;

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** Sørensen–Dice over character bigrams — catches typos and spelling drift. */
function diceBigrams(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const count = bigrams.get(gram) ?? 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      hits += 1;
    }
  }
  return (2 * hits) / (a.length - 1 + (b.length - 1));
}

function isSubset(small: Set<string>, large: Set<string>): boolean {
  for (const value of small) if (!large.has(value)) return false;
  return true;
}

/** "c carpinelli" against "christian carpinelli". */
function initialledMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  let sawInitial = false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined || right === undefined) return false;
    if (left === right) continue;
    const shorter = left.length < right.length ? left : right;
    const longer = left.length < right.length ? right : left;
    if (shorter.length === 1 && longer.startsWith(shorter)) {
      sawInitial = true;
      continue;
    }
    return false;
  }
  return sawInitial;
}

/**
 * How strongly two names of the same type refer to the same thing, in 0..1.
 * The result is the strongest single signal rather than a blend, so that a
 * decisive structural match is never diluted by weak character overlap.
 */
export function nameMatchScore(
  type: EntityType,
  left: string,
  right: string,
): number {
  const a = canonicalTokens(type, left);
  const b = canonicalTokens(type, right);
  if (a.length === 0 || b.length === 0) return 0;

  const aKey = a.join(" ");
  const bKey = b.join(" ");
  if (aKey === bKey) return 1;

  // A moment's identity is its timestamp, not the words used to describe it.
  // "2026-08-19" and "2026-08-25" share almost every character and are not
  // remotely the same thing, so fuzzy matching is refused outright here.
  if (type === "time") return 0;

  const aSet = new Set(a);
  const bSet = new Set(b);
  const scores: number[] = [jaccard(aSet, bSet) * 0.85];

  const [small, large] = aSet.size <= bSet.size ? [aSet, bSet] : [bSet, aSet];
  if (isSubset(small, large)) {
    // "Acme Robotics" inside "Acme Robotics Europe" is decisive; a lone first
    // name inside a full name is only ever a suggestion.
    scores.push(small.size >= 2 ? 0.93 : 0.72);
  }

  if (type === "person" && initialledMatch(a, b)) scores.push(0.92);

  if (type === "organization") {
    const acronyms = [acronymOf(a), acronymOf(b)];
    if (acronyms[0] !== null && acronyms[0] === bKey) scores.push(0.91);
    if (acronyms[1] !== null && acronyms[1] === aKey) scores.push(0.91);
  }

  // Fuzzy character overlap can suggest, but must never auto-merge on its own.
  scores.push(Math.min(diceBigrams(aKey, bKey), 0.85));

  return Math.max(...scores);
}

/* -------------------------------------------------------------------------- */
/*                                   Places                                   */
/* -------------------------------------------------------------------------- */

const EMPTY_ADDRESS: AddressParts = {
  street: null,
  locality: null,
  region: null,
  postalCode: null,
  country: null,
};

/** Postal codes we can recognise without a country-specific gazetteer. */
const POSTAL_CODE = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}|\d{4,6})\b/i;
const HOUSE_NUMBER = /\d/;

/**
 * Best-effort structural split of a free-text address. It is deliberately
 * conservative: the goal is to recover a *locality* we can match against places
 * the user already has, not to replace a geocoder. Anything it cannot place
 * confidently is left null rather than guessed into the wrong slot.
 */
export function parseAddress(address: string | null | undefined): AddressParts {
  if (!address) return { ...EMPTY_ADDRESS };
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { ...EMPTY_ADDRESS };

  const result: AddressParts = { ...EMPTY_ADDRESS };
  const remaining = [...parts];

  // A trailing segment with no digits reads as a country once there is enough
  // structure in front of it to make that plausible.
  if (remaining.length >= 3) {
    const last = remaining[remaining.length - 1];
    if (last && !HOUSE_NUMBER.test(last)) {
      result.country = last;
      remaining.pop();
    }
  }

  for (let i = remaining.length - 1; i >= 0; i -= 1) {
    const part = remaining[i];
    if (part === undefined) continue;
    const match = POSTAL_CODE.exec(part);
    if (!match?.[1]) continue;
    result.postalCode = match[1].trim();
    const rest = part.replace(match[1], "").trim().replace(/^,|,$/g, "").trim();
    if (rest) result.locality = rest;
    remaining.splice(i, 1);
    break;
  }

  if (!result.locality && remaining.length >= 2) {
    result.locality = remaining[remaining.length - 1] ?? null;
    remaining.pop();
  }

  if (remaining.length > 1) {
    result.region = remaining[remaining.length - 1] ?? null;
    remaining.pop();
  }

  if (remaining.length > 0) result.street = remaining.join(", ");
  if (!result.locality && !result.street && parts[0]) result.street = parts[0];

  return result;
}

/** How specific an address is, which decides whether coordinates can be inherited. */
export function precisionForAddress(parts: AddressParts): PlacePrecision {
  if (parts.street && HOUSE_NUMBER.test(parts.street)) return "exact";
  if (parts.street) return "street";
  if (parts.locality) return "locality";
  if (parts.region) return "region";
  if (parts.country) return "country";
  return "unknown";
}

const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * Geohash gives us a cheap prefix-indexable proximity bucket in SQLite, which
 * is what lets the resolver ask "do I already know a place around here?"
 * without a spatial extension.
 */
export function geohashEncode(
  latitude: number,
  longitude: number,
  precision = 9,
): string {
  let latRange: [number, number] = [-90, 90];
  let lonRange: [number, number] = [-180, 180];
  let hash = "";
  let bits = 0;
  let value = 0;
  let useLongitude = true;

  while (hash.length < precision) {
    const range = useLongitude ? lonRange : latRange;
    const middle = (range[0] + range[1]) / 2;
    const coordinate = useLongitude ? longitude : latitude;
    if (coordinate > middle) {
      value = (value << 1) + 1;
      range[0] = middle;
    } else {
      value = value << 1;
      range[1] = middle;
    }
    if (useLongitude) lonRange = range;
    else latRange = range;
    useLongitude = !useLongitude;

    bits += 1;
    if (bits === 5) {
      hash += GEOHASH_ALPHABET[value] ?? "0";
      bits = 0;
      value = 0;
    }
  }
  return hash;
}

/**
 * Two places this close together, with names that already look alike, are the
 * same place recorded twice. Tuned to a city block rather than a neighbourhood
 * so that neighbouring shops stay distinct.
 */
export const SAME_PLACE_METERS = 150;

/* -------------------------------------------------------------------------- */
/*                                  Moments                                   */
/* -------------------------------------------------------------------------- */

/** How specific the extracted timestamp actually is. */
export function momentPrecision(
  startsAt: string | null | undefined,
  allDay?: boolean | null,
): MomentPrecision {
  if (!startsAt) return "unknown";
  const value = startsAt.trim();
  if (/^\d{4}$/.test(value)) return "year";
  if (/^\d{4}-\d{2}$/.test(value)) return "month";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "day";
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) {
    return allDay ? "day" : "minute";
  }
  return "unknown";
}

/** Minutes east of UTC carried by an ISO string, if it declares one. */
function offsetFromIso(value: string): number | null {
  if (/[zZ]$/.test(value)) return 0;
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(value);
  if (!match) return null;
  const [, sign, hours, minutes] = match;
  if (!sign || !hours || !minutes) return null;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === "-" ? -total : total;
}

/** Minutes east of UTC for an IANA zone at a given instant. */
function offsetForZone(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(at);
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    if (!name) return null;
    if (name === "GMT") return 0;
    const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
    if (!match) return null;
    const [, sign, hours, minutes] = match;
    if (!sign || !hours) return null;
    const total = Number(hours) * 60 + Number(minutes ?? "0");
    return sign === "-" ? -total : total;
  } catch {
    return null;
  }
}

function toIsoWithOffset(utcMillis: number, offsetMinutes: number): string {
  const shifted = new Date(utcMillis + offsetMinutes * 60_000);
  const body = shifted.toISOString().slice(0, 19);
  if (offsetMinutes === 0) return `${body}Z`;
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${body}${sign}${hours}:${minutes}`;
}

/** The hour of the morning an all-day obligation surfaces at. */
const MORNING_HOUR = 9;

export type ReminderInput = {
  kind: TimeKind | null | undefined;
  startsAt: string | null | undefined;
  allDay?: boolean | null;
  needsReminder?: boolean | null;
  timezone?: string | null;
  /** When set, the reminder is derived from the next occurrence, not the anchor. */
  recurrence?: MomentRecurrence | null;
  /** Overrides "now" for the occurrence roll-forward. Tests and re-arming use it. */
  from?: string | number | Date;
};

/**
 * Turns an extracted moment into the instant a notification should fire, or
 * null when the moment is only context and nothing should ever be scheduled.
 *
 * The lead time encodes the moment's *objective*: a deadline warns you the day
 * before so you can still act, an event nudges you shortly before it starts,
 * and an explicit reminder fires exactly when it was asked for. Undated or
 * imprecise moments are never scheduled — a notification with a made-up time is
 * worse than no notification.
 */
export function deriveReminderAt(input: ReminderInput): string | null {
  const { kind } = input;
  const wanted = input.needsReminder === true || kind === "reminder";
  if (!wanted || !input.startsAt) return null;

  // Precision is a property of how the moment was written, so it is read from
  // the anchor; the instant to schedule against is the next occurrence, which
  // is the only reason a birthday anchored in 1990 can ever fire.
  const precision = momentPrecision(input.startsAt, input.allDay);
  if (precision !== "minute" && precision !== "day") return null;

  const startsAt = nextOccurrence(
    input.startsAt,
    input.recurrence ?? null,
    input.from ?? Date.now(),
  );
  if (!startsAt) return null;

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(startsAt.trim());
  const base = new Date(isDateOnly ? `${startsAt.trim()}T00:00:00Z` : startsAt);
  if (Number.isNaN(base.getTime())) return null;

  const offset =
    offsetFromIso(startsAt.trim()) ??
    (input.timezone ? offsetForZone(input.timezone, base) : null) ??
    0;

  if (precision === "day") {
    // Anchor to local midnight, then place the nudge in the morning.
    const localMidnight = isDateOnly
      ? base.getTime() - offset * 60_000
      : Date.UTC(
          base.getUTCFullYear(),
          base.getUTCMonth(),
          base.getUTCDate(),
          0,
          0,
          0,
        ) -
        offset * 60_000;
    const dayOffset = kind === "deadline" ? -1 : 0;
    const at = localMidnight + (dayOffset * 24 + MORNING_HOUR) * 3_600_000;
    return toIsoWithOffset(at, offset);
  }

  const leadMinutes = kind === "deadline" ? 24 * 60 : kind === "event" ? 30 : 0;
  return toIsoWithOffset(base.getTime() - leadMinutes * 60_000, offset);
}
