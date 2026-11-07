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

## What an AI approval means

"Reviewed by AIs and humans" has three possible meanings. Lictory supports
two, and deliberately not the third:

1. **Automated check (supported).** A project's Definition of Ready can require
   a Lictory Intelligence check: the latest item review analysed the item's
   current revision and found no blocker (or no blocker or major finding)
   about it. It is shown as a readiness check that names the run, model and
   score, never as a discipline's approval, and it never satisfies
   `reviews_approved` or `discipline_approval`. See
   [the Definition of Ready](delivery.md#definition-of-ready).
2. **Delegated decision (supported).** Litto or an MCP agent records a
   person's approval on that person's explicit instruction, with their
   authority. The approval belongs to the person and the revision; activity
   records the surface it was made through (`performedVia`).
3. **Policy-authorized endorsement (not supported).** An AI reviewer counting
   toward a required discipline review. An approval states that an accountable
   person accepted a revision for their discipline; a model run cannot be
   accountable, and several agents behind one identity are not independent
   reviewers. Teams that want AI evidence to gate work use the automated check,
   which keeps the human decision visible beside it.

Guarantees of the automated check:

- **Belongs to a revision.** Only a review of the current revision counts; a
  new revision needs a new review, like an approval.
- **Never alone.** A type that requires it must also require a person's
  decision (required reviews approved, a discipline's approval or a sign-off),
  so Lictory Intelligence alone never makes a specification Ready.
- **Humans stay authoritative.** Anyone holding a discipline in the project can
  override the check for one revision (recorded like a sign-off, with activity
  saying "overrode"), and withdraw the override. False positives and a
  disabled or unconfigured Lictory Intelligence therefore never trap work, and
  turning Lictory Intelligence off never passes the check silently.
- **Moves readiness when it completes.** The worker writes the run and
  re-evaluates the item's readiness in the same transaction, so a clean review
  can make the item Ready and a later review with a blocker takes Ready away.
  Activity records the change as automatic, caused by the completed review.

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
the item is open. The dock follows the run and shows its proposed concerns,
the revision they read and whether that is still current; the item header
counts them ("2 AI concerns", or "earlier revision" once stale). The full
findings and corrective pull requests open in the item.

## Litto conversations

A conversation is private to its owner in one organization. Its execution is
stored in PostgreSQL, outside Zero's publication. API instances accept messages,
answers, approvals, retries and cancellations; workers execute the saved turns.
The browser reads saved snapshots every few seconds and when it reconnects.
Neither a browser connection nor an API process owns an answer. Snapshots carry
a monotonically increasing chat version; delayed reads cannot overwrite newer
accepted input or progress.

A turn is queued, running, waiting for input, completed, canceled or failed.
The submitted message, execution record and input receipt commit together.
Retries of the same request replay the receipt; reuse with a different payload
is rejected. A database constraint allows only one active turn per conversation,
including waiting turns. An input response targets one saved tool call or
approval; the client cannot replace the assistant transcript or its arguments.
Concurrent responses are serialized and consumed once. Waiting releases the
worker and has no execution deadline: the question remains until answered or
canceled. This applies to dock conversations as well as the full page.

Workers claim turns with a renewable lease, check current organization access
and AI policy, and recheck domain permissions on every tool execution. A lost
worker's lease expires after one minute; available workers recover it on their
next poll. Ownership tokens fence checkpoint writes from replaced workers.
Provider calls and attempts have deadlines even if an adapter ignores abort.
Repeated crashes exhaust a bounded attempt budget and become a visible failure.
Graceful shutdown queues the last completed checkpoint for another worker.

Partial text is saved about once per second. Only a completed model step is a
recovery checkpoint; recovery can replace unfinished text while preserving
completed steps, human responses and decisions. Model steps never execute tools
automatically. Tool identities and arguments commit first; stable mutation IDs
reuse the existing workspace mutation receipts. Tool results are saved before
continuing the model. If a command commits before its result is recorded,
recovery repeats the same mutation ID, preserving its original entity IDs.
Actions without safe replay semantics fail with an explicit uncertain-outcome
message when their worker disappears. They must be inspected before another
action is requested. Retry never grants a new approval or blindly repeats them.

Stop is addressed to one run and its current submission or retry request ID,
and recorded durably even when it arrives before submission. A delayed Stop
cannot cancel a later retry, and retry explicitly identifies the turn it resumes. It prevents further steps; an external action already started
may still finish. Deleting a conversation removes its runs and prevents their
workers from writing more progress. Historical transcripts remain readable;
legacy questions acquire a durable run when answered, and earlier turns ending
on a user message expose an interrupted state with Retry.

## The Litto dock

Every workspace page except the Litto page can open Litto as a side sheet:
the "Ask Litto" button at the end of the page header, ⌘J / Ctrl+J, "Ask
Litto" on a text selection, or the command palette. On wide screens the sheet
sits beside the page, which narrows instead of being covered; on small
screens it is a modal sheet over the page. It holds a conversation with the
same assistant, tools and approvals as the Litto page, without the history
list.

- **Page context.** Each message the person sends from the dock carries what
  they were looking at: the page, the project, the open work item, the text
  they selected in its specification and the review they were reading. It is
  a `data-context` part of their message: validated by the server, stored with
  the transcript and shown above the message. It only names things; the
  assistant still reads them through tools with the person's permissions, so
  context cannot widen access.
- **Pages of Lictory Spaces.** On a page the context also carries a
  discriminated `document` of kind `page` (space, page, optional branch and
  commit, optional selection with its block and quote): the exact version on
  screen (never a live draft, which is not history), the line when it is not main,
  and the text selected in the reader with the block holding it ("Ask Litto"
  under a selection, like in a specification). Every turn re-checks each page
  context with the person's access at that moment
  (`intelligence/chat/context.ts`): the page must be readable and in the
  named space, and the commit and branch must be the page's. Only then does
  the model learn its title, space, publishing policy and version; otherwise
  it is told the page is unavailable and the quoted text is withheld, even
  though the transcript still stores it for its owner. The same holds for
  earlier turns, which are sent again with every question: a tool call
  whose input or result names a page the person cannot read now (a
  `getPage` result, a search hit) reaches the model as a withheld note, and
  so does the text of an earlier answer that used one or was asked from that
  page. The stored transcript is unchanged; only the copy sent to the
  provider is.
  Quoted page text is fenced and marked as data written by people, never
  instructions.
- **Adapts to the page.** The sheet offers what fits: explaining a
  selection, assessing the open item (or its proposed concerns once
  assessed), questions for the board, backlog, inbox and other pages, and on
  Spaces: summarizing a page, drafting proposals from it, listing the work
  items it mentions and comparing it with the agreed specification of the
  items it references; on a space, its history and pull requests, what
  changed and what waits for review.
- **Unlisted conversations.** Dock conversations are saved like any chat but
  stay out of the history (`intelligence_chat.listed = false`) until the person
  opens them on the Litto page, which lists them.
- The dock is absent when Lictory Intelligence is off or unavailable.

## Evidence and citations

Litto and agents search before they describe established behavior
(`searchProductKnowledge`) and weigh what they find by authority, strongest
first:

1. an approved or delivered specification revision: agreed intent, or the
   recorded delivery scope (approval alone never proves delivery);
2. a recorded decision: a durable conclusion;
3. a page published through review (its space publishes through reviewed
   pull requests);
4. a page published directly;
5. discussion.

Published documentation is not agreed intent or delivered behavior: when a
page disagrees with an agreement, the assistant names both rather than
choosing silently. Answers cite exact versions: the revision number of a
specification, the version (and commit) of a page, linked to that version
(`?commit=`). `searchKnowledge` finds where something is written; a match is
navigation, not evidence. Results and page reads come from what the person
can read, in one snapshot per call (see
[search and product knowledge](spaces.md#search-and-product-knowledge)).

In the conversation, each step that searched or read pages lists them with
their space and version, linked to that exact version, and an answer that
rests on page reads shows those pages under it after its steps fold away.

## Proposal intake

People hand rough material (meeting notes, customer requests, support tickets,
documents) to Litto or an MCP client and get **proposed** proposals back
(`draftProposals`). Each draft has a title, the problem and expected outcome as
the sources state them, open questions, suggested reviewer disciplines and
related product knowledge. Nothing is created: the person chooses which
drafts become proposals, and they are created with the ordinary
`createWorkItem` path.

- **Evidence is checked, not trusted.** Every draft cites excerpts of the
  sources. An excerpt is kept only if it appears verbatim in the source it
  names (whitespace and typographic quotes aside); a draft with no verifiable
  excerpt is dropped. Reviewers must be active disciplines of the project, and
  knowledge or context references must be entries the model was given. What
  was removed is counted in the result (`filtered`), never silently hidden.
- **Stated and inferred stay apart.** The model lists what it inferred rather
  than read. The draft's description, which becomes the proposal's first revision,
  is assembled by the server: problem, outcome, open questions, related
  knowledge, quoted source excerpts with their labels and the inferences under
  their own heading. It never fabricates sections a readiness policy
  checks, such as acceptance criteria.
- **Same gate as reviews.** The organization must enable Lictory Intelligence,
  and the person must be able to edit specifications in the project. Both are
  checked before any document is converted or anything is sent.
- **Not stored.** The material is sent to the provider for one synchronous
  request (outside any transaction) and not kept by Lictory; only what the
  person turns into a proposal is saved. Documents are converted locally as
  for context; images are not supported yet. At most 60,000 characters across
  ten sources are analysed, and the result reports truncation.
- **Grounding.** Related knowledge comes from the project's recent recorded
  decisions and approved or delivered revisions (the `searchProductKnowledge`
  results, without published pages: drafts cite what the project agreed),
  and the organization and project Lictory Intelligence Context applies as
  for reviews. To draft from a page, Litto reads it and passes its text as a
  source labelled with the page and version.

## Lictory Actions

Lictory Actions are what happens automatically on a pull request, like CI on
code. They only produce checks, discussions and notifications: they never
approve, merge, accept scope or publish. Two exist:

- **Ready to merge** (deterministic, works without AI). When a change clears
  the last merge requirement of an open pull request (required approvals of
  the exact merge result, no changes requested, no blocking discussions, no
  conflicts, and the required review action on the current head), Lictory
  records `pull_request_ready_to_merge` and notifies the author and the source
  branch collaborators. It fires on the transition, inside the transaction of
  the change that caused it (a person's command or a finished review action
  run), so it happens once per transition and never for a change that rolled
  back. Becoming blocked and clear again notifies again. Each project turns
  it on or off (`mergeReadyNotice`, on by default, in the project's delivery
  settings); people also choose channels with notification preferences.
  Delivery uses the notification pipeline: the in-app notification commits
  with the change, and email goes through the `notification_email` outbox
  that the worker sends under a lease with a stable idempotency key. The rules are
  `mergeBlockers` in `src/contracts/merge-readiness.ts` and match the merge
  command.
- The **Lictory Intelligence review**, shown in the Actions tab like a CI
  check, with its own runs and project policy:

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

Proposal intake sends the material the person provided, the project's
discipline names and descriptions, excerpts of recent product knowledge and the
applicable Lictory Intelligence Context.

Conversations send the person's messages, including the page context of dock
messages (with any text they selected; a page of Lictory Spaces only while
they can still read it), and the tool results the assistant reads with their
permissions, such as published pages it opens with `getPage`.

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
