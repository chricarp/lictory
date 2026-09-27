"use client";
import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Users } from "lucide-react";
import { Button } from "~/components/ui/button";
import { MissingState } from "~/components/ui/status-page";
import { paths } from "~/lib/paths";
import type { Team } from "~/sync/shared/protocol";
import { useWorkspace } from "~/components/workspace/provider";

const TeamContext = createContext<Team | null>(null);

// Resolves the `[team]` route segment against the synchronized directory.
export function TeamGate({ children }: { children: ReactNode }) {
  const params = useParams<{ team: string }>();
  const { delivery, organization } = useWorkspace();
  const team = delivery.teams.get(params.team ?? "");
  if (!team)
    return (
      <MissingState
        icon={Users}
        title="Team was not found"
        action={
          <Link href={paths.inbox(organization.slug)} className="contents">
            <Button variant="secondary">Go to Inbox</Button>
          </Link>
        }
      >
        It may have been archived. Choose another team from the sidebar.
      </MissingState>
    );
  return <TeamContext.Provider value={team}>{children}</TeamContext.Provider>;
}

export function useTeam() {
  const team = useContext(TeamContext);
  if (!team) throw new Error("useTeam requires a team route.");
  return team;
}
