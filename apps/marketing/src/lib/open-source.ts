import { repositoryUrl } from "@lictory/marketing/lib/get-started";

/** Shared public copy for source links, metadata and the FAQ. */
export const openSource = {
  label: "Open source",
  summary: "Lictory is open-source work management for software teams.",
  detail:
    "It is MIT licensed and runs on your own server. Read the code, adapt it to your team, and contribute.",
  repositoryUrl,
} as const;
