import type { StateMachine } from "@lictory/core/contracts/state-machines";

export class DomainError extends Error {
  constructor(
    public category:
      "forbidden" | "unavailable" | "not_found" | "conflict" | "validation",
    message: string,
    public currentRevisionId?: string,
    // Machine-readable reason clients can act on, e.g. "two_factor_required".
    public kind?: string,
  ) {
    super(message);
  }
}

// Refuses a step its declared state machine does not allow from the current
// state (contracts/state-machines.ts), in the table's words. `invalid_state`
// tells a caller the entity moved on: read it again instead of retrying.
export function requireStep<S extends string, A extends string>(
  machine: StateMachine<S, A>,
  state: S,
  step: A,
  category: DomainError["category"] = "conflict",
) {
  const message = machine.refusal(state, step);
  if (message)
    throw new DomainError(category, message, undefined, "invalid_state");
}
