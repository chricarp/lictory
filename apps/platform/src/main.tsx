import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "@lictory/platform/app.css";
import { configureAnalytics } from "@lictory/core/lib/analytics/client";
import { setWorkspacePathMatcher } from "@lictory/core/lib/analytics/events";
import { isWorkspacePath } from "@lictory/core/lib/paths";
import { publicConfig } from "@lictory/platform/lib/public-config";
import { router } from "@lictory/platform/router";

// Browser analytics follow this installation's runtime configuration; without
// it PostHog never loads.
configureAnalytics(publicConfig.analytics);

// Analytics without consent never records which organization, project or
// item a path names; on this host almost every path does.
setWorkspacePathMatcher(isWorkspacePath);

// The document handler injects a generic title for link previews; pages set
// their own once rendered.
for (const title of document.head.querySelectorAll("title")) title.remove();

const root = document.getElementById("root");
if (!root) throw new Error("The page is missing its root element.");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
