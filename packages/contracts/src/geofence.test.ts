import { describe, expect, it } from "vitest";

import { distanceInMeters, isInsideGeofence } from "./geofence";

describe("geofence helpers", () => {
  it("recognizes a nearby point", () => {
    const colosseum = { latitude: 41.8902, longitude: 12.4922 };
    const nearby = { latitude: 41.8905, longitude: 12.4925 };

    expect(distanceInMeters(colosseum, nearby)).toBeLessThan(50);
    expect(isInsideGeofence(nearby, colosseum, 100)).toBe(true);
  });

  it("rejects a distant point", () => {
    expect(
      isInsideGeofence(
        { latitude: 45.4642, longitude: 9.19 },
        { latitude: 41.9028, longitude: 12.4964 },
        1_000,
      ),
    ).toBe(false);
  });
});
