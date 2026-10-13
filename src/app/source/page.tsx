import type { Metadata } from "next";
import Link from "next/link";
import { sourceCodeUrl } from "~/lib/source-code";
import { APP_VERSION } from "~/lib/app-version";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Source code",
  description: "Get the corresponding source for this Lictory deployment.",
  alternates: { canonical: "/source" },
};

export default function SourcePage() {
  const source = sourceCodeUrl(process.env.LICTORY_SOURCE_URL);
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Source code</h1>
      <p className="mt-6 text-sm leading-7 text-muted-foreground">
        Lictory v{APP_VERSION} is licensed under the GNU Affero General Public
        License, version 3 only (AGPL-3.0-only). All current product features
        are part of the open source core.
      </p>
      {source ? (
        <a
          href={source}
          className="mt-6 inline-block rounded underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Get this deployment’s source code
        </a>
      ) : (
        <p role="note" className="mt-6 text-sm leading-7">
          The operator has not configured a source download for this deployment.
          Before making it available to users, the operator must provide the
          corresponding source, including any modifications and build
          instructions.
        </p>
      )}
      <p className="mt-6 text-sm leading-7 text-muted-foreground">
        You can self-host regardless of organization size or user count. The
        maintained community deployment runs on one machine. The software
        license is separate from a hosted service or support agreement.
      </p>
      <Link
        href="/"
        className="mt-8 inline-block rounded text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to Lictory
      </Link>
    </main>
  );
}
