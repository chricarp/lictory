import { repositoryUrl } from "@lictory/marketing/lib/get-started";

/** Shared public copy for source links, metadata and the FAQ. */
export const openSource = {
  label: "Open source",
  summary:
    "Lictory is an open-source control plane for software teams and their agents.",
  detail:
    "It is MIT licensed, every feature is in the open-source code, and it runs on your own server. Read the code, adapt it to your team, and contribute.",
  repositoryUrl,
} as const;
