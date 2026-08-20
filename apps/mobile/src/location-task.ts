import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { api } from "./api";

export const LOCATION_TASK_NAME = "lictory-geofence-events";

type GeofenceTaskData = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

TaskManager.defineTask<GeofenceTaskData>(
  LOCATION_TASK_NAME,
  async ({ data, error }) => {
    if (error || !data) {
      console.error("Lictory geofence task failed", error);
      return;
    }

    const event =
      data.eventType === Location.GeofencingEventType.Enter ? "enter" : "exit";
    try {
      await api.recordLocationEvent({
        triggerId: data.region.identifier,
        event,
        latitude: data.region.latitude,
        longitude: data.region.longitude,
        occurredAt: new Date().toISOString(),
      });
    } catch (taskError) {
      console.error("Could not send geofence event", taskError);
    }
  },
);
