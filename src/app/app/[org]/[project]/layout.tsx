import type { ReactNode } from "react";
import { ProjectGate } from "~/components/workspace/project-gate";
export default function ProjectLayout({ children }: { children: ReactNode }) {
  return <ProjectGate>{children}</ProjectGate>;
}
