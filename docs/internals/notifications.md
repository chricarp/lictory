# Notifications

Notifications exist to unblock work. They tell a person that something is asked
of them or changed in work they are part of. They are not an activity feed.

## Inbox

The Inbox has two views of what is addressed to a person:

- **Updates**: notifications, a history of events with read and archived state.
- **To do**: current work derived from live state (reviews waiting on me, my
  items blocked or with changes requested, my items ready). An entry leaves when
  the state resolves; nothing needs marking as read.

They answer different questions ("what happened?" and "what is waiting on me?")
and are kept as separate views, but in one place.

## Events

The catalog (`src/notifications/catalog.ts`) is the single list of notification
kinds, their category and their default channels. Defaults follow one rule:

- **Asks something of you** (review requested, mentioned, blocking discussion,
  approval went stale, assigned, suggestion to review, export failed): in the
  app and by email.
  A pull request becoming ready to merge also asks something of its author:
  it is derived from the merge requirements, not from one person's action
  (see Lictory Actions in [Lictory Intelligence](ai.md)).
- **Informs you** (status changed, reply, discussion resolved, iteration
  started…): in the app only.
- **Noisy** (every specification revision): off until someone opts in.

Notifications are derived from the domain activity a command logs, inside the
same transaction (`notifyItemActivity`, `notifyIteration`, `notifyExport`). A
notification never exists for a change that rolled back and never goes missing
for one that committed. Messages log no activity; replies and mentions are read
from the command itself.

## Recipients

A person is involved in a work item when they created it, are its assignee,
requested or were named to review it, authored or replied to a discussion,
authored or reviewed a suggestion, or explicitly watch it. Discipline-targeted
review requests reach every member of the discipline, but only people named
directly count as involved afterwards. Iteration notifications reach the
project's members.

Explicit watch state lives in `work_item_watcher`. Watching subscribes someone
without involvement; unwatching silences ambient updates despite involvement.
Neither affects requests addressed to the person (review requests, mentions,
assignment, stale approvals): those always follow preferences only.

Always:

- the actor is never notified of their own action;
- recipients must be current organization members at write time, and again at
  read and email time;
- one event yields at most one notification per person and item: the most
  specific wins (a mention beats "new discussion"; a stale approval beats
  "revised").

Mentions are stored in message Markdown as `@[Name](mention:USER_ID)`. The
label is display text; the server trusts only the ID after checking membership.

## Preferences

Only explicit choices are stored. For a kind, the most specific rule wins:
team, then project, then organization, then the catalog default. A team rule
beats a project rule because a team is where people do the work; items without
a team use the project rule. Email is a
delivery of an in-app notification and is never sent on its own: a
notification is either off, on, or on with email.

## Email

Notifications that resolve to email get a `notification_email` outbox row in the
same transaction. Delivery is at-least-once to the provider with a stable
idempotency key per notification:

- the outbox row commits with a `lictory_work` signal, so the worker sends
  it within moments; the worker also polls every 30 seconds;
- rows are claimed with `FOR UPDATE SKIP LOCKED` plus a two-minute lease, so
  overlapping runners never pick the same row. A runner only sends while most
  of its lease remains, writes outcomes only while it still holds the lease,
  and returns rows it did not reach (on shutdown, or when the batch runs
  long). A row whose runner died is sent again after the lease expires, with
  the same idempotency key (Resend deduplicates it; SMTP cannot, so a crash
  between sending and recording can still deliver twice);
- failures retry with exponential backoff up to five attempts, then stay
  `failed` with the provider's error;
- recipients who left the organization, or archived the notification, are
  `skipped`.

Realtime is an invalidation only: `pg_notify('lictory_notification')` carries
organization and user IDs, the SSE stream forwards a content-free signal to the
matching user, and the client refetches.
