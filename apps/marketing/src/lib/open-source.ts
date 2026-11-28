import { repositoryUrl } from "@lictory/marketing/lib/get-started";

/** Shared public copy for source links, metadata and the FAQ. */
export const openSource = {
  label: "Open source",
  summary:
    "Lictory is an open-source control plane for software teams and their agents.",
  detail: "MIT licensed, every feature included, on your own server.",
  repositoryUrl,
} as const;
