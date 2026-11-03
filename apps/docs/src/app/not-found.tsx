import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold">This page does not exist</h1>
      <p className="text-fd-muted-foreground">
        It may have moved. Search the documentation, or start from the
        introduction.
      </p>
      <Link href="/" className="text-fd-primary font-medium underline">
        Go to the introduction
      </Link>
    </main>
  );
}
