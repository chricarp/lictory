import { harnessLabels, type HarnessId } from "@lictory/core/factory/protocol";

// Session states moved to the shared vocabulary (lib/session-state.ts); these
// re-exports keep the Factory's imports working.
export {
  activeStatuses,
  statusLabels,
  statusMeaning,
  statusTone,
} from "@lictory/platform/lib/session-state";

export const harnessLabel = (harness: string | null) =>
  harness ? (harnessLabels[harness as HarnessId] ?? harness) : "External";

export const osLabel = (os: string) =>
  ({ linux: "Linux", darwin: "macOS", win32: "Windows" })[os] ??
  (os || "Unknown");
