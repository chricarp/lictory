import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@lictory/core/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
