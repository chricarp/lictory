import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "@lictory/core/lib/auth";

// Layouts and pages of one request share a single session lookup.
export const requestSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
