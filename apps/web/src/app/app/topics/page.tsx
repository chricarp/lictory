import type { Metadata } from "next";

import { TopicsPage } from "@/components/entities/topics-page";

export const metadata: Metadata = { title: "Topics" };

export default function Page() {
  return <TopicsPage />;
}
