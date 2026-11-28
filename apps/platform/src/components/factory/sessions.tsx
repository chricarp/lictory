import { useMemo, useState } from "react";
import { Bot } from "lucide-react";
import type { SessionStatus } from "@lictory/core/factory/entities";
import { Button } from "@lictory/ui/button";
import { LoadingState } from "@lictory/ui/spinner";
import { Segmented, SegmentedItem } from "@lictory/ui/segmented";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Panel } from "@lictory/platform/components/shell/panel";
import {
  FactoryPage,
  SessionRow,
} from "@lictory/platform/components/factory/parts";
import { useFactory } from "@lictory/platform/components/factory/store";

// Every session the Factory keeps in view (the most recent ones), newest
// started first, narrowed by where it stands, by agent and by who started
// it: the place to find yesterday's run or the sessions that failed. The
// overview shows what needs attention now.

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

const ANY = "any";
// A policy's sessions have no person who asked; they are filtered as such.
const POLICY = "policy";

export function FactorySessions() {
  const { userId, memberName } = useWorkspace();
  const { sessions, agentById, complete } = useFactory();
  const [filter, setFilter] = useState<Filter>("all");
  const [agentId, setAgentId] = useState(ANY);
  const [starterId, setStarterId] = useState(ANY);
  const [shown, setShown] = useState(PAGE);
  // Only agents and people that appear in the sessions kept in view.
  const agentChoices = useMemo(
    () =>
      [...new Set(sessions.map((s) => s.agentId))]
        .map((id) => ({ id, name: agentById.get(id)?.name ?? "Removed agent" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [sessions, agentById],
  );
  const starterChoices = useMemo(() => {
    const ids = new Set<string>();
    let policy = false;
    for (const s of sessions)
      if (s.startedByPolicy) policy = true;
      else if (s.requestedById) ids.add(s.requestedById);
    const people = [...ids]
      .map((id) => ({ id, name: id === userId ? "You" : memberName(id) }))
      .sort(
        (a, b) =>
          Number(b.id === userId) - Number(a.id === userId) ||
          a.name.localeCompare(b.name),
      );
    return policy
      ? [...people, { id: POLICY, name: "An autonomy policy" }]
      : people;
  }, [sessions, userId, memberName]);
  const listed = useMemo(() => {
    const statuses = filters.find((f) => f.value === filter)?.statuses ?? [];
    return sessions
      .filter(
        (s) =>
          (!statuses.length || statuses.includes(s.status)) &&
          (agentId === ANY || s.agentId === agentId) &&
          (starterId === ANY ||
            (starterId === POLICY
              ? !!s.startedByPolicy
              : !s.startedByPolicy && s.requestedById === starterId)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [sessions, filter, agentId, starterId]);
  const narrowed = agentId !== ANY || starterId !== ANY;
  const label = filters.find((f) => f.value === filter)?.label ?? "All";
  return (
    <FactoryPage>
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-0.5">
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
        <DropdownSelect
          aria-label="Agent"
          size="sm"
          value={agentId}
          onValueChange={(next) => {
            setAgentId(next);
            setShown(PAGE);
          }}
        >
          <DropdownSelectOption value={ANY}>Every agent</DropdownSelectOption>
          {agentChoices.map((a) => (
            <DropdownSelectOption key={a.id} value={a.id}>
              {a.name}
            </DropdownSelectOption>
          ))}
        </DropdownSelect>
        <DropdownSelect
          aria-label="Started by"
          size="sm"
          value={starterId}
          onValueChange={(next) => {
            setStarterId(next);
            setShown(PAGE);
          }}
        >
          <DropdownSelectOption value={ANY}>
            Started by anyone
          </DropdownSelectOption>
          {starterChoices.map((p) => (
            <DropdownSelectOption key={p.id} value={p.id}>
              {p.id === POLICY ? p.name : `Started by ${p.name}`}
            </DropdownSelectOption>
          ))}
        </DropdownSelect>
        {narrowed && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAgentId(ANY);
              setStarterId(ANY);
              setShown(PAGE);
            }}
          >
            Clear
          </Button>
        )}
      </div>
      {!complete && !sessions.length ? (
        <LoadingState label="Loading sessions" />
      ) : (
        <Panel
          title={filter === "all" ? "Sessions" : `${label} sessions`}
          icon={<Bot />}
          count={listed.length}
          empty={
            narrowed
              ? "No matching sessions"
              : filter === "all"
                ? "No sessions yet"
                : `No ${label.toLowerCase()} sessions`
          }
        >
          {listed.slice(0, shown).map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              agent={agentById.get(session.agentId)}
              log
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
