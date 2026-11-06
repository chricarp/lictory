# Account deletion

A person can delete their own account from Account settings. History refers to
accounts: revisions, reviews, approvals, threads, decisions and audit entries
name their author, and history is never rewritten. Deleting an account
therefore **anonymizes** it instead of removing the row.

## What deletion removes

In one transaction, under the locks of every organization the person belongs
to:

- every way to act as the person: sessions, password and linked sign-in
  providers, passkeys, two-factor secrets and backup codes, personal access
  tokens and pending one-time tokens (password reset);
- contact details and likeness: the email address (replaced with an address on
  the reserved `.invalid` domain, so the real one can sign up again), the
  handle and the profile photo;
- personal data that is not history: private assistant conversations, the
  notification inbox, notification preferences, watched items and records of
  what their agents called;
- organization, project, discipline and team memberships, and named access to
  [spaces](./spaces.md#access) (with the effective access derived from them).

The account is also deactivated, so no sign-in method and no token can bring
it back, and the admin console refuses every change to a deleted account.

## What it keeps

- The account row (`user.deleted_at` set) with its id and **display name**.
- Everything the person contributed, unchanged and attributed to them. Text
  they wrote (specifications, comments) is not redacted; an organization that
  must remove personal data from content edits it like any other content.
- Audit entries, with the name and email they recorded at the time. Each
  organization records `member.account_deleted`; the installation's history
  records `user.deleted`.
- Invitations the person sent.

Approvals and reviews the person gave keep the meaning they have when any
member is removed: they belong to the revision they were given for.

## Former members

People who leave an organization (removed by an administrator, left
themselves, or deleted their account) are recorded in `former_member`. The
organization's directory lists them by name only, so the app shows history as
"Ada (former member)" instead of an anonymous placeholder. Former members grant
nothing and receive nothing; someone who rejoins is a member again. The table
was backfilled from the audit log; people who left before the audit log existed
still show as "Former member".

## When deletion is refused

- The person is the only owner of an organization. They must make another
  member an owner first, or [delete the organization](./organization-deletion.md).
  Organizations already scheduled for deletion do not block it: the deletion
  still runs on its date, though nobody is left to cancel it.
- The person is the installation's only active instance administrator.

The error names the organizations involved, and nothing changes.

## Adding personal data

A new table that references users with `ON DELETE CASCADE` fails the account
deletion test until `deleteAccount` (`packages/core/src/domain/account-deletion.ts`)
either removes the person's rows or the test records that they are kept on
purpose.
