import type { ReactNode } from "react";
import { TeamGate } from "~/components/delivery/team-gate";
export default function TeamLayout({ children }: { children: ReactNode }) {
  return <TeamGate>{children}</TeamGate>;
}
