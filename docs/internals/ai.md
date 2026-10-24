# Lictory Intelligence

Lictory Intelligence raises validations, suggestions and questions about work
items and specification pull requests. It proposes; people decide.

The name covers every AI-assisted activity in Lictory: item reviews, the
Lictory Intelligence review action on pull requests, chat, dictation and the
context that grounds them. Its mark is the Lictory logomark with a spark, not
a generic AI icon. Code keeps the shorter `ai` prefix (`ai_run`,
`setAiPolicy`, the `lictory-ai` actor id) because those names are stored in
history and in the protocol.

**Litto** is the conversational assistant, powered by Lictory Intelligence
and its shared organization, project and team context. The assistant's page,
dock and conversations use the Litto name. AI settings, context, automated
reviews and the non-human review actor remain Lictory Intelligence. The
assistant name does not change stored identifiers, routes or authorization.

## Authority

- Lictory Intelligence never writes main, approves, resolves discussions or
  merges. Its changes are commits on its own branches or suggestions a person
  commits.
- Lictory Intelligence is a non-human actor (`lictory-ai`) with no credentials
  and no organization membership. It authors the commits, pull requests and
  discussions it creates. Every run records who requested it.
- An organization administrator must enable Lictory Intelligence
  (`setAiPolicy`). It is off by default and unavailable when the server has no
  `OPENAI_API_KEY`. Turning it off fails queued runs before any content is
  sent.

## Runs

A run (`ai_run`) is one execution: an **item review** or a run of the
**Lictory Intelligence review** action on a pull request head. A request is
queued inside the organization transaction, which also signals the worker. The
worker claims one run at a time (status `running`, `started_at` as the lease,
`attempts` + 1, under the organization lock) and calls the model outside any
transaction. Results are written back in a short transaction under the
organization lock, with projections so every client sees queued → running →
completed or failed.

- The model call has a hard deadline of five minutes (the provider call itself
  gives up after four, retries included), well inside the ten-minute lease, so
  a live worker never has its run claimed by another.
- A run still `running` after the lease lost its worker and is claimed again,
  at most three attempts in total. Writing a result is fenced on the status
  and attempt number: a stale attempt that finishes late changes nothing.
- On shutdown the worker cancels the model call and puts the run back in the
  queue for the next worker instead of failing it.

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
so deterministically, without another model call. Lictory Intelligence opens
one branch and pull request per affected item and invites the requester as a
collaborator. It reviews like any other pull request.

People start an item review from the Litto dock ("Assess PAY-142") while
the item is open. The dock follows the run and shows its score and top
findings; the full findings and corrective pull requests open in the item.

## The Litto dock

Every workspace page except the Litto page has a small dock at the
bottom (⌘J / Ctrl+J). It opens into a conversation with the same assistant,
tools and approvals as the Litto page, without the history list.

- **Page context.** Each message the person sends from the dock carries what
  they were looking at: the page, the project, the open work item, the text
  they selected in its specification and the review they were reading. It is
  a `data-context` part of their message: validated by the server, stored with
  the transcript and shown above the message. It only names things; the
  assistant still reads them through tools with the person's permissions, so
  context cannot widen access.
- **Adapts to the page.** The bar offers what fits: explaining a selection,
  assessing the open item (or its score once assessed), or questions for the
  board, backlog, inbox and other pages.
- **Unlisted conversations.** Dock conversations are saved like any chat but
  stay out of the history (`intelligence_chat.listed = false`) until the person
  opens them on the Litto page, which lists them.
- The dock is absent when Lictory Intelligence is off or unavailable.

## Lictory Actions

Lictory Actions are the automated checks of a pull request, shown in its
Actions tab like CI checks. Each action has its own runs and its own project
policy. The **Lictory Intelligence review** is the only action today.

The Lictory Intelligence review runs when a pull request is ready for review
and on every new commit to its source branch. Drafts wait. A new head supersedes pending runs.

Results become pull request discussions: one rundown thread, plus one thread
per finding.

- When a later run still sees an issue, it replies in the same thread.
- When an issue is gone, it says so and leaves resolution to people.
- A suggested change is committed by the person who accepts it.

Each project chooses a policy for it:

| Policy   | Behaviour                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| off      | Runs only when someone asks.                                                                                                                                   |
| advisory | Runs automatically; findings inform.                                                                                                                           |
| required | Merge waits for a completed run on the current head. Blocker findings open blocking discussions, which people can resolve or mark non-blocking like any other. |

The required gate applies only while Lictory Intelligence is enabled and
configured, so turning it off never traps a pull request.

## Lictory Intelligence Context

People give Lictory Intelligence knowledge about how the organization works, at
three scopes: the organization (organization administrators), a project and its
teams (that project's administrators).
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
  Lictory Intelligence.
- **Citations.** Findings name the entries they relied on, and the run records
  the exact versions it received. "What was Lictory Intelligence told?" stays answerable
  after the context changes.
- **Authority.** Every member can read context; only administrators can change
  it, and the server checks this. Context grounds a review. It cannot change
  the review rules or output, it is never quoted as evidence, and Lictory
  Intelligence never proposes edits to it.
- Uploaded bytes are not kept; the version stores the converted text with the
  file's name, format, size and SHA-256.

## Data sent to the provider

The following content is sent: specifications of the analysed items (truncated
when long), their first open discussion messages, statuses, estimates and
relations, the changed lines of the pull request, and the applicable Lictory
Intelligence Context.

Conversations send the person's messages, including the page context of dock
messages (with any text they selected), and the tool results the assistant
reads with their permissions.

Requests use `store: false`.

`LICTORY_AI_MODEL` selects the model; the default is `gpt-6-luna`. The provider
is an adapter (`src/ai/analyzer.ts`). The domain depends on the `Analyzer`
interface only.

## Voice dictation

The Litto composer can dictate. Words stream into the draft at the
caret where dictation started, and the person can keep editing while they
talk. Dictation only fills the draft: nothing is sent until the person sends
it.

- **Same gate as the chat.** The server issues a dictation session only to a
  member of the organization, and only while Lictory Intelligence is configured and
  enabled for that organization.
- **Audio never reaches Lictory.** The server mints a short-lived (60 s),
  transcription-only credential from the provider. The browser streams the
  microphone straight to the provider over WebRTC. The key is never sent to
  the browser, and audio is neither recorded nor stored. A hashed user
  identifier is sent as the provider's safety identifier.
- **Edits win.** While nobody touches the dictated words, the provider's final
  transcript replaces its partial words. Once the person edits inside them,
  later words are only appended and the final pass is skipped. Edits before or
  after the dictated words move its anchor. Escape cancels: untouched dictated
  words are removed, and text that was selected when dictation started is
  restored.

`LICTORY_TRANSCRIPTION_MODEL` selects the model; the default is
`gpt-live-transcribe`. The provider adapter is
`src/intelligence/voice/transcription.ts`. It calls the OpenAI Realtime API
directly because the AI SDK cannot stream this model yet.
