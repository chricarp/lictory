import type { Metadata } from "next";

import { EntityDirectory } from "@/components/entities/entity-directory";

export const metadata: Metadata = { title: "Topics" };

export default function Page() {
  return (
    <EntityDirectory
      type="topic"
      title="Topics"
      description="Ideas and themes that keep coming back."
    />
  );
}
