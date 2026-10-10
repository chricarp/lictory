import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthLayout } from "~/components/auth/auth-layout";

// Account flows are reachable by crawlers but kept out of search results; only
// sign-up opts back in.
export const metadata: Metadata = { robots: { index: false, follow: true } };

export default function AuthenticationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AuthLayout>{children}</AuthLayout>;
}
