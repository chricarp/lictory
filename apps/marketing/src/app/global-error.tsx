"use client";

import Image from "next/image";
import { illustrationAssets } from "@lictory/ui/illustration-assets";
import { useEffect } from "react";

import { trackRenderFailure } from "@lictory/core/lib/analytics/client";
import { platformHref } from "@lictory/marketing/lib/platform";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    trackRenderFailure(error.digest);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        {/* The root layout can fail before its stylesheet is available. */}
        <style>{`
          .recovery-page { color-scheme: dark; background: #08090b; color: #edf0f4; min-height: 100dvh; display: grid; place-items: center; font-family: system-ui, sans-serif; }
          .recovery-content { max-width: 400px; padding: 48px 24px; text-align: center; }
          .recovery-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 24px; }
          .recovery-actions button, .recovery-actions a { font: inherit; padding: 12px 18px; border-radius: 10px; border: 1px solid #2b313b; color: inherit; background: transparent; cursor: pointer; text-decoration: none; }
          .recovery-actions button { background: #edf0f4; color: #08090b; border-color: #edf0f4; }
        `}</style>
        <main className="recovery-page">
          <div className="recovery-content">
            <Image
              src={illustrationAssets.recovery}
              width={384}
              height={384}
              alt=""
              aria-hidden="true"
              unoptimized
              style={{ width: 160, height: 160 }}
            />
            <h1 style={{ fontSize: 24 }}>Lictory could not open this page</h1>
            <p style={{ fontSize: 14, lineHeight: 1.7 }}>
              An unexpected error interrupted the page. Try again, or return to
              your workspace.
            </p>
            <div className="recovery-actions">
              <button onClick={reset}>Try again</button>
              <a href={platformHref("/")}>Open workspace</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
