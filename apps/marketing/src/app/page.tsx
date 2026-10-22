import type { Metadata } from "next";

import { Landing } from "@lictory/marketing/components/landing/landing";
import { landingMetadata } from "@lictory/marketing/components/landing/metadata";

export const metadata: Metadata = landingMetadata;

export default function HomePage() {
  return <Landing />;
}
