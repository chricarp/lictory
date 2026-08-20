import type { Metadata } from "next";

import { CaptureHome } from "@/components/notes/capture-home";

export const metadata: Metadata = { title: "Capture" };

export default function AppPage() {
  return <CaptureHome />;
}
