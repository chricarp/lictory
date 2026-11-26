import { useMemo, useState } from "react";
import { Bot } from "lucide-react";
import type { SessionStatus } from "@lictory/core/factory/entities";
import { Button } from "@lictory/ui/button";
import { LoadingState } from "@lictory/ui/spinner";
import { Segmented, SegmentedItem } from "@lictory/ui/segmented";
import { Panel } from "@lictory/platform/components/shell/panel";
import {
  FactoryPage,
  SessionRow,
} from "@lictory/platform/components/factory/parts";
import { useFactory } from "@lictory/platform/components/factory/store";

// Every session the Factory keeps in view (the most recent ones), newest
// first, narrowed by where it stands: the place to find yesterday's run or
// the sessions that failed. The overview shows what needs attention now.

type Filter = "all" | "active" | "failed" | "completed" | "canceled";

const filters: { value: Filter; label: string; statuses: SessionStatus[] }[] = [
  { value: "all", label: "All", statuses: [] },
  {
    value: "active",
    label: "Active",
    statuses: ["queued", "assigned", "running", "waiting"],
  },
  { value: "failed", label: "Failed", statuses: ["failed"] },
  { value: "completed", label: "Completed", statuses: ["completed"] },
  { value: "canceled", label: "Canceled", statuses: ["canceled"] },
];

const PAGE = 50;

export function FactorySessions() {
  const { sessions, agentById, complete } = useFactory();
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const listed = useMemo(() => {
    const statuses = filters.find((f) => f.value === filter)?.statuses ?? [];
    return sessions
      .filter((s) => !statuses.length || statuses.includes(s.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [sessions, filter]);
  const label = filters.find((f) => f.value === filter)?.label ?? "All";
  return (
    <FactoryPage description="The organization’s 200 most recent agent sessions, newest first: who started each, where it stands and what it changed. Open one for its full log.">
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
        <Segmented
          value={filter}
          onValueChange={(next) => {
            setFilter(next);
            setShown(PAGE);
          }}
          aria-label="Show sessions"
        >
          {filters.map((f) => (
            <SegmentedItem key={f.value} value={f.value}>
              {f.label}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>
      {!complete && !sessions.length ? (
        <LoadingState label="Loading sessions" />
      ) : (
        <Panel
          title={filter === "all" ? "Sessions" : `${label} sessions`}
          icon={<Bot />}
          count={listed.length}
          empty={
            filter === "all"
              ? "No agent sessions yet. Start one from the overview, or mention an agent in a channel."
              : `No ${label.toLowerCase()} sessions among the recent ones.`
          }
        >
          {listed.slice(0, shown).map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              agent={agentById.get(session.agentId)}
              showOutcome={
                session.status === "completed" ||
                session.status === "failed" ||
                session.status === "canceled"
              }
            />
          ))}
        </Panel>
      )}
      {listed.length > shown && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShown((n) => n + PAGE)}
          >
            Show {Math.min(PAGE, listed.length - shown)} more
          </Button>
        </div>
      )}
    </FactoryPage>
  );
}
