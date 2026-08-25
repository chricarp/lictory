import { describe, expect, it } from "vitest";

import { resolveMoment } from "./moments";

/**
 * The moment resolver is the piece that decides whether a note quietly becomes
 * a notification, so its rules are worth pinning down independently of D1.
 */
describe("resolveMoment", () => {
  const at = "2026-03-04T15:30:00+01:00";

  it("defaults an unclassified moment to plain context", () => {
    expect(resolveMoment({ kind: null, startsAt: at })).toMatchObject({
      kind: "date",
      remindAt: null,
    });
  });

  it("schedules an explicit reminder for the moment itself", () => {
    expect(
      resolveMoment({ kind: "reminder", startsAt: at, needsReminder: true }),
    ).toMatchObject({ kind: "reminder", precision: "minute", remindAt: at });
  });

  it("gives a deadline a day of warning", () => {
    expect(
      resolveMoment({ kind: "deadline", startsAt: at, needsReminder: true }),
    ).toMatchObject({ remindAt: "2026-03-03T15:30:00+01:00" });
  });

  it("never schedules a moment the user did not ask to be reminded about", () => {
    expect(
      resolveMoment({ kind: "event", startsAt: at, needsReminder: false }),
    ).toMatchObject({ kind: "event", remindAt: null });
  });

  it("refuses to invent a time for an imprecise moment", () => {
    expect(
      resolveMoment({
        kind: "reminder",
        startsAt: "2026-03",
        needsReminder: true,
      }),
    ).toMatchObject({ precision: "month", remindAt: null });
  });

  it("treats an all-day moment as a day, not a midnight", () => {
    expect(
      resolveMoment({
        kind: "reminder",
        startsAt: at,
        allDay: true,
        needsReminder: true,
        timezone: "UTC",
      }),
    ).toMatchObject({ precision: "day" });
  });
});
