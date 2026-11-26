import { useEffect, useRef } from "react";
import {
  asksPermission,
  type SessionEntity,
} from "@lictory/core/factory/entities";
import { useAnnounce } from "@lictory/platform/components/shell/announcer";

type AnnouncedSession = Pick<
  SessionEntity,
  "id" | "status" | "attempts" | "eventCount" | "approvals"
>;

// What changed in a session since the surface showing it opened, in words:
// "Forge asks for approval: Run the database migration on staging",
// "Forge finished Refund button", "Forge failed Refund button: tests did not
// pass". Null when nothing worth interrupting for changed (a step of
// progress, an answer the person gave themselves).
export function sessionAnnouncements(
  previous: AnnouncedSession,
  next: AnnouncedSession,
  agentName: string,
  title: string,
  error?: string | null,
): { key: string; text: string }[] {
  const said: { key: string; text: string }[] = [];
  const known = new Set(previous.approvals.map((a) => a.id));
  for (const approval of next.approvals)
    if (!known.has(approval.id))
      said.push({
        key: `approval:${approval.id}`,
        text: asksPermission(approval.detail)
          ? `${agentName} asks for approval: ${approval.title}`
          : `${agentName} asks: ${approval.title}`,
      });
  if (previous.status === next.status) return said;
  const attempt = `session:${next.id}:${next.attempts}`;
  switch (next.status) {
    case "running":
      // Starting work is news; resuming after the person's own answer
      // is not.
      if (previous.status === "queued" || previous.status === "assigned")
        said.push({
          key: `${attempt}:running`,
          text: `${agentName} started ${title}`,
        });
      break;
    case "waiting":
      if (!next.approvals.length)
        said.push({
          key: `${attempt}:waiting:${next.eventCount}`,
          text: `${agentName} is waiting on a person: ${title}`,
        });
      break;
    case "completed":
      said.push({
        key: `${attempt}:completed`,
        text: `${agentName} finished ${title}`,
      });
      break;
    case "failed":
      said.push({
        key: `${attempt}:failed`,
        text: `${agentName} failed ${title}${error ? `: ${error}` : ""}`,
      });
      break;
    default:
      break;
  }
  return said;
}

// Announces a session's requests and state changes wherever it is shown
// (a channel's session card, the session's page). Two surfaces showing the
// same session announce it once.
export function useAnnounceSession(
  session: AnnouncedSession | null | undefined,
  agentName: string,
  title: string,
  error?: string | null,
) {
  const announce = useAnnounce();
  const seen = useRef<AnnouncedSession | null>(null);
  const words = useRef({ agentName, title, error });
  useEffect(() => {
    words.current = { agentName, title, error };
  });
  useEffect(() => {
    if (!session) return;
    const previous = seen.current;
    seen.current = session;
    if (previous?.id !== session.id) return;
    const { agentName, title, error } = words.current;
    for (const { key, text } of sessionAnnouncements(
      previous,
      session,
      agentName,
      title,
      error,
    ))
      announce(text, { key });
  }, [session, announce]);
}
