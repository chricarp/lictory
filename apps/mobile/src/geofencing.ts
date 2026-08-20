import type { Trigger } from "@lictory/contracts";
import * as Location from "expo-location";

import { LOCATION_TASK_NAME } from "./location-task";

export async function startGeofencingFor(triggers: Trigger[]) {
  const locationTriggers = triggers.filter(
    (trigger) =>
      trigger.type === "location" &&
      trigger.status === "active" &&
      trigger.latitude !== null &&
      trigger.longitude !== null &&
      trigger.radiusMeters !== null,
  );
  if (locationTriggers.length === 0) return 0;

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    throw new Error("Foreground location permission was not granted.");
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") {
    throw new Error("Background location permission was not granted.");
  }

  await Location.startGeofencingAsync(
    LOCATION_TASK_NAME,
    locationTriggers.map((trigger) => ({
      identifier: trigger.id,
      latitude: trigger.latitude!,
      longitude: trigger.longitude!,
      radius: trigger.radiusMeters!,
      notifyOnEnter: trigger.event === "enter",
      notifyOnExit: trigger.event === "exit",
    })),
  );
  return locationTriggers.length;
}
