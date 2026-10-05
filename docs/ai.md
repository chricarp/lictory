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

## Lictory Intelligence Context

Organization administrators give Lictory AI knowledge about how the
organization works, at three scopes: the organization, a project and a team.
Entries are written Markdown notes or uploaded documents (PDF, Office,
OpenDocument, RTF, EPUB, CSV, Markdown, text) converted to Markdown on the
server with anydoc. Conversion is local. Scanned PDFs need OCR, which would
send the file to a third party, so they are rejected.

- **Compounding.** A review of work in project P and team T receives the
  organization's active entries, P's and T's. The narrower scope wins on
  conflict: team over project, project over organization.
- **Budget.** At most `CONTEXT_PROMPT_BUDGET` characters are sent per run.
  Narrower scopes are kept first. An entry that does not fit is trimmed or left
  out, and the run records this.
- **Versions.** Content lives in immutable versions. An edit or a re-upload
  adds a version. Archiving is reversible and stops the entry from reaching
  the AI.
- **Citations.** Findings name the entries they relied on, and the run records
  the exact versions it received. "What was the AI told?" stays answerable
  after the context changes.
- **Authority.** Every member can read context; only administrators can change
  it, and the server checks this. Context grounds a review. It cannot change
  the review rules or output, it is never quoted as evidence, and AI never
  proposes edits to it.
- Uploaded bytes are not kept; the version stores the converted text with the
  file's name, format, size and SHA-256.

## Data sent to the provider

The following content is sent: specifications of the analysed items (truncated
when long), their first open discussion messages, statuses, estimates and
relations, the changed lines of the pull request, and the applicable Lictory
Intelligence Context.

Requests use `store: false`.

`LICTORY_AI_MODEL` selects the model; the default is `gpt-6-luna`. The provider
is an adapter (`src/ai/analyzer.ts`). The domain depends on the `Analyzer`
interface only.
