import type { Metadata } from "next";

import { EntityDirectory } from "@/components/entities/entity-directory";

export const metadata: Metadata = { title: "Moments" };

export default function Page() {
  return (
    <EntityDirectory
      type="time"
      title="Moments"
      description="Dates, plans and moments from your notes."
    />
  );
}
