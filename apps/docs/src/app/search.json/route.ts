import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@lictory/docs/lib/source";

// Exported at build time as /search.json, the index the search dialog loads.
export const dynamic = "force-static";
export const { staticGET: GET } = createFromSource(source, {
  language: "english",
});
