import { describe, expect, it } from "vitest";
import {
  AUTO_MERGE_SCORE,
  SUGGEST_SCORE,
  aliasKeysFor,
  canonicalKey,
  deriveReminderAt,
  geohashEncode,
  momentPrecision,
  nameMatchScore,
  parseAddress,
  precisionForAddress,
} from "./resolution";

describe("canonicalKey", () => {
  it("folds honorifics and generational suffixes out of a person", () => {
    expect(canonicalKey("person", "Dr. Christian Carpinelli Jr.")).toBe(
      "christian carpinelli",
    );
    expect(canonicalKey("person", "CHRISTIAN  CARPINELLI")).toBe(
      "christian carpinelli",
    );
  });

  it("folds legal suffixes out of an organisation", () => {
    expect(canonicalKey("organization", "OpenAI, Inc.")).toBe("openai");
    expect(canonicalKey("organization", "Acme Holdings Ltd")).toBe("acme");
    expect(canonicalKey("organization", "The Acme Company")).toBe("acme");
  });

  it("singularizes topics so tags collapse", () => {
    expect(canonicalKey("topic", "Standups")).toBe("standup");
    expect(canonicalKey("topic", "dependencies")).toBe("dependency");
    expect(canonicalKey("topic", "taxes")).toBe("tax");
  });

  it("never strips a suffix down to nothing", () => {
    expect(canonicalKey("organization", "Group")).toBe("group");
    expect(canonicalKey("person", "Dr")).toBe("dr");
  });

  it("folds accents", () => {
    expect(canonicalKey("place", "Café Zürich")).toBe("cafe zurich");
  });
});

describe("aliasKeysFor", () => {
  it("indexes the middle-name-free form of a person", () => {
    const keys = aliasKeysFor("person", "Christian Maria Carpinelli");
    expect(keys).toContain("christian maria carpinelli");
    expect(keys).toContain("christian carpinelli");
  });

  it("indexes an organisation acronym only when it is unambiguous", () => {
    expect(
      aliasKeysFor("organization", "Massachusetts Institute of Technology"),
    ).toContain("mit");
    // Two tokens is too little signal to claim an acronym.
    expect(aliasKeysFor("organization", "Open AI")).not.toContain("oa");
  });

  it("does not index a bare first name as an alias", () => {
    // "chris" must stay a scored suggestion, never a hijackable identity.
    expect(aliasKeysFor("person", "Chris Carpinelli")).not.toContain("chris");
  });
});

describe("nameMatchScore", () => {
  it("auto-merges an organisation across its legal suffix", () => {
    expect(nameMatchScore("organization", "OpenAI Inc.", "OpenAI")).toBe(1);
  });

  it("auto-merges an initialled surname", () => {
    expect(
      nameMatchScore("person", "C. Carpinelli", "Christian Carpinelli"),
    ).toBeGreaterThanOrEqual(AUTO_MERGE_SCORE);
  });

  it("auto-merges a multi-token subset", () => {
    expect(
      nameMatchScore("organization", "Acme Robotics", "Acme Robotics Europe"),
    ).toBeGreaterThanOrEqual(AUTO_MERGE_SCORE);
  });

  it("only suggests when a bare first name matches a full name", () => {
    const score = nameMatchScore("person", "Chris", "Chris Carpinelli");
    expect(score).toBeGreaterThanOrEqual(SUGGEST_SCORE);
    expect(score).toBeLessThan(AUTO_MERGE_SCORE);
  });

  it("suggests but never auto-merges on a typo alone", () => {
    const score = nameMatchScore("person", "Cristian Rossi", "Christian Rossi");
    expect(score).toBeGreaterThanOrEqual(SUGGEST_SCORE);
    expect(score).toBeLessThan(AUTO_MERGE_SCORE);
  });

  it("refuses to fuzzy-match moments, whose identity is the timestamp", () => {
    // These share almost every character and are different days.
    expect(nameMatchScore("time", "2026-08-19", "2026-08-25")).toBe(0);
    expect(nameMatchScore("time", "2026-08-19", "2026-08-19")).toBe(1);
  });

  it("keeps genuinely different people apart", () => {
    expect(
      nameMatchScore("person", "Marco Rossi", "Giulia Bianchi"),
    ).toBeLessThan(SUGGEST_SCORE);
  });

  it("resolves an organisation acronym against its expansion", () => {
    expect(
      nameMatchScore(
        "organization",
        "MIT",
        "Massachusetts Institute of Technology",
      ),
    ).toBeGreaterThanOrEqual(AUTO_MERGE_SCORE);
  });
});

describe("parseAddress", () => {
  it("splits a full street address", () => {
    expect(parseAddress("Via Roma 1, 20121 Milano, Italy")).toEqual({
      street: "Via Roma 1",
      locality: "Milano",
      region: null,
      postalCode: "20121",
      country: "Italy",
    });
  });

  it("recovers a locality without a postal code", () => {
    expect(parseAddress("Piazza Duomo, Milano")).toMatchObject({
      street: "Piazza Duomo",
      locality: "Milano",
    });
  });

  it("treats a lone segment as a street", () => {
    expect(parseAddress("Via Roma 1")).toMatchObject({
      street: "Via Roma 1",
      locality: null,
    });
  });

  it("returns an empty shape for nothing", () => {
    expect(parseAddress(null)).toEqual({
      street: null,
      locality: null,
      region: null,
      postalCode: null,
      country: null,
    });
  });
});

describe("precisionForAddress", () => {
  it("grades specificity from house number down to country", () => {
    expect(precisionForAddress(parseAddress("Via Roma 1, Milano"))).toBe(
      "exact",
    );
    expect(precisionForAddress(parseAddress("Via Roma, Milano"))).toBe(
      "street",
    );
    expect(
      precisionForAddress({
        street: null,
        locality: "Milano",
        region: null,
        postalCode: null,
        country: null,
      }),
    ).toBe("locality");
    expect(precisionForAddress(parseAddress(null))).toBe("unknown");
  });
});

describe("geohashEncode", () => {
  it("matches known geohashes", () => {
    // The reference value from the geohash specification.
    expect(geohashEncode(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
    expect(geohashEncode(45.4642, 9.19, 7)).toBe("u0nd9he");
  });

  it("shares a prefix for nearby points and diverges for distant ones", () => {
    const duomo = geohashEncode(45.4642, 9.19, 6);
    const nearby = geohashEncode(45.4645, 9.1903, 6);
    const rome = geohashEncode(41.9028, 12.4964, 6);
    expect(nearby.slice(0, 5)).toBe(duomo.slice(0, 5));
    expect(rome.slice(0, 3)).not.toBe(duomo.slice(0, 3));
  });
});

describe("momentPrecision", () => {
  it("reads specificity off the shape of the timestamp", () => {
    expect(momentPrecision("2026-03-04T15:30:00+01:00")).toBe("minute");
    expect(momentPrecision("2026-03-04T15:30:00+01:00", true)).toBe("day");
    expect(momentPrecision("2026-03-04")).toBe("day");
    expect(momentPrecision("2026-03")).toBe("month");
    expect(momentPrecision("2026")).toBe("year");
    expect(momentPrecision(null)).toBe("unknown");
  });
});

describe("deriveReminderAt", () => {
  it("schedules an explicit reminder at the moment itself", () => {
    expect(
      deriveReminderAt({
        kind: "reminder",
        startsAt: "2026-03-04T15:30:00+01:00",
        needsReminder: true,
      }),
    ).toBe("2026-03-04T15:30:00+01:00");
  });

  it("nudges before an event so it is still actionable", () => {
    expect(
      deriveReminderAt({
        kind: "event",
        startsAt: "2026-03-04T15:30:00+01:00",
        needsReminder: true,
      }),
    ).toBe("2026-03-04T15:00:00+01:00");
  });

  it("warns a day ahead of a deadline", () => {
    expect(
      deriveReminderAt({
        kind: "deadline",
        startsAt: "2026-03-04T15:30:00+01:00",
        needsReminder: true,
      }),
    ).toBe("2026-03-03T15:30:00+01:00");
  });

  it("surfaces an all-day moment in the morning", () => {
    expect(
      deriveReminderAt({
        kind: "reminder",
        startsAt: "2026-03-04",
        needsReminder: true,
        timezone: "UTC",
      }),
    ).toBe("2026-03-04T09:00:00Z");
  });

  it("warns the morning before an all-day deadline", () => {
    expect(
      deriveReminderAt({
        kind: "deadline",
        startsAt: "2026-03-04",
        needsReminder: true,
        timezone: "UTC",
      }),
    ).toBe("2026-03-03T09:00:00Z");
  });

  it("schedules nothing for plain context", () => {
    expect(
      deriveReminderAt({
        kind: "date",
        startsAt: "2026-03-04T15:30:00+01:00",
        needsReminder: false,
      }),
    ).toBeNull();
  });

  it("refuses to invent a time for an imprecise moment", () => {
    expect(
      deriveReminderAt({
        kind: "reminder",
        startsAt: "2026-03",
        needsReminder: true,
      }),
    ).toBeNull();
    expect(
      deriveReminderAt({
        kind: "reminder",
        startsAt: null,
        needsReminder: true,
      }),
    ).toBeNull();
  });
});
