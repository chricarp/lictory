# Lictory AI

Lictory AI raises validations, suggestions and questions about work items and
specification pull requests. It proposes; people decide.

## Authority

- AI never writes main, approves, resolves discussions or merges. Its changes
  are commits on its own branches or suggestions a person commits.
- Lictory AI is a non-human actor (`lictory-ai`) with no credentials and no
  organization membership. It authors the commits, pull requests and
  discussions it creates. Every run records who requested it.
- An organization administrator must enable AI (`setAiPolicy`). It is off by
  default and unavailable when the server has no `OPENAI_API_KEY`. Turning it
  off fails queued runs before any content is sent.

## Runs

A run (`ai_run`) is one execution: an **item review** or a **Lictory Action**
on a pull request head. A request is queued inside the organization
transaction. The model runs outside it, after the response (`after()`). Results
are written back in a short transaction under the organization lock, with
change-log entries so every client sees queued → running → completed or failed.
The scheduled job retries runs whose worker was lost (lease of 10 minutes, at
most 3 attempts).

Runs are history. They are completed, failed, superseded or marked stale, and
never deleted or rewritten.

## Item review

- The analysis covers the item, its ancestors and its descendants.
- The run records the main revision of every analysed item.
- A new main revision of any of those items marks the review **stale**. A stale
  review stays readable but cannot open corrective pull requests.

The score is deterministic: 100 minus a fixed weight per finding (blocker 25,
major 10, minor 3, note 0), bounded to 0..100. The model never chooses the
number.

Model output is untrusted:

- Findings about items outside the analysed context are dropped.
- A proposed edit is kept only if it applies to the exact content that was
  reviewed. It must quote existing text, or append under a section.

A corrective pull request applies only the findings a person selected. It does
so deterministically, without another model call. Lictory AI opens one branch
and pull request per affected item and invites the requester as a
collaborator. It reviews like any other pull request.

## Lictory Action

Lictory Action runs when a pull request is ready for review and on every new
commit to its source branch. Drafts wait. A new head supersedes pending runs.

Results become pull request discussions: one rundown thread, plus one thread
per finding.

- When a later run still sees an issue, it replies in the same thread.
- When an issue is gone, it says so and leaves resolution to people.
- A suggested change is committed by the person who accepts it.

Each team chooses a policy:

| Policy   | Behaviour                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| off      | Runs only when someone asks.                                                                                                                                   |
| advisory | Runs automatically; findings inform.                                                                                                                           |
| required | Merge waits for a completed run on the current head. Blocker findings open blocking discussions, which people can resolve or mark non-blocking like any other. |

The required gate applies only while AI is enabled and configured, so turning
AI off never traps a pull request.

## Data sent to the provider

The following content is sent: specifications of the analysed items (truncated
when long), their first open discussion messages, statuses, estimates and
relations, and the changed lines of the pull request.

Requests use `store: false`.

`LICTORY_AI_MODEL` selects the model; the default is `gpt-6-luna`. The provider
is an adapter (`src/ai/analyzer.ts`). The domain depends on the `Analyzer`
interface only.
