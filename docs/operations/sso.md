# Single sign-on

An installation can let people sign in with their company identity provider
through OpenID Connect (OIDC): Okta, Microsoft Entra ID, Keycloak, Authentik,
Google Workspace, JumpCloud, Dex and others. The sign-in and sign-up pages then
show **Continue with _display name_** above the other methods. The provider is
configured once per installation by its operator, through the environment.

Single sign-on decides who can authenticate. It grants nothing inside Lictory:
organization membership still comes from invitations, and disciplines and
roles from organization and project administrators.

## Settings

Set these on the API (and the worker, which shares the server environment).
Empty values count as unset.

| Setting                  | Meaning                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER`            | The provider's issuer URL, for example `https://acme.okta.com`. Lictory reads `<issuer>/.well-known/openid-configuration`. HTTPS is required (except loopback). |
| `OIDC_CLIENT_ID`         | Client (application) ID registered at the provider.                                                                                                             |
| `OIDC_CLIENT_SECRET`     | Its client secret. Keep it in the deployment's secret store.                                                                                                    |
| `OIDC_SCOPES`            | Extra scopes, space- or comma-separated. Default `profile`. `openid` and `email` are always requested.                                                          |
| `OIDC_DISPLAY_NAME`      | Button label, for example `Acme SSO`. Default `SSO`.                                                                                                            |
| `OIDC_AUTO_CREATE_USERS` | `true` (default) creates a Lictory account on a person's first sign-in. `false` admits only people who already have an account.                                 |
| `PASSWORD_LOGIN_ENABLED` | `false` makes an SSO-only installation (below). Default `true`.                                                                                                 |

The first three go together: setting only some of them stops the API with an
error that names them. Register this **redirect URI** (also called callback or
sign-in redirect URL) at the provider, with your `PLATFORM_URL`:

```text
https://app.example.com/api/auth/callback/oidc
```

Lictory uses the authorization code flow with PKCE and a nonce, authenticates
to the token endpoint with the client secret, and verifies ID tokens against
the issuer and signing keys published by discovery. If discovery is unreachable
or incomplete when the API starts, the provider is not registered (the API logs
`Provider "oidc"` with the reason), the button reports that the provider cannot
be reached, and other sign-in methods keep working. Restart the API once the
provider is reachable.

Signing out of Lictory ends the Lictory session only, not the session at the
identity provider.

## Accounts, email and linking

A Lictory account is one person with one email address; single sign-on becomes
a sign-in method on it, identified by the provider's stable subject (`sub`). An
email change at the provider never moves sign-in to another account.

- **The provider says the email is verified** (`email_verified: true` in the ID
  token or userinfo): a new account starts verified, and an existing Lictory
  account with the same, already verified email is linked automatically.
- **The provider does not say so** (Entra ID never sends the claim): a new
  account receives Lictory's verification email before its first session, and
  an existing account is never linked during sign-in. Its owner signs in the
  usual way and connects the provider under **Account settings → Connected
  accounts**, which requires the same email address.

Only configure a provider whose `email_verified` you trust: when it is true,
Lictory treats the address as proven.

## SSO-only installations

`PASSWORD_LOGIN_ENABLED=false` turns password sign-in off. The server then
rejects password sign-in, sign-up, password reset requests and resets, and the
pages show only the identity providers. The API refuses to start with this
setting unless an identity provider (OIDC, Google or Microsoft) is configured.
Keep `OIDC_AUTO_CREATE_USERS` on, or people you invite cannot create their
account.

Before switching passwords off on an existing installation, make sure every
person can sign in with the provider: with a provider that does not send
`email_verified`, people who registered with a password must connect it first.

## Okta

1. **Applications → Create App Integration**: _OIDC – OpenID Connect_, _Web
   Application_.
2. Grant type **Authorization Code**. Sign-in redirect URI
   `https://app.example.com/api/auth/callback/oidc`. Assign the people or
   groups who may use Lictory.
3. Settings:

   ```sh
   OIDC_ISSUER=https://acme.okta.com          # or https://acme.okta.com/oauth2/default
   OIDC_CLIENT_ID=0oa1b2c3d4e5F6g7H8i9
   OIDC_CLIENT_SECRET=<client secret>
   OIDC_DISPLAY_NAME=Okta
   ```

Okta includes `email_verified` with the `email` scope, so existing verified
accounts link on first sign-in.

## Microsoft Entra ID

The built-in **Continue with Microsoft** button (`MICROSOFT_*`) accepts any
Microsoft account. To restrict sign-in to your own tenant, register Lictory as
a single-tenant OIDC application instead (or in addition):

1. **App registrations → New registration**: _Accounts in this organizational
   directory only_. Redirect URI: platform **Web**,
   `https://app.example.com/api/auth/callback/oidc`.
2. **Certificates & secrets → New client secret**. Note its expiry.
3. **Token configuration → Add optional claim → ID → `email`**, so the ID token
   carries the address. People without a mailbox address cannot sign in.
4. Settings, with the directory (tenant) ID:

   ```sh
   OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
   OIDC_CLIENT_ID=<application (client) ID>
   OIDC_CLIENT_SECRET=<client secret value>
   OIDC_DISPLAY_NAME=Contoso
   ```

Entra ID does not send `email_verified`. New people verify their address once
by email; existing accounts connect from Account settings (see above).

## Keycloak and others

Any provider that publishes OpenID Connect discovery works. For Keycloak, the
issuer is `https://keycloak.example.com/realms/<realm>`; create a confidential
client with standard flow enabled and the redirect URI above.

## Local development and tests

`compose.yaml` has an optional Dex identity provider
([`deploy/dex/development.yaml`](../../deploy/dex/development.yaml)) with a test
person and a static client:

```sh
docker compose --profile sso up -d dex
```

```sh
OIDC_ISSUER=http://127.0.0.1:5556/dex
OIDC_CLIENT_ID=lictory-local
OIDC_CLIENT_SECRET=lictory-local-dex-secret
OIDC_DISPLAY_NAME=Dex
```

Sign in as `ada@sso.example.test` with password `Local-sso-password-123`. The
client accepts the development app (port 3000) and the browser test stack.
`tests/platform/sso.spec.ts` signs in through it when
`E2E_OIDC_ISSUER=http://127.0.0.1:5556/dex` is set for `bun run test:e2e`, and
is skipped otherwise.
