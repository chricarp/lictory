import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

// Compiled at build time from content/docs (MDX pages and meta.json order).
const docs = defineDocs({ dir: "content/docs" });

export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
});
