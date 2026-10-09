import type { Metadata } from "next";
import { socialMetadata } from "~/lib/social-preview";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Landing } from "~/components/landing/landing";
import { auth } from "~/lib/auth";

export const metadata: Metadata = {
  ...socialMetadata("marketing"),
  title: { absolute: "Lictory: requirements, reviewed like code" },
  description:
    "Lictory turns rough product intent into approved, implementation-ready specifications, then delivers the work natively or publishes it to Jira and Linear.",
};

export default async function HomePage() {
  // Validate the session rather than trusting the cookie, so a stale cookie
  // still sees the landing page instead of bouncing through sign-in.
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  if (session) redirect("/app");
  return <Landing />;
}
