import type { ReactNode } from "react";

// Item history entries of the factory loop (docs/internals/claims.md). The
// actor is the accountable person; the agent and any automation are named
// in the sentence, so "Ada · Forge claimed this" never reads as Ada's own
// keyboard.

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

const releaseReasons: Record<string, string> = {
  agent: "released it",
  person: "released the claim",
  expired: "lost the claim: the lease expired without renewal",
  item_moved: "ended the claim: the item left progress",
  item_canceled: "ended the claim: the item was canceled",
  item_archived: "ended the claim: the item was archived",
  launch_failed: "could not start a session",
  session_failed: "stopped: its agent session failed",
  session_canceled: "stopped: its agent session was canceled",
};

export function claimActivity(
  action: string,
  d: Record<string, unknown>,
): ReactNode | undefined {
  const agent = <b>{str(d.agentName) ?? "An agent"}</b>;
  switch (action) {
    case "claimed":
      return (
        <>
          · {agent} claimed this
          {d.automation === "dispatcher"
            ? str(d.policyLabel)
              ? `, dispatched by the ${str(d.policyLabel)}`
              : " (dispatched)"
            : ""}
        </>
      );
    case "claim_released":
      return (
        <>
          · {agent} {releaseReasons[str(d.reason) ?? ""] ?? "released it"}
          {str(d.note) ? <>: “{str(d.note)}”</> : null}
          {str(d.returnedTo) ? <> · back to {str(d.returnedTo)}</> : null}
        </>
      );
    case "claim_completed":
      return (
        <>
          · {agent}&apos;s claim completed
          {d.reason === "definition_of_done"
            ? " by the Definition of Done"
            : " when the item moved to Done"}
        </>
      );
    case "claim_progress":
      return (
        <>
          · {agent}: {str(d.note)}
        </>
      );
    case "claim_question_asked":
      return <>· {agent} asked a question about the specification</>;
    case "claim_question_resolved":
      return (
        <>
          resolved {agent}&apos;s question
          {d.resumed === true ? "; the claim resumed" : ""}
        </>
      );
    case "claim_dispatch_failed":
      return (
        <>
          · {agent} could not start: {str(d.reason)}
          {d.held === true ? " Dispatch is held until someone retries." : ""}
        </>
      );
    case "dispatch_retried":
      return (
        <>
          retried dispatching after {num(d.failures)} failed{" "}
          {num(d.failures) === 1 ? "start" : "starts"}
        </>
      );
    case "definition_of_done_passed":
      // Its subject is the Definition of Done itself.
      return <>passed: every check passed</>;
    case "done_signed_off":
      return (
        <>
          signed off <b>{str(d.label)}</b>
          {num(d.revision) ? ` for revision ${num(d.revision)}` : ""}
        </>
      );
    case "done_sign_off_withdrawn":
      return (
        <>
          withdrew the sign-off of <b>{str(d.label)}</b>
        </>
      );
    case "done_check_overridden":
      return (
        <>
          passed <b>{str(d.label)}</b> by hand: “{str(d.reason)}”
        </>
      );
    case "done_override_withdrawn":
      return (
        <>
          withdrew the override of <b>{str(d.label)}</b>
        </>
      );
    case "autopilot_merge_requested":
      return (
        <>
          · Autopilot requested the merge of <b>{str(d.title)}</b> under this
          person&apos;s policy (version {num(d.policyVersion)})
        </>
      );
    case "autopilot_merge_refused":
      return (
        <>
          · Autopilot did not merge <b>{str(d.title)}</b>: {str(d.reason)}
        </>
      );
    default:
      return undefined;
  }
}
