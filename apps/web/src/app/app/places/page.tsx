import type { Metadata } from "next";

import { EntityDirectory } from "@/components/entities/entity-directory";

export const metadata: Metadata = { title: "Places" };

export default function Page() {
  return (
    <EntityDirectory
      type="place"
      title="Places"
      description="Everywhere connected to your notes."
    />
  );
}
