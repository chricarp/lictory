import { describe, expect, it } from "vitest";

import {
  formatRecurrence,
  nextOccurrence,
  occurrencesBetween,
  parseRecurrence,
} from "./moments";
import { deriveReminderAt } from "./resolution";

describe("parseRecurrence", () => {
  it("reads the frequencies notes actually contain", () => {
    expect(parseRecurrence("every year")).toEqual({
      freq: "yearly",
      interval: 1,
      until: null,
    });
    expect(parseRecurrence("Annually on the 19th")?.freq).toBe("yearly");
    expect(parseRecurrence("birthday")?.freq).toBe("yearly");
    expect(parseRecurrence("monthly rent")?.freq).toBe("monthly");
    expect(parseRecurrence("every Tuesday")?.freq).toBe("weekly");
    expect(parseRecurrence("daily standup")?.freq).toBe("daily");
  });

  it("picks up an interval", () => {
    expect(parseRecurrence("every 3 weeks")).toMatchObject({
      freq: "weekly",
      interval: 3,
    });
    expect(parseRecurrence("every other Tuesday")).toMatchObject({
      freq: "weekly",
      interval: 2,
    });
    expect(parseRecurrence("biweekly")).toMatchObject({
      freq: "weekly",
      interval: 2,
    });
  });

  it("reads an end date", () => {
    expect(parseRecurrence("every week until 2026-12-31")).toEqual({
      freq: "weekly",
      interval: 1,
      until: "2026-12-31",
    });
  });

  it("returns null when nothing repeats", () => {
    expect(parseRecurrence(null)).toBeNull();
    expect(parseRecurrence("")).toBeNull();
    expect(parseRecurrence("lunch with Ana")).toBeNull();
    expect(parseRecurrence("one-off")).toBeNull();
  });
});

describe("nextOccurrence", () => {
  it("returns a one-off unchanged, past or future", () => {
    expect(nextOccurrence("2020-01-01", null, "2026-06-01")).toBe("2020-01-01");
  });

  it("rolls a birthday anchored decades ago into the coming year", () => {
    expect(
      nextOccurrence("1990-08-19", parseRecurrence("yearly"), "2026-01-10"),
    ).toBe("2026-08-19");
    expect(
      nextOccurrence("1990-08-19", parseRecurrence("yearly"), "2026-09-10"),
    ).toBe("2027-08-19");
  });

  it("keeps the clock time and offset a repeating moment was written with", () => {
    expect(
      nextOccurrence(
        "2026-03-04T15:30:00+01:00",
        parseRecurrence("weekly"),
        "2026-03-20T00:00:00Z",
      ),
    ).toBe("2026-03-25T15:30:00+01:00");
  });

  it("clamps a monthly series to the length of the month", () => {
    expect(
      nextOccurrence("2026-01-31", parseRecurrence("monthly"), "2026-02-01"),
    ).toBe("2026-02-28");
  });

  it("stops at the end of the series", () => {
    expect(
      nextOccurrence(
        "2026-01-05",
        parseRecurrence("every week until 2026-01-20"),
        "2026-02-01",
      ),
    ).toBeNull();
  });
});

describe("occurrencesBetween", () => {
  it("expands a weekly moment across a window", () => {
    const windows = occurrencesBetween(
      "2026-01-05",
      null,
      parseRecurrence("weekly"),
      "2026-01-01",
      "2026-02-01",
    );
    expect(windows.map((w) => w.startsAt)).toEqual([
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
      "2026-01-26",
    ]);
  });

  it("omits a one-off that falls outside the window", () => {
    expect(
      occurrencesBetween("2025-01-05", null, null, "2026-01-01", "2026-02-01"),
    ).toEqual([]);
  });

  it("keeps the span of a multi-day occurrence", () => {
    const [first] = occurrencesBetween(
      "2026-01-05T00:00:00Z",
      "2026-01-07T00:00:00Z",
      parseRecurrence("yearly"),
      "2027-01-01",
      "2027-02-01",
    );
    expect(first?.startsAt).toBe("2027-01-05T00:00:00Z");
    expect(first?.endsAt).toBe("2027-01-07T00:00:00.000Z");
  });
});

describe("deriveReminderAt with recurrence", () => {
  it("schedules a birthday against the next occurrence, not the anchor", () => {
    expect(
      deriveReminderAt({
        kind: "event",
        startsAt: "1990-08-19",
        allDay: true,
        needsReminder: true,
        timezone: "UTC",
        recurrence: parseRecurrence("yearly"),
        from: "2026-01-10T00:00:00Z",
      }),
    ).toBe("2026-08-19T09:00:00Z");
  });
});

describe("formatRecurrence", () => {
  it("says the schedule in words", () => {
    expect(formatRecurrence(parseRecurrence("yearly"))).toBe("Every year");
    expect(formatRecurrence(parseRecurrence("every other week"))).toBe(
      "Every other week",
    );
    expect(formatRecurrence(parseRecurrence("every 3 months"))).toBe(
      "Every 3 months",
    );
    expect(formatRecurrence(null)).toBeNull();
  });
});
