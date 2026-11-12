import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { Logo } from "@lictory/ui/logo";
import { Button } from "@lictory/ui/button";
import { StatusPage } from "@lictory/ui/status-page";
import {
  getStartedLabel,
  repositoryLabel,
  repositoryUrl,
  tryUrl,
} from "@lictory/marketing/lib/get-started";

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
          <Link href={tryUrl} className="contents">
            <Button size="lg">{getStartedLabel}</Button>
          </Link>
          <Link href={repositoryUrl} className="contents">
            <Button size="lg" variant="secondary">
              {repositoryLabel}
            </Button>
          </Link>
          <Link href="/" className="contents">
            <Button size="lg" variant="ghost">
              Go home
            </Button>
          </Link>
        </>
      }
    >
      The address may be misspelled, or the page may have moved.
    </StatusPage>
  );
}
