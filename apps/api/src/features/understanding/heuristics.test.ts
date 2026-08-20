import { describe, expect, it } from "vitest";

import { heuristicExtraction } from "./heuristics";

const CAPTURED_AT = "2026-03-11T09:00:00.000Z"; // A Wednesday.

describe("heuristicExtraction", () => {
  it("finds people introduced by a verb, regardless of casing", () => {
    const result = heuristicExtraction(
      "Called Marta about the deck. Later met Jon with Ana.",
      CAPTURED_AT,
    );
    expect(result.people.map((person) => person.name)).toEqual(
      expect.arrayContaining(["Marta", "Jon", "Ana"]),
    );
  });

  it("finds places introduced by a preposition", () => {
    const result = heuristicExtraction(
      "Coffee at Bar Luce, then dinner in Brera.",
      CAPTURED_AT,
    );
    expect(result.places.map((place) => place.name)).toEqual(
      expect.arrayContaining(["Bar Luce", "Brera"]),
    );
  });

  it("resolves ISO dates and relative days against the capture time", () => {
    const iso = heuristicExtraction("Ship it on 2026-04-02.", CAPTURED_AT);
    expect(iso.times[0]?.startsAt?.slice(0, 10)).toBe("2026-04-02");

    const tomorrow = heuristicExtraction("Do it tomorrow.", CAPTURED_AT);
    expect(tomorrow.times[0]?.startsAt?.slice(0, 10)).toBe("2026-03-12");
  });

  it("resolves the next named weekday forward in time", () => {
    const result = heuristicExtraction("Meeting next friday.", CAPTURED_AT);
    const day = new Date(result.times[0]!.startsAt!);
    expect(day.getDay()).toBe(5);
    expect(day.getTime()).toBeGreaterThan(Date.parse(CAPTURED_AT));
  });

  it("never invents entities from empty input", () => {
    const result = heuristicExtraction("", CAPTURED_AT);
    expect(result.people).toEqual([]);
    expect(result.places).toEqual([]);
    expect(result.times).toEqual([]);
    expect(result.topics).toEqual([]);
  });

  it("deduplicates repeated mentions", () => {
    const result = heuristicExtraction(
      "Met Marta today. Later called Marta again about it.",
      CAPTURED_AT,
    );
    expect(
      result.people.filter((person) => person.name === "Marta"),
    ).toHaveLength(1);
  });
});
