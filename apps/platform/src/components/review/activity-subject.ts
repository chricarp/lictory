// Who an item history entry says acted (docs/internals/software-factory.md:
// "Forge via Ada", attribution to policies and automation).

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// Factory-loop entries rendered as the agent's or the claim's own sentence
// (claims/activity.tsx); they name the agent themselves.
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
  if (!claimSentences.has(action)) {
    if (d.automation === "definition_of_done")
      return system("Definition of Done", `for ${person}`);
    if (d.automation === "autopilot")
      return system("Autopilot", `policy set by ${person}`);
    if (d.automation === "lease_expired") return system("Lictory");
  }
  const surfaces = new Set(["agent", "mcp", "runner"]);
  const agent =
    d.performedVia === "runner"
      ? str(d.agentName)
      : typeof d.performedVia === "string" && !surfaces.has(d.performedVia)
        ? d.performedVia
        : undefined;
  if (agent && !claimSentences.has(action))
    return { kind: "agent", name: `${agent} via ${person}`, agent };
  return { kind: "person", name: person, agent: "" };
}
