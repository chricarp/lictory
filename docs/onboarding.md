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

The organization creator is an administrator and completes the first project and
team setup before entering the workspace shell. An invited member of an unfinished
organization sees an explanation and can check again, rather than being asked to
make administrator decisions.

| Decision                                | Why it is needed                                                    | Later changes                                                      |
| --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Organization name                       | Names the shared workspace                                          | Organization settings                                              |
| Project name and key                    | Gives work a home and stable identifiers                            | The name can change; the key is lasting identity                   |
| Team name                               | Identifies the team responsible for delivery                        | Team settings                                                      |
| Native or Jira Cloud delivery           | Establishes which system owns delivery                              | Team settings; existing delivery ownership rules still apply       |
| Readiness policy                        | Makes the starting-work gate explicit                               | Team settings; external export always requires readiness           |
| Planning and estimates                  | Defines native delivery behavior                                    | Team settings                                                      |
| Automatic cycle schedule, if chosen     | Establishes cadence before cycles start                             | Team settings; server scheduling must be configured                |
| Starter types, workflow and roles       | Confirms a small usable configuration                               | Organization and team settings                                     |
| Deferred invitations and advanced setup | Records what the creator deliberately leaves for later              | Invite, assign roles, customize in settings                        |
| Deferred Jira connection and mapping    | Allows refinement before credentials and destination are configured | Organization settings; export remains unavailable until configured |

Planning and estimates stay owned by Jira for external teams. The creator
explicitly accepts the starter work item types, workflow and roles. Better Auth's
organization creation hook provisions those starter records, but the guided setup
requires acceptance and replaces the provisional team's delivery choices before
creating the first project. A project with archived work is not a new
organization: archiving every project does not repeat initial onboarding or
silently reset team configuration.

Reviewers are chosen for individual specifications when requesting review;
onboarding does not grant approvals or preassign every discipline to every item.
AI, SSO administration and providers that are not implemented are not presented as
available configuration. Collaboration requires neither AI nor a delivery
integration.

## Completion and recovery

The first project's `createProject` command carries a validated `setup` decision.
The shared organization transaction lock protects current Better Auth membership,
administrator authorization, same-organization team validation, the first-project
guard, team configuration, automatic cycle creation when selected, project
creation, and the `organization_onboarding` decision snapshot. These commit with
the normal change log and idempotent receipt, or all roll back. Concurrent initial
setups cannot overwrite the winner's configuration. The decision snapshot records
who completed setup and when; it is historical evidence, not current settings.

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
The empty first project points to creating a proposal, inviting teammates and
assigning roles, reviewing team choices, and configuring Jira when necessary.
