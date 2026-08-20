import { expoClient } from "@better-auth/expo/client";
import { expoPasskeyClient } from "@lobehub/expo-better-auth-passkey";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ?? "https://api.lictory.localhost";

export const authClient = createAuthClient({
  baseURL: apiUrl,
  plugins: [
    expoClient({
      scheme: "lictory",
      storagePrefix: "lictory",
      storage: SecureStore,
      cookiePrefix: "better-auth",
    }),
    expoPasskeyClient(),
  ],
});
