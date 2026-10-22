import type { Metadata } from "next";

import {
  marketingImage,
  siteName,
  siteTitle,
} from "@lictory/marketing/lib/site";

// Public, closed vocabulary only. Never load workspace data or echo URL values.
export const previewLabels = {
  workspace: "Workspace",
  epic: "Epic",
  story: "Story",
  item: "Work item",
  project: "Project",
  board: "Board",
  backlog: "Backlog",
  iteration: "Iteration",
  reviews: "Reviews",
  view: "View",
} as const;
export type PreviewKind = keyof typeof previewLabels;

export function previewKind(path: string): PreviewKind {
  const parts = path.split(/[?#]/, 1)[0]!.split("/").filter(Boolean);
  if (parts[0] !== "app") return "workspace";
  if (parts.length === 4 && parts[2] === "items") return "item";
  if (parts[2] === "teams") {
    if (parts[4] === "board") return "board";
    if (parts[4] === "backlog") return "backlog";
    if (parts[4] === "iterations") return "iteration";
    return "workspace";
  }
  if (parts.length >= 5 && parts[3] === "epics") return "epic";
  if (parts.length >= 5 && parts[3] === "stories") return "story";
  if (parts[3] === "reviews") return "reviews";
  if (parts[3] === "views") return "view";
  if (
    parts.length === 3 &&
    !["settings", "account", "inbox", "notifications"].includes(parts[2]!)
  )
    return "project";
  return "workspace";
}

export function socialMetadata(kind: PreviewKind | "marketing"): Metadata {
  const marketing = kind === "marketing";
  const title = marketing ? siteTitle : `${previewLabels[kind]} in Lictory`;
  const description = marketing
    ? "Turn rough product intent into agreed, implementation-ready specifications. Review together, then deliver in Lictory or publish to Jira."
    : "Open this link in Lictory. Sign in with an account that has access to see the details.";
  const images = [
    {
      url: `/og/${kind}`,
      width: marketingImage.width,
      height: marketingImage.height,
      alt: title,
    },
  ];
  return {
    description,
    openGraph: {
      title,
      description,
      siteName,
      type: "website",
      locale: "en_US",
      ...(marketing ? { url: "/" } : {}),
      images,
    },
    twitter: { card: "summary_large_image", title, description, images },
    ...(!marketing ? { robots: { index: false, follow: false } } : {}),
  };
}
