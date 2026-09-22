import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Layers3 } from "lucide-react";
import { CreateOrganization } from "~/components/workspace/onboarding";

export const metadata: Metadata = { title: "Create organization" };

export default function NewOrganizationPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <Link
        href="/app"
        className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to workspace
      </Link>
      <Layers3 className="mb-5 size-7 text-primary" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">
        Create an organization
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Create an organization for your team. You can invite people and add
        projects afterwards.
      </p>
      <CreateOrganization />
    </main>
  );
}
