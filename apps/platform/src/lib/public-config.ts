import { readPublicConfig } from "@lictory/core/lib/public-config";

// This installation's public settings, written into the document by whoever
// serves it (apps/api/src/routes/public.ts). Nothing installation-specific is
// compiled into the bundle.
export const publicConfig = readPublicConfig(document);
