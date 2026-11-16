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
          <Button size="lg" render={<Link href={tryUrl} />}>
            {getStartedLabel}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            render={<Link href={repositoryUrl} />}
          >
            {repositoryLabel}
          </Button>
          <Button size="lg" variant="ghost" render={<Link href="/" />}>
            Go home
          </Button>
        </>
      }
    >
      The address may be misspelled, or the page may have moved.
    </StatusPage>
  );
}
