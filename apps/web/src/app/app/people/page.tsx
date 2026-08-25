import type { Metadata } from "next";

import { EntityDirectory } from "@/components/entities/entity-directory";

export const metadata: Metadata = { title: "People & organisations" };

/**
 * Organisations share this page with people rather than getting their own.
 * They are recalled together — you look up the company to find the person and
 * the person to remember the company — and keeping them in one directory means
 * one search box finds either.
 */
export default function Page() {
  return (
    <EntityDirectory
      type="person"
      alsoInclude={["organization"]}
      title="People"
      description="Everyone connected to your notes, and the organisations they belong to."
    />
  );
}
