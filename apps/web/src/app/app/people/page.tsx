import type { Metadata } from "next";

import { EntityDirectory } from "@/components/entities/entity-directory";

export const metadata: Metadata = { title: "People" };

export default function Page() {
  return (
    <EntityDirectory
      type="person"
      title="People"
      description="Everyone connected to your notes."
    />
  );
}
