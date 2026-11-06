import { Outlet } from "@tanstack/react-router";
import { SpaceGate } from "@lictory/platform/components/spaces/space-gate";

// Lictory Spaces routes: /{org}/spaces, /{org}/spaces/{space},
// /{org}/spaces/{space}/pages/{page} and /{org}/spaces/{space}/settings.
// Data comes from the workspace's Spaces subscription, never a loader.

export { SpacesIndex as SpacesRoute } from "@lictory/platform/components/spaces/spaces-index";
export { SpaceHome as SpaceHomeRoute } from "@lictory/platform/components/spaces/space-home";
export { PageView as SpacePageRoute } from "@lictory/platform/components/spaces/page-view";
export { SpaceSettings as SpaceSettingsRoute } from "@lictory/platform/components/spaces/space-settings";

export function SpaceRoute() {
  return (
    <SpaceGate>
      <Outlet />
    </SpaceGate>
  );
}
