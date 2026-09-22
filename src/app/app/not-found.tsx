import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { Logo } from "~/components/logo";
import { Button } from "~/components/ui/button";
import { StatusPage } from "~/components/ui/status-page";

export const metadata: Metadata = { title: "Not found" };

export default function AppNotFound() {
  return (
    <StatusPage
      brand={<Logo />}
      icon={Search}
      title="This workspace was not found"
      actions={
        <Link href="/app" className="contents">
          <Button size="lg">Go to your workspace</Button>
        </Link>
      }
    >
      You may not have access, or the address is misspelled.
    </StatusPage>
  );
}
