"use client";

import Image from "next/image";
import { illustrationAssets } from "@lictory/ui/illustration-assets";
import { useEffect } from "react";

import { trackRenderFailure } from "@lictory/core/lib/analytics/client";
import {
  getStartedLabel,
  installUrl,
  repositoryLabel,
  repositoryUrl,
} from "@lictory/marketing/lib/get-started";

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
          .recovery-page { color-scheme: light dark; background: light-dark(#f4f5f7, #0c0d0f); color: light-dark(#111214, #eceef1); min-height: 100dvh; display: grid; place-items: center; font-family: system-ui, sans-serif; }
          .recovery-content { max-width: 400px; padding: 48px 24px; text-align: center; }
          .recovery-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 24px; }
          .recovery-actions button, .recovery-actions a { font: inherit; padding: 12px 18px; border-radius: 10px; border: 1px solid #7777; color: inherit; background: transparent; cursor: pointer; text-decoration: none; }
          .recovery-actions button { background: light-dark(#111214, #eceef1); color: light-dark(#f4f5f7, #0c0d0f); border-color: transparent; }
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
              An unexpected error interrupted the page. Try again, or continue
              to the installation guide.
            </p>
            <div className="recovery-actions">
              <button onClick={reset}>Try again</button>
              <a href={installUrl}>{getStartedLabel}</a>
              <a href={repositoryUrl}>{repositoryLabel}</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
