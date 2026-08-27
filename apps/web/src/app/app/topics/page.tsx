import type { Metadata } from "next";

import { TopicDirectory } from "@/components/entities/topic-directory";

export const metadata: Metadata = { title: "Topics" };

export default function Page() {
  return <TopicDirectory />;
}
