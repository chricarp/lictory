import type { Filters, SortKey } from "./work-items";
import type {
  RefinementState,
  StatusCategory,
  WorkItemPriority,
} from "~/sync/shared/protocol";

// List state lives in the URL so views are shareable and survive reloads.
// Only non-default values are written, keeping URLs short.
export type ListState = {
  filters: Filters;
  sort: SortKey;
  group: boolean;
  archived: boolean;
};
const sortKeys: SortKey[] = [
  "updated",
  "created",
  "priority",
  "status",
  "number",
];
const list = (value: string | null) =>
  value ? value.split(",").filter(Boolean) : undefined;

export function readListState(
  params: URLSearchParams,
  defaultGroup: boolean,
): ListState {
  const sort = params.get("sort");
  return {
    filters: {
      status: list(params.get("status")) as StatusCategory[] | undefined,
      refinement: list(params.get("refinement")) as
        RefinementState[] | undefined,
      type: list(params.get("type")),
      team: list(params.get("team")),
      priority: list(params.get("priority")) as WorkItemPriority[] | undefined,
      assignee: list(params.get("assignee")),
      parent: list(params.get("epic")),
      label: list(params.get("label")),
      milestone: list(params.get("milestone")),
      blocked: params.get("blocked") === "1" || undefined,
      needsReview: params.get("review") === "1" || undefined,
      search: params.get("q") ?? undefined,
    },
    sort: sortKeys.includes(sort as SortKey) ? (sort as SortKey) : "updated",
    group: params.has("group") ? params.get("group") === "1" : defaultGroup,
    archived: params.get("archived") === "1",
  };
}

export function writeListState(
  current: URLSearchParams,
  state: ListState,
  defaultGroup: boolean,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const set = (key: string, value: string | undefined) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  const f = state.filters;
  set("status", f.status?.join(","));
  set("refinement", f.refinement?.join(","));
  set("type", f.type?.join(","));
  set("team", f.team?.join(","));
  set("priority", f.priority?.join(","));
  set("assignee", f.assignee?.join(","));
  set("epic", f.parent?.join(","));
  set("label", f.label?.join(","));
  set("milestone", f.milestone?.join(","));
  set("blocked", f.blocked ? "1" : undefined);
  set("review", f.needsReview ? "1" : undefined);
  set("q", f.search?.trim() ? f.search.trim() : undefined);
  set("sort", state.sort === "updated" ? undefined : state.sort);
  set(
    "group",
    state.group === defaultGroup ? undefined : state.group ? "1" : "0",
  );
  set("archived", state.archived ? "1" : undefined);
  return next;
}
