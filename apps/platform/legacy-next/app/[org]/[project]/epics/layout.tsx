import type { ReactNode } from "react";
import { SplitView } from "@lictory/platform/components/items/split-view";
export default function Layout({ children }: { children: ReactNode }) {
  return <SplitView kind="epics">{children}</SplitView>;
}
