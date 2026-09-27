import type { Metadata } from "next";
import { headers } from "next/headers";

import { Landing } from "~/components/landing/landing";
import { auth } from "~/lib/auth";

export const metadata: Metadata = {
  title: { absolute: "Lictory: requirements, reviewed like code" },
  description:
    "Lictory turns rough product intent into approved, implementation-ready specifications, then delivers the work natively or publishes it to Jira and Linear.",
};

export default async function HomePage() {
  const session = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  return (
    <Landing
      user={
        session ? { name: session.user.name, email: session.user.email } : null
      }
    />
  );
}
