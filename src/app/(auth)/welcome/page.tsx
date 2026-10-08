import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthHeading } from "~/components/auth/auth-layout";
import { HandleForm } from "~/components/auth/handle-form";
import { db } from "~/db";
import { auth } from "~/lib/auth";
import { suggestHandles } from "~/lib/handles-server";
import { safeAppPath } from "~/lib/paths";

export const metadata: Metadata = { title: "Choose your handle" };

// Required step for every new account (email or social) before the app.
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const destination = safeAppPath(typeof next === "string" ? next : null);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(destination)}`);
  if (session.user.handle) redirect(destination);
  const suggestions = await suggestHandles(db, session.user);

  return (
    <>
      <AuthHeading
        title="Choose your handle"
        description="How teammates @mention you. You can change it later."
      />
      <HandleForm
        initial={suggestions[0] ?? ""}
        suggestions={suggestions}
        next={destination}
      />
    </>
  );
}
