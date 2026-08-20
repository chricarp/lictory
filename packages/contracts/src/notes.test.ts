import { describe, expect, it } from "vitest";

import { extractionSchema, normalizeEntityKey } from "./notes";

describe("normalizeEntityKey", () => {
  it("collapses casing, punctuation and accents so duplicates merge", () => {
    expect(normalizeEntityKey("person", "Marta Rossi")).toBe("marta rossi");
    expect(normalizeEntityKey("person", "  MARTA   ROSSI!  ")).toBe(
      "marta rossi",
    );
    expect(normalizeEntityKey("person", "Márta Rossí")).toBe("marta rossi");
  });

  it("strips honorifics from people but not from other types", () => {
    expect(normalizeEntityKey("person", "Dr Chen")).toBe("chen");
    expect(normalizeEntityKey("place", "Dr Chen Clinic")).toBe(
      "dr chen clinic",
    );
  });

  it("keeps distinct names distinct", () => {
    expect(normalizeEntityKey("place", "Bar Luce")).not.toBe(
      normalizeEntityKey("place", "Bar Basso"),
    );
  });
});

describe("extractionSchema", () => {
  it("fills in empty collections when the model omits them", () => {
    const parsed = extractionSchema.parse({ summary: "A note" });
    expect(parsed).toMatchObject({
      summary: "A note",
      people: [],
      places: [],
      times: [],
      organizations: [],
      topics: [],
    });
  });

  it("rejects confidences outside 0..1", () => {
    const result = extractionSchema.safeParse({
      people: [{ name: "Marta", confidence: 4 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a full extraction", () => {
    const result = extractionSchema.safeParse({
      title: "Coffee with Marta",
      summary: "Coffee at Bar Luce",
      people: [{ name: "Marta", mention: "with Marta", confidence: 0.9 }],
      places: [{ name: "Bar Luce", latitude: 45.4642, longitude: 9.19 }],
      times: [{ label: "Thursday", startsAt: "2026-03-14T18:30:00Z" }],
      organizations: [],
      topics: [{ name: "launch" }],
    });
    expect(result.success).toBe(true);
  });
});
