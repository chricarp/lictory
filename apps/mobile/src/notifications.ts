import * as Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications() {
  if (!Device.isDevice) {
    throw new Error("Push notifications require a physical device.");
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Lictory reminders",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const permission =
    existing.status === "granted"
      ? existing
      : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const projectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    Constants.default.expoConfig?.extra?.eas?.projectId;
  if (!projectId || projectId === "REPLACE_WITH_EAS_PROJECT_ID") {
    throw new Error("Set EXPO_PUBLIC_EAS_PROJECT_ID before registering push.");
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId,
  });
  await api.registerDevice({
    token,
    platform: Platform.OS === "ios" ? "ios" : "android",
  });
  return token;
}
