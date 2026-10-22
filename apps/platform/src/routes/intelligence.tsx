import { Outlet } from "@tanstack/react-router";
import { Intelligence } from "@lictory/platform/components/intelligence/chat/intelligence";

// The conversation UI lives in the layout so a streaming answer and the
// composer survive moving from a new chat to its own URL. Child routes only
// name the conversation.
export function IntelligenceLayout() {
  return (
    <>
      <Intelligence />
      <Outlet />
    </>
  );
}
