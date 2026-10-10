import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Landing } from "~/components/landing/landing";
import { landingMetadata } from "~/components/landing/metadata";
import { auth } from "~/lib/auth";

export const metadata: Metadata = landingMetadata;

export default async function HomePage() {
  // Validate the session rather than trusting the cookie, so a stale cookie
  // still sees the landing page instead of bouncing through sign-in.
  // Signed-in visitors can still reach the landing page at /home.
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  if (session) redirect("/app");
  return <Landing />;
}
