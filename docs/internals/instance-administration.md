# Instance administration

One Lictory installation serves one company. Who may have an account on it,
who may create organizations, and who manages the installation itself are
decided by the company, not by whoever reaches the sign-up page first. This
document describes that model; the operator's side (settings, the `lictory`
command) is in [self-hosting](../operations/self-hosting.md).

## Two kinds of administrator

- **Instance administrators** manage the installation: accounts (create,
  deactivate, reactivate, set or reset passwords), other instance
  administrators, and organizations (create one for an owner, add someone to
  one). They use the admin console (`/admin`) or, with shell access to the
  server, `lictory admin`.
- **Organization administrators** (owners and admins, the application roles in
  the [organization model](./organization-model.md)) run one organization:
  its members, invitations, projects and settings.

The two are independent. Being an instance administrator grants no access to
any organization's work: an instance administrator who is not a member sees
nothing inside it, and adding themselves is an explicit, audited action. An
organization owner has no say over the installation.

Instance administrators are a flag on the account (`user.instance_admin`),
set only by another instance administrator or the server CLI. Shell access to
the server is the root of trust: `lictory admin setup` creates the first one,
and `lictory admin grant <email>` recovers an installation whose
administrators are gone. The console and the CLI both refuse to remove or
deactivate the last active instance administrator.

## Access policy

The operator sets the policy in the server's environment, so it is reviewed
and deployed like the rest of the configuration rather than toggled in the
browser. The console shows it read-only.

| Setting                         | Values                                 | Default          |
| ------------------------------- | -------------------------------------- | ---------------- |
| `LICTORY_SIGNUP_MODE`           | `invite`, `closed`, `open`             | `invite`         |
| `LICTORY_ALLOWED_EMAIL_DOMAINS` | comma-separated domains, empty for any | empty            |
| `LICTORY_ORGANIZATION_CREATION` | `administrators`, `everyone`           | `administrators` |

An invalid value stops the server at startup instead of falling back to
something more open.

Every new account has an origin, and the rules apply in this order:

1. **Administrator** (console or CLI): always allowed, any email. The address
   counts as verified, because the administrator vouches for it.
2. **Allowed domains**: any other new account must use an allowed domain.
   Subdomains are not implied.
3. **Company identity provider** (OpenID Connect): allowed. The provider is
   the company directory, so who gets an account is decided there (and by
   `OIDC_AUTO_CREATE_USERS`), not by the sign-up mode.
4. **Self-service** (email and password, Google, Microsoft), by sign-up mode:
   - `invite`: only when a pending, unexpired invitation exists for the email.
     An invitation is how an organization administrator says "this person
     belongs here".
   - `closed`: never. Invitations then reach existing accounts only, and the
     invitation endpoint refuses addresses that have no account.
   - `open`: always. For evaluation and private networks.

Organization creation is allowed for instance administrators, and for
everyone else only with `LICTORY_ORGANIZATION_CREATION=everyone`. Instance
administrators create organizations for others from the console; Better Auth
then makes the chosen person the owner and the organization is seeded exactly
as one created in onboarding.

## Enforcement

The browser only reflects the policy (it hides "Create an account" and
"Create organization" where they would fail). The server decides:

- Better Auth's user validation gate (`validateUserInfo`, action
  `create-user`) runs for every account creation, whatever the method, and
  applies the rules above. Password sign-up is also checked before Better
  Auth's own handling, because Better Auth answers refused password sign-ups
  with its generic "check your email" response, which would leave the person
  waiting for an email that never comes. Refusals have their own codes
  (`signup_invitation_required`, `signup_closed`,
  `signup_domain_not_allowed`), which provider sign-ins show on the sign-in
  page.
- The organization plugin's `allowUserToCreateOrganization` applies the
  organization rule. Server-side creation for an owner (the console) is a
  system action and bypasses it, after the console's own authorization.
- `/api/admin/*` requires a signed-in, active instance administrator for
  every request, and writes are same-origin. Administration is human-only:
  agents (MCP clients and Litto) cannot manage the installation.
- Accounts are provisioned through a server-only Better Auth endpoint (never
  on the HTTP router), so the creation gate runs with the `admin` origin.

## Deactivation

Deactivating an account sets `user.deactivated_at`, deletes its sessions, and
from then on refuses new sessions (every sign-in method) and its personal
access tokens. Nothing else changes: memberships, authored history, reviews
and approvals stay as they were, so reactivating restores the account as it
was. Deactivation is the reversible alternative to deleting an account, which
the console does not offer. A person cannot deactivate their own account.

People delete their own account from Account settings, which
[anonymizes it](./account-deletion.md). The console lists a deleted account
by name as "Deleted" and refuses every change to it: reactivating it or
setting a password would bring back an account its owner deleted.

## History

Instance administration is recorded in `instance_audit_event`, which no
organization owns. Entries name the administrator (or the server CLI) and
the account or organization they acted on, never passwords. The same history
records what an installation must remember after an organization is gone:
an owner scheduling or cancelling an organization's deletion, and the
worker's `organization.deleted` with what it removed
([organization deletion](./organization-deletion.md)). The console lists
organizations scheduled for deletion with their date; instance
administrators cannot cancel or bring forward a deletion. A database
trigger refuses updates and deletes. When the console adds someone to an
organization, that organization's own [audit log](./audit.md) records the
membership too, naming the instance administrator.
