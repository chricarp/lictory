import type { Metadata } from "next";

import { AskExperience } from "@/components/ask/ask-experience";

export const metadata: Metadata = { title: "Ask" };

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <AskExperience initialQueryId={id ?? null} />;
}
