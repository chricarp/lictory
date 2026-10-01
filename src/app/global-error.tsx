"use client";

import NextError from "next/error";
import { useEffect } from "react";

import { trackRenderFailure } from "~/lib/analytics/client";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    trackRenderFailure(error.digest);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
