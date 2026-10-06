import type { ReactNode } from "react";
import { Intelligence } from "~/components/intelligence/chat/intelligence";

// The conversation UI lives in the layout so a streaming answer and the
// composer survive moving from a new chat to its own URL. Pages only name the
// conversation through the route.
export default function IntelligenceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <Intelligence />
      {children}
    </>
  );
}
