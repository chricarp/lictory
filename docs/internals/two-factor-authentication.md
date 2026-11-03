# Two-factor authentication and passkeys

Password accounts can add a second factor, and anyone can sign in with a
passkey. Organizations can require two-factor authentication for their
members. Better Auth (`twoFactor` and `@better-auth/passkey`) implements the
factors; Lictory owns the organization policy, its enforcement and recovery.

## Factors

- **Authenticator app (TOTP).** Turning it on returns an `otpauth://` URI (QR
  code and setup key in Account settings) and ten backup codes. It is active
  only after the person enters a valid code. Better Auth stores the secret and
  backup codes encrypted with `BETTER_AUTH_SECRET`; backup codes are shown
  once, each works once, and replacing them invalidates the previous set.
  Turning it off needs the password (when the account has one) and a fresh
  session.
- **Second step at sign-in.** Only email and password sign-ins ask for the
  code or a backup code. Google and Microsoft sign-ins rely on the provider's
  own checks; organizations that need more should use their identity
  provider's multi-factor policy. People without a password can still turn
  it on (and so meet an organization's requirement); it is asked for once
  they add a password. "Trust this device" is not offered.
- **Passkeys (WebAuthn).** A sign-in method of their own, added and removed in
  Account settings. The relying party is the platform's one public origin
  (`PLATFORM_URL`, see `auth-base-url.ts`): `rpID` is its host name and the
  expected origin is exactly that origin, never a request header. Changing
  `PLATFORM_URL` to another host makes existing passkeys unusable, as WebAuthn
  binds them to the host name. A passkey does not count as two-factor
  authentication, because the password still signs in on its own.

## Organization policy

Organization administrators can require two-factor authentication
(Organization settings → Security, `organization_security_policy`). A member
without it is **held**: still a member, still listed, able to sign in and
enroll, but refused the organization's data until they turn it on. The hold is
derived from current state on every check, so enrolling lifts it at once and
turning two-factor off holds the person again.

Enforcement is on the server, wherever organization access is authorized:

- `authorize` (every domain command from every surface, workspace reads,
  presence and realtime events) refuses a held member;
- the capability registry refuses any capability naming a held organization
  before it runs (web, MCP and Litto);
- Zero's query endpoint refuses synced queries for a held organization;
- the directory, attachment, notification and Lictory Intelligence context
  membership checks refuse held members too.

Refusals are `forbidden` errors of kind `two_factor_required`. `GET
/api/session` lists the organizations holding the person so the browser shows
"Turn on two-factor authentication" instead of a broken workspace; that screen
is a convenience, not the enforcement. Email notifications are not session
access and keep their usual rules.

Lockout rules:

- Requiring two-factor needs the acting administrator's own two-factor, so
  whoever turns it on can still get in. Other administrators without it are
  held like any member and enroll to regain access.
- Turning the requirement off is always possible for an administrator who is
  not held.
- Every change is recorded in `configuration_audit`
  (`setTwoFactorRequirement`, with the previous value).

## Recovery

1. **Backup codes**: a person who lost their authenticator signs in with one,
   then sets up a new authenticator (turn off, turn on) or replaces the codes.
2. **Administrator reset**: an organization administrator removes a member's
   authenticator, backup codes and trusted-device records (Organization
   settings → Security → Reset two-factor). The member's password and passkeys
   stay; if the organization requires two-factor they are held until they
   enroll again. Rules: the administrator needs their own two-factor, cannot
   reset themselves (they use Account settings), and only an owner can reset
   an owner. The reset is recorded in `configuration_audit`
   (`resetMemberTwoFactor`, with the member's id and email).

Resetting is organization-level rather than an instance operator action
because organization administrators are the people who can verify a member's
identity and already decide who belongs. Two-factor is a property of the
person, so a reset by one organization's administrator also affects the
person's other organizations; this is why it requires the administrator's own
second factor and leaves an audit entry. An instance operator can still
recover an account (for example the last owner of an organization) by
deleting the person's `two_factor` row and clearing `user.two_factor_enabled`
in the database.

## Storage

`two_factor` and `passkey` are Better Auth tables (generated with `bun run
auth:generate`); `user.two_factor_enabled` is Better Auth's flag. None of them,
nor `organization_security_policy`, is in the `lictory_zero` publication.
