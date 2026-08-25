import type { Extraction } from "@lictory/contracts";

/**
 * A deterministic extraction utility retained for fast, pure parser tests.
 * The note workflow always uses the configured AI and never persists this as
 * note understanding.
 */

const STOP_WORDS = new Set([
  "The",
  "A",
  "An",
  "And",
  "But",
  "Or",
  "If",
  "When",
  "While",
  "This",
  "That",
  "These",
  "Those",
  "I",
  "We",
  "You",
  "They",
  "It",
  "My",
  "Our",
  "Your",
  "Their",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "Tomorrow",
  "Today",
  "Yesterday",
  "Next",
  "Last",
]);

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Verbs are matched in either case; the captured name must stay capitalised. */
const anyCase = (words: string[]) =>
  words
    .map(
      (word) =>
        `[${word[0]!.toLowerCase()}${word[0]!.toUpperCase()}]${word.slice(1)}`,
    )
    .join("|");

const NAME = "([A-Z][\\w'’-]*(?:\\s+[A-Z][\\w'’-]*)?)";
const PROPER_NOUN = /\b([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?\b/g;
const PLACE_PREFIX = new RegExp(
  `\\b(?:${anyCase(["at", "in", "near", "from", "to"])})\\s+(?:the\\s+)?([A-Z][\\w'’-]*(?:\\s+[A-Z][\\w'’-]*){0,3})`,
  "g",
);
const PERSON_PREFIX = new RegExp(
  `\\b(?:${anyCase([
    "with",
    "met",
    "meeting",
    "called",
    "call",
    "emailed",
    "email",
    "texted",
    "saw",
    "asked",
    "ask",
  ])})\\s+${NAME}`,
  "g",
);
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?\b/g;
const RELATIVE_DAY = /\b(today|tomorrow|tonight|yesterday)\b/gi;
const NEXT_WEEKDAY =
  /\b(next|this|on)\s+(sun|mon|tues|wednes|thurs|fri|satur)day\b/gi;
const CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;

function unique<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item).toLowerCase();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function atMidnight(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(9, 0, 0, 0);
  return copy;
}

export function heuristicExtraction(
  text: string,
  capturedAt: string,
): Extraction {
  const base = new Date(capturedAt);
  const now = Number.isNaN(base.getTime()) ? new Date() : base;

  const people: Extraction["people"] = [];
  for (const match of text.matchAll(PERSON_PREFIX)) {
    const name = match[1]?.trim();
    if (name && !STOP_WORDS.has(name.split(" ")[0] ?? "")) {
      people.push({ name, mention: match[0], confidence: 0.72 });
    }
  }

  const places: Extraction["places"] = [];
  for (const match of text.matchAll(PLACE_PREFIX)) {
    const name = match[1]?.trim();
    if (name && !STOP_WORDS.has(name.split(" ")[0] ?? "")) {
      places.push({ name, mention: match[0], confidence: 0.64 });
    }
  }

  const times: Extraction["times"] = [];
  for (const match of text.matchAll(ISO_DATE)) {
    const iso = match[2]
      ? `${match[1]}T${match[2]}:00`
      : `${match[1]}T09:00:00`;
    times.push({
      label: match[1] ?? "Scheduled date",
      startsAt: new Date(iso).toISOString(),
      allDay: !match[2],
      kind: "date",
      needsReminder: false,
      mention: match[0],
      confidence: 0.9,
    });
  }
  for (const match of text.matchAll(RELATIVE_DAY)) {
    const word = (match[1] ?? "").toLowerCase();
    const offset = word === "tomorrow" ? 1 : word === "yesterday" ? -1 : 0;
    const date = atMidnight(new Date(now.getTime() + offset * 86_400_000));
    if (word === "tonight") date.setHours(20, 0, 0, 0);
    times.push({
      label: word.charAt(0).toUpperCase() + word.slice(1),
      startsAt: date.toISOString(),
      allDay: word !== "tonight",
      kind: "date",
      needsReminder: false,
      mention: match[0],
      confidence: 0.7,
    });
  }
  for (const match of text.matchAll(NEXT_WEEKDAY)) {
    const target = WEEKDAYS.findIndex((day) =>
      day.startsWith((match[2] ?? "").toLowerCase()),
    );
    if (target < 0) continue;
    const date = atMidnight(now);
    const delta = (target - date.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + delta);
    times.push({
      label: match[0],
      startsAt: date.toISOString(),
      allDay: true,
      kind: "date",
      needsReminder: false,
      mention: match[0],
      confidence: 0.68,
    });
  }
  const clock = [...text.matchAll(CLOCK)][0];
  if (clock && times.length === 0) {
    const hour =
      (Number(clock[1]) % 12) +
      ((clock[3] ?? "").toLowerCase() === "pm" ? 12 : 0);
    const date = new Date(now);
    date.setHours(hour, Number(clock[2] ?? 0), 0, 0);
    times.push({
      label: clock[0] ?? "Time",
      startsAt: date.toISOString(),
      allDay: false,
      kind: "date",
      needsReminder: false,
      mention: clock[0],
      confidence: 0.6,
    });
  }

  const knownNames = new Set(
    [...people, ...places].map((item) => item.name.toLowerCase()),
  );
  const organizations: Extraction["organizations"] = [];
  for (const match of text.matchAll(PROPER_NOUN)) {
    const name = [match[1], match[2]].filter(Boolean).join(" ");
    if (
      name &&
      !STOP_WORDS.has(match[1] ?? "") &&
      !knownNames.has(name.toLowerCase()) &&
      /\b(Inc|Ltd|GmbH|Labs|Studio|Team|Group|Corp|Company)\b/.test(text)
    ) {
      organizations.push({ name, mention: name, confidence: 0.4 });
    }
  }

  const words = text.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? [];
  const frequency = new Map<string, number>();
  for (const word of words) {
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }
  const topics = [...frequency.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({
      name,
      confidence: Math.min(0.6, 0.3 + count * 0.05),
    }));

  const firstSentence =
    text
      .replace(/[#*`>_-]/g, " ")
      .split(/(?<=[.!?])\s/)[0]
      ?.trim()
      .slice(0, 140) ?? "";

  return {
    title: firstSentence
      ? firstSentence.split(" ").slice(0, 8).join(" ")
      : null,
    summary: firstSentence || null,
    analysis: firstSentence || null,
    people: unique(people, (item) => item.name).slice(0, 6),
    places: unique(places, (item) => item.name).slice(0, 6),
    times: unique(times, (item) => item.startsAt ?? item.label).slice(0, 6),
    organizations: unique(organizations, (item) => item.name).slice(0, 4),
    topics,
  };
}
