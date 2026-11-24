import type { CodeWriteKind } from "@lictory/core/db/code-schema";

// What a queued write does, in the words a person reads next to its status.
export function writeSummary(
  kind: CodeWriteKind,
  payload: Record<string, unknown>,
): string {
  const text = (key: string) =>
    typeof payload[key] === "string" ? payload[key] : "";
  const number =
    typeof payload.number === "number"
      ? `#${payload.number}`
      : "the pull request";
  switch (kind) {
    case "create_branch":
      return `Create branch ${text("name")} from ${text("from") || "the default branch"}`;
    case "open_pull_request":
      return `Open a pull request from ${text("head")} into ${text("base")}`;
    case "comment":
      return `Comment on ${number}`;
    case "request_review":
      return `Request a review of ${number} from ${(Array.isArray(payload.reviewers) ? payload.reviewers : []).join(", ")}`;
    case "merge":
      return `Merge ${number} (${text("method") || "merge"})`;
    case "close":
      return `Close ${number}`;
    case "reopen":
      return `Reopen ${number}`;
  }
}
