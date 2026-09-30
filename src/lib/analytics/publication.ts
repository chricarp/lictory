import type { AnalyticsProperties } from "./events";

export function publicationProperties(result: unknown): AnalyticsProperties {
  if (
    !result ||
    typeof result !== "object" ||
    !("results" in result) ||
    !("status" in result)
  )
    return {};
  const publication = result as {
    id: string;
    status: string;
    results: Record<string, { outcome: string }>;
  };
  const properties: AnalyticsProperties = {
    publication_id: publication.id,
    publication_status: publication.status,
    item_count: Object.keys(publication.results).length,
  };
  for (const outcome of [
    "pending",
    "created",
    "updated",
    "unchanged",
    "conflict",
    "failed",
    "skipped",
  ])
    properties[`${outcome}_count`] = Object.values(publication.results).filter(
      (item) => item.outcome === outcome,
    ).length;
  return properties;
}
