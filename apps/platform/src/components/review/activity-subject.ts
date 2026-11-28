// Who an item history entry says acted (docs/internals/software-factory.md:
// "Forge via Ada", attribution to policies and automation).

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// Factory-loop entries (claims/activity.tsx): their subject is the agent
// acting for its person, or the automation that acted, like every other
// entry, so the history reads in one shape.
const claimSentences = new Set([
  "claimed",
  "claim_released",
  "claim_completed",
  "claim_progress",
  "claim_question_asked",
  "claim_dispatch_failed",
  "autopilot_merge_requested",
  "autopilot_merge_refused",
]);

type Subject = {
  kind: "person" | "agent" | "system";
  name: string;
  agent: string;
  // Who the entry is accountable to when the subject is not that person.
  after?: string;
};

// Who the history says acted: the person; an agent with the person it
// acts for ("Hawk via Bo"); or what acted by itself (the Definition of
// Done, Autopilot, Lictory) with the person it acted for. Readiness is
// evidence, never a person's act.
export function activitySubject(
  action: string,
  d: Record<string, unknown>,
  person: string,
): Subject {
  const system = (name: string, after?: string): Subject => ({
    kind: "system",
    name,
    agent: "",
    after,
  });
  const automatic = d.automatic === true;
  if (
    ((action === "branch_deleted" ||
      action === "pull_request_ready_to_merge") &&
      automatic) ||
    // Code linked because it names the item's key.
    (action === "code_linked" && d.source === "key")
  )
    return system("Lictory");
  if (action === "refinement_changed" && automatic)
    return system("Lictory", `after a change by ${person}`);
  if (claimSentences.has(action)) {
    const name = str(d.agentName) ?? "An agent";
    if (action.startsWith("autopilot_"))
      return system("Autopilot", `policy set by ${person}`);
    if (action === "claim_completed")
      return d.reason === "definition_of_done"
        ? system("Definition of Done", `for ${person}`)
        : system("Lictory", `for ${person}`);
    // A person released the agent's claim: their act.
    if (action === "claim_released" && d.reason === "person")
      return { kind: "person", name: person, agent: "" };
    return { kind: "agent", name: `${name} via ${person}`, agent: name };
  }
  if (d.automation === "definition_of_done")
    return system("Definition of Done", `for ${person}`);
  if (d.automation === "autopilot")
    return system("Autopilot", `policy set by ${person}`);
  if (d.automation === "lease_expired") return system("Lictory");
  const surfaces = new Set(["agent", "mcp", "runner"]);
  const agent =
    d.performedVia === "runner"
      ? str(d.agentName)
      : typeof d.performedVia === "string" && !surfaces.has(d.performedVia)
        ? d.performedVia
        : undefined;
  if (agent) return { kind: "agent", name: `${agent} via ${person}`, agent };
  return { kind: "person", name: person, agent: "" };
}

// An approval its own reviewer then accepted is one act ("accepted Juno's
// suggestion"), not two lines: the approval folds into the acceptance.
// Approvals by someone else, or never followed by acceptance, stay.
export function foldActivity<
  T extends {
    action: string;
    actorId: string | null;
    detail?: Record<string, unknown> | null;
  },
>(entries: readonly T[]): T[] {
  const accepted = new Set(
    entries
      .filter(
        (e) =>
          e.action === "suggestion_merged" ||
          e.action === "suggestion_accepted",
      )
      .map((e) => `${String(e.detail?.suggestionId)}:${e.actorId}`),
  );
  return entries.filter(
    (e) =>
      e.action !== "suggestion_approved" ||
      !accepted.has(`${String(e.detail?.suggestionId)}:${e.actorId}`),
  );
}
