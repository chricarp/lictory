# Account and workspace onboarding

A new account verifies its email (or authenticates with a configured identity
provider) and chooses a platform-wide handle. The handle makes mentions and
identity understandable; it can be changed later in account settings.

The workspace entry point explains the refinement workflow and asks whether the
person is creating an organization or joining one. Choosing to join never
creates an organization or alters an existing organization's configuration.
Invitations are discovered using the authenticated account's email through Better
Auth, rather than an organization search or a client-supplied identity. Only
pending, unexpired invitations are shown. The waiting screen checks every 30
seconds while visible, on window focus, and on explicit refresh. Its intent is
kept in the URL, so reloading preserves the choice. The person can return to
creating an organization or use account settings to sign out and change accounts.
Invitation links preserve the existing authentication and handle flow.

## Explicit initial decisions

Onboarding asks only for decisions that change how the workspace behaves, and
fills everything else with defaults that can be changed in settings. Each screen
holds one decision; dependent controls appear in place when they become relevant.

The organization creator names the organization and the first project (with its
lasting key) on one screen. The organization is created immediately through Better
Auth; the project is carried as a browser draft into guided setup and created
there, together with the team configuration, in one command. An invited member of
an unfinished organization waits for an administrator instead of being asked to
make administrator decisions.

| Decision                            | Why it is needed                                             | Default / later changes                                        |
| ----------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Organization name                   | Names the shared workspace                                   | Organization settings                                          |
| Project name and key                | Gives work a home and stable identifiers                     | The name can change; the key is lasting identity               |
| Native or Jira Cloud delivery       | Establishes which system owns delivery                       | No default. Team settings; delivery ownership rules apply      |
| Readiness policy (native only)      | Makes the starting-work gate explicit                        | Warn. Team settings; external export always requires it        |
| Cadence and estimates (native only) | Defines native delivery behavior                             | No default. Team settings                                      |
| Automatic cycle schedule            | Establishes cadence before cycles start                      | 2 weeks from Monday. Team settings; needs the server scheduler |
| Lictory Intelligence                | Allows Lictory Intelligence chat, reviews and proposed fixes | Enabled. Organization settings → Lictory Intelligence          |
| Reviewers to invite                 | Refinement needs engineering and QA in the loop              | Optional. Settings                                             |

The starter team takes the project's name and can be renamed in team settings.
Starter types, workflow and roles are seeded by Better Auth's organization creation
hook and are not presented for confirmation. Planning and estimates stay owned by
Jira for external teams. A project with archived work is not a new organization:
archiving every project does not repeat initial onboarding or silently reset team
configuration.

Invitees join as members; roles are assigned once they are in the organization.
Reviewers are chosen for individual specifications when requesting review;
onboarding does not grant approvals or preassign every discipline to every item.
Both delivery modes include an organization-wide Lictory Intelligence choice.
Enabling it permits relevant organization content to be sent to the configured
AI provider when Lictory Intelligence runs. Lictory Intelligence proposes changes;
people accept changes and grant approvals. Disabling it removes Lictory
Intelligence chat, automated reviews and proposed fixes; manual refinement, review
and delivery remain available. If the server has no AI provider, setup saves the
preference and explains that Lictory Intelligence is unavailable until one is
configured. SSO administration and providers that are not implemented are not
presented as available configuration. Collaboration requires neither Lictory
Intelligence nor a delivery integration.

## Completion and recovery

The first project's `createProject` command carries a validated `setup` decision.
The shared organization transaction lock protects current Better Auth membership,
administrator authorization, same-organization team validation, the first-project
guard, team configuration, the organization Lictory Intelligence policy, automatic cycle creation when selected, project
creation, and the `organization_onboarding` decision snapshot. These commit with
the normal change log and idempotent receipt, or all roll back. Concurrent initial
setups cannot overwrite the winner's configuration. The decision snapshot records
who completed setup and when; it is historical evidence, not current settings.
Legacy setup commands without a Lictory Intelligence choice preserve the
organization's existing Lictory Intelligence policy; they do not grant consent implicitly.

Setup is submitted online through the existing authenticated, same-origin sync
mutation endpoint. Its mutation ID and complete payload are retained for retries.
After an ambiguous network failure, editing is disabled until the same command
confirms its result. A definite client rejection permits correction. A receipt
never advances a client checkpoint: the client reads through synchronization and
refreshes server routing after success.

Draft form progress is kept in session storage partitioned by user and
organization. It survives reloads in the same tab; it is not cross-device state
and is not required for server correctness. When browser storage is unavailable,
the current tab can still complete setup and retry with its in-memory mutation.
Invitations chosen during setup are sent after the setup command commits, one
Better Auth invitation per recipient. The decision snapshot records how many were
requested. If any delivery fails, the workspace is already usable: the creator sees
which recipients failed and why, and can retry them (pending invitations are
reused) or continue without them. The empty first project points to creating a
proposal, inviting teammates, reviewing team choices, and configuring Jira when
necessary.

Motion uses `motion/react` with `MotionConfig reducedMotion="user"`: steps slide in
the direction of travel, selection indicators glide between options and dependent
fields expand in place. Reduced-motion users get instant state changes.

## Invitation delivery

Administrators invite by email or an exact platform username (with or without
`@`). Username resolution happens on the server after invitation permissions are
checked. The invitation remains bound to the account’s email; acceptance still
requires an authenticated account with that address. The response does not expose
the address behind a username.

Invitations are Better Auth membership operations, outside workspace command
receipts. Email delivery uses the shared SMTP/Resend transport and is awaited.
Existing accounts receive a sign-in invitation; new people receive account
creation instructions. The invitation destination survives account creation,
verification, social authentication, and handle selection. No account is
provisioned and no membership is granted until the recipient accepts.

Better Auth persists an invitation before sending its email. A delivery failure
is reported to the sender, who can retry the same recipient; a pending invitation
is reused and its expiration renewed. Resend delivery keys include the invitation
and renewed expiration. SMTP message IDs identify attempts but do not guarantee
provider deduplication. Invitation emails are transactional and independent of
review notification preferences.
