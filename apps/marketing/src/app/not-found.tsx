import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { Logo } from "@lictory/ui/logo";
import { Button } from "@lictory/ui/button";
import { StatusPage } from "@lictory/ui/status-page";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <StatusPage
      illustration="search"
      brand={<Logo />}
      icon={Search}
      title="This page does not exist"
      actions={
        <>
          <Link href="/" className="contents">
            <Button size="lg">Go home</Button>
          </Link>
          <Link href="/app" className="contents">
            <Button size="lg" variant="secondary">
              Open workspace
            </Button>
          </Link>
        </>
      }
    >
      The address may be misspelled, or the page may have moved.
    </StatusPage>
  );
}
