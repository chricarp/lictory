import { createLictoryClient } from "@lictory/api-client";

import { authClient } from "./auth-client";

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ?? "https://api.lictory.localhost";

export const api = createLictoryClient({
  baseUrl: apiUrl,
  getAuthHeaders: () => {
    const cookie = authClient.getCookie();
    return cookie ? { Cookie: cookie } : undefined;
  },
});
