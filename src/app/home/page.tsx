import type { Metadata } from "next";
import { headers } from "next/headers";

import { Landing } from "~/components/landing/landing";
import { landingMetadata } from "~/components/landing/metadata";
import { auth } from "~/lib/auth";

export const metadata: Metadata = landingMetadata;

// The landing page stays reachable for signed-in visitors, whom "/" sends to
// the app.
export default async function LandingPage() {
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  return <Landing signedIn={Boolean(session)} />;
}
