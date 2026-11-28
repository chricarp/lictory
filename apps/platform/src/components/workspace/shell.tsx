import { createContext, useContext } from "react";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import type { Project } from "@lictory/core/lib/work-items";
import type { QuickCreateOptions } from "@lictory/platform/components/workspace/quick-create";

// What every page inside the workspace shell may ask of it. The shell itself
// (rail, sidebar, palette, overlays) lives in `components/shell`; this module
// stays small so pages can depend on it without loading the shell.
export type ShellContextValue = {
  toast: (text: string, action?: { label: string; href: string }) => void;
  openPalette: (query?: string) => void;
  openCreate: (options?: QuickCreateOptions) => void;
  setCurrentItem: (item: WorkItem | undefined) => void;
  currentItem: WorkItem | undefined;
  // The project in context: named by the route, or the last one visited.
  project: Project | undefined;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell() {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell requires Shell.");
  return value;
}
