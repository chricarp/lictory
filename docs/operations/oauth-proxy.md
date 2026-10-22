# OAuth in local development and staging

The optional [Better Auth OAuth proxy](https://better-auth.com/docs/plugins/oauth-proxy)
lets local development and other trusted environments use a fixed provider
callback URL. It supports Google and Microsoft sign-in and connecting accounts
from Settings. Without the proxy variables, direct OAuth continues to work.

## Choose the callback server and client

The initiating deployment uses its configured provider client ID to request an
authorization code. The callback server exchanges that code using its own
configured client ID and secret. **Both must use the same OAuth client.**
Registering the callback URL on two different clients does not make them
interchangeable.

To retain separate production and development clients, run a trusted callback
server at a stable HTTPS origin, for example `https://auth-dev.example.com`,
with your development Google/Microsoft credentials and an isolated staging
database. Local development uses that same development client and proxies
through this server. Production keeps its production client and leaves the
proxy variables empty. The staging environment (`app.staging.lictory.com`)
works as the callback server: its `PLATFORM_URL` is its canonical origin and it
uses staging resources only.

Alternatively, production can be the callback server, but participating local
deployments must then use the production OAuth client too. Enable
the proxy on production as well as the participants. Ordinary sign-ins at the
callback server's origin stay direct.

## Configure participating deployments

1. Deploy the same Better Auth version to the callback server and participants.
   This repository uses 1.7.7, including proxied account linking. Restart sign-in
   attempts that began before the upgrade; mixed versions cannot exchange proxy
   packages.
2. Set `OAUTH_PROXY_URL` to the callback server's HTTPS **origin**, without
   `/api/auth` or another path, on the callback server and local development.
3. Generate `OAUTH_PROXY_SECRET` with `openssl rand -base64 32` and set the same
   value on all participating deployments. Keep each environment's
   `BETTER_AUTH_SECRET` separate. Both proxy variables are required to enable
   the plugin; an incomplete configuration fails at startup.
4. Configure `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and/or
   `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` with the **same client** on
   every participant, including the callback server. Keep Microsoft's tenant
   configuration consistent too.
5. Register the fixed callbacks with that client:
   - `https://auth-dev.example.com/api/auth/callback/google`
   - `https://auth-dev.example.com/api/auth/callback/microsoft`
6. Set `OAUTH_PROXY_TRUSTED_ORIGINS` on the callback server to a comma-separated
   list of exact participating origins, for example `http://localhost:3000`.
   Never use wildcard origins.

For local development, keep `PLATFORM_URL=http://localhost:3000` (or your
actual port). On servers the variables live in the environment's `.env`
([deployment](deployment.md)). Production retains its canonical base URL.

The callback server exchanges the provider code and returns an encrypted
profile to the originating deployment. It does not create a user or session
for that sign-in in its database. The originating deployment creates or links
the account and sets its own session cookie. Databases and storage remain
separate.

## Secret scope and failures

Share the proxy secret only with trusted code and deployments. Anyone holding
it can assert provider identities in every participating environment, including
the callback server. Never supply it to environments running untrusted
contributor code. A separate development callback server keeps this authority out of the
production authentication realm.

`state_mismatch` commonly means the callback server has a different proxy
secret or Better Auth version. `invalid_code` can mean mismatched OAuth clients
or a callback URI that does not match the provider registration. Check these
settings before retrying the sign-in. The full verification runner clears the
proxy variables so browser tests never contact a configured live callback server.

## Production callbacks

The platform moved to `app.lictory.com`; Better Auth runs there under
`/api/auth`. Production OAuth clients must list exactly:

- Google: `https://app.lictory.com/api/auth/callback/google`
- Microsoft: `https://app.lictory.com/api/auth/callback/microsoft`

Remove the former `https://lictory.com/api/auth/callback/*` URIs once the new
origin serves sign-in. Staging uses its own clients with
`https://app.staging.lictory.com/api/auth/callback/*`.
