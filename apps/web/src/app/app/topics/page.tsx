import { TopicsPage } from "@/components/entities/topics-page";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Topics" };

export default function Page() {
  return <TopicsPage />;
}
