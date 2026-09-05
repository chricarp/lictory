"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { authClient } from "@/lib/auth-client";

import { AutomaticContext } from "./automatic-context";
import { CaptureDemo } from "./capture-demo";
import { FinalCta, Footer, Philosophy } from "./closing";
import { ConnectedNotes } from "./connected-notes";
import { Header } from "./header";
import { Hero } from "./hero";
import { NoFiling } from "./no-filing";
import { SearchDemo } from "./search-demo";
import { Stories } from "./stories";

/**
 * The page is ordered to mirror what Lictory does: isolated fragments in the
 * hero, capture, understanding, retrieval, connection, and finally a single
 * quiet statement — because once everything is understood, the user should
 * not have to navigate the complexity.
 *
 * `.landing` scopes the light, brand-blue token layer (see globals.css) so the
 * visitor's stored in-app theme has no effect here.
 */
export function LandingPage() {
  const router = useRouter();
  const { data: session } = authClient.useSession();

  // Someone who is already signed in has no use for the pitch; send them to
  // the app. The page still renders while the session is being resolved so
  // signed-out visitors never see a blank frame.
  React.useEffect(() => {
    if (session) router.replace("/app");
  }, [router, session]);

  return (
    <div className="landing light min-h-dvh overflow-x-clip">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-ember px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <CaptureDemo />
        <Stories />
        <SearchDemo />
        <ConnectedNotes />
        <AutomaticContext />
        <NoFiling />
        <Philosophy />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
