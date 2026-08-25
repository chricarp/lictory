import type { Metadata } from "next";
import { Suspense } from "react";

import { MomentsCalendar } from "@/components/moments/moments-calendar";

export const metadata: Metadata = { title: "Moments" };

export default function Page() {
  // The calendar reads its view and focused day from the URL, and
  // `useSearchParams` suspends on a statically rendered route.
  return (
    <Suspense fallback={null}>
      <MomentsCalendar />
    </Suspense>
  );
}
