import { createContext, useContext, type ReactNode } from "react";
import { useUnreadNotifications } from "@lictory/platform/components/notifications/client";

// Unread notifications of every organization I belong to, fetched once for
// the shell (the Inbox badge and the organization rail share it).
const UnreadContext = createContext<Readonly<Record<string, number>>>({});

export function UnreadProvider({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  const unread = useUnreadNotifications(organizationId);
  return <UnreadContext value={unread}>{children}</UnreadContext>;
}

export function useUnread() {
  return useContext(UnreadContext);
}
