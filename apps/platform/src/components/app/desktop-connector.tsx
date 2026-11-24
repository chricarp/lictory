import { useMemberships } from "@lictory/platform/data/memberships";
import { desktop, type DesktopBridge } from "@lictory/platform/lib/desktop";
import { useDesktopBridge } from "@lictory/platform/lib/desktop-bridge";

// Inside the Lictory desktop app: notifications, badge and navigation for
// the signed-in person (lib/desktop-bridge.ts). Renders nothing, and does
// nothing in a browser.
export function DesktopConnector() {
  const bridge = desktop();
  return bridge ? <Connected bridge={bridge} /> : null;
}

function Connected({ bridge }: { bridge: DesktopBridge }) {
  const { organizations } = useMemberships();
  useDesktopBridge(
    bridge,
    organizations.map((o) => o.id),
  );
  return null;
}
