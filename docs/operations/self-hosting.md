# Self-hosting

This runbook is for a company that runs Lictory on its own Linux server. The
server pulls published releases from GitHub; nothing pushes to it. How the
server tooling works underneath (services, network boundaries, upgrades,
rollback) is described in [deployment](deployment.md).

```sh
curl -fsSL https://raw.githubusercontent.com/chricarp/lictory/main/deploy/get.sh | sudo sh
sudo lictory install
```

An installation is one environment (`production` unless you name another)
served on one host name, for example `lictory.example.com`. It needs no
marketing site: links to "the website" go to the app itself.

The hosted [terminal guide](https://docs.lictory.com/self-hosting/terminal)
covers the day-to-day experience and automation examples. This runbook keeps
the complete flag reference and operational details. To work on specifications
from a terminal agent, use [MCP](https://docs.lictory.com/integrations/agents).

## Requirements

| Requirement             | Minimum                                   | Why                                                                                                               |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Linux, amd64 or arm64   | Any distribution with Docker              | Images are published for `linux/amd64` and `linux/arm64`                                                          |
| Docker Engine           | 25.0                                      | Every service's health check uses `start_interval`                                                                |
| Docker Compose v2       | 2.24                                      | The plugin (`docker compose`), not the old `docker-compose`                                                       |
| Host tools              | `bash`, `curl`, `jq`, `openssl`, `flock`  | The release tooling; `flock` comes with util-linux                                                                |
| Memory                  | 2 GB (4 GB recommended)                   | Service limits add up to about 4.5 GB; production measures about 1 GB                                             |
| Free disk (Docker root) | 10 GB (20 GB recommended), plus your data | Images take about 3 GB; PostgreSQL keeps up to 2 GB of WAL and, while zero-cache is down, up to 8 GB for its slot |
| Network                 | Ports 80 and 443 free, outbound HTTPS     | Automatic certificates; GitHub Releases and `ghcr.io` for releases. Not needed with `--tls proxy` or `--tls http` |
| DNS                     | An `A`/`AAAA` record for the host name    | Certificates are issued for it. `install` warns, but does not stop, when the name does not resolve to this server |

`install` and `doctor` check all of these. `--ignore-requirements` turns the
memory and disk minimums into warnings for evaluation machines.

**PostgreSQL** runs in a container on the server by default. Any other
PostgreSQL that meets Lictory's requirements works too: your own server or a
managed service (RDS, Aurora, Cloud SQL, AlloyDB, Azure, Neon, Supabase,
Crunchy Bridge…). The requirements, the role setup without a superuser and
each provider's settings are in
[external and managed PostgreSQL](external-database.md); `lictory database
check` tests a server against them.

Install Docker the way your company does, or from
[Docker's instructions](https://docs.docker.com/engine/install/). On a fresh
Ubuntu 24.04 server, `deploy/provision/provision.sh` can harden the host first
([deployment](deployment.md#provisioning-a-server)).

## Bootstrap

`get.sh` installs the tooling of one published release. It changes nothing
else and starts nothing:

1. Resolves the release: the newest stable one by default,
   `LICTORY_CHANNEL=nightly` for the newest nightly, or `LICTORY_VERSION=1.4.2`.
2. Downloads its `release.env` asset over HTTPS and compares it with the
   SHA-256 digest GitHub publishes for the asset. A mismatch stops before
   anything is pulled.
3. Pulls the release's ops image by the digest in `release.env` and copies the
   deployment bundle out of it.
4. Runs the bundle's `install.sh`: the `deploy` user (in the `docker` group,
   no sudo), `/srv/lictory`, the host scripts, the backup and monitor timers,
   and `/usr/local/bin/lictory`. The verified bundle stays in
   `/srv/lictory/share/bundle`.

The trust root is therefore GitHub's HTTPS endpoint plus the image digests: the
tooling that runs as root on your server is exactly the one inside the
digest-pinned ops image of a published release. Every later activation
installs that release's own tooling, so the `lictory` command follows your
upgrades.

| Variable                 | Default            | Meaning                                                                                           |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------- |
| `LICTORY_CHANNEL`        | `stable`           | `stable` or `nightly`                                                                             |
| `LICTORY_VERSION`        | newest             | A specific release, for example `1.4.2`                                                           |
| `LICTORY_ROOT`           | `/srv/lictory`     | Tooling and environment root                                                                      |
| `DEPLOY_USER`            | `deploy`           | Unprivileged user that owns the root and deploys                                                  |
| `LICTORY_ENV`            | `production`       | Environment prepared for `lictory install`                                                        |
| `LICTORY_REPOSITORY`     | `chricarp/lictory` | The GitHub repository releases come from (a fork)                                                 |
| `LICTORY_IMAGE_REGISTRY` | `ghcr.io/chricarp` | The registry its release images are in                                                            |
| `GITHUB_TOKEN`           | none               | A token that can read the repository: required when it is private, and raises GitHub's rate limit |

Pass variables to the shell that runs the script:
`curl -fsSL … | sudo LICTORY_CHANNEL=nightly sh`.

**Private fork.** The official repository is public and needs no token. For a
private fork, GitHub answers 404 without a token; `get.sh` and `lictory` then
say so. Use a token with read access to the repository's contents (a
fine-grained token is enough) in a root shell, so `sudo` does not drop it and it
stays out of the process list:

```sh
sudo -i
export GITHUB_TOKEN=github_pat_…
# The header goes through a private file (printf is a shell builtin), so the
# token never appears in the process list.
umask 077 && printf 'Authorization: Bearer %s\n' "$GITHUB_TOKEN" >/root/.lictory-github-header
curl -fsSL -H @/root/.lictory-github-header \
  https://raw.githubusercontent.com/<owner>/lictory/main/deploy/get.sh |
  LICTORY_REPOSITORY=<owner>/lictory LICTORY_IMAGE_REGISTRY=ghcr.io/<owner> sh
rm /root/.lictory-github-header
lictory install
```

The bootstrap records the repository and registry for `lictory install` and
upgrades; `lictory upgrade` needs `GITHUB_TOKEN` in its environment again.
GitHub redirects downloads to its storage, so curl 7.58.0 or newer is required
with a token (older versions forward the token on redirects; the tools refuse
to run with them).

**Images.** The release images (`ghcr.io/chricarp/lictory-*`) are public:
pulling them needs no `docker login`. A fork that publishes private images
needs a GitHub token that can read packages: log in as root before `get.sh`
(`docker login ghcr.io`), and afterwards for the deploy user with
`sudo lictory registry-login --username <github-user>` (the token on stdin or
at the prompt).

## Install

`sudo lictory install` is a guided installation in nine steps. On a
terminal it shows menus (arrow keys or `j`/`k`, Enter), checks each answer
as you type it and runs long steps behind a progress line, keeping their
output in `/srv/lictory/<env>/logs/install-<timestamp>.log` (the tail is shown
when a step fails). Elsewhere (`--yes`, pipes, CI) it prints plain text;
`NO_COLOR=1` turns colours off.

1. **This server**: the requirements above.
2. **Address and certificates**: how browsers reach the server (TLS mode,
   below), the host name and, for automatic HTTPS, an email for certificate
   notices. DNS and the ports are checked right away.
3. **Database**: the bundled PostgreSQL container (default) or an
   [external database](external-database.md): its direct endpoint, TLS mode
   and CA, and optionally an administrator connection that creates
   Lictory's roles once (not stored).
4. **Email, attachments, sign-in and backups**:
   - Outbound email: SMTP or Resend. Without it invitations, verification
     and password reset email are not delivered; administrators can still
     create accounts with passwords.
   - Attachment storage (optional): any S3-compatible bucket reachable from
     browsers ([private file storage](../internals/file-storage.md)).
   - Single sign-on (optional): an OpenID Connect provider
     ([single sign-on](sso.md)). Register
     `https://<host>/api/auth/callback/oidc` at the provider.
   - Backups: where they go and the age key that encrypts them (below). Not
     asked for an external database: its provider backs it up.
5. **Access policy**: who may create accounts and organizations
   ([below](#access-policy)).
6. **Review**: every answer in one summary, secrets masked; for an existing
   environment the `.env` keys that change. Nothing changes before you
   confirm.
7. **Installing**: the host tooling, `/srv/lictory/<env>/.env` with generated
   secrets, the release images and the release `get.sh` verified (or
   `--version`). With an external database, its requirements are checked
   before the first migration.
8. **Checking** that `https://<host>/readyz` answers; the timers start.
9. **First administrator**: the account that manages Lictory and the
   organization it owns ([below](#the-first-administrator)).

It ends with a summary: the address, the administrator, the admin console
(`https://<host>/admin`) and what remains to do.

| TLS mode         | Who terminates TLS              | Notes                                                                                                                       |
| ---------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `acme` (default) | The gateway, with Let's Encrypt | Needs public DNS and ports 80/443                                                                                           |
| `internal`       | The gateway, with your CA       | `--acme-ca <directory URL>` for an internal ACME CA; without it the gateway is its own CA (distribute its root certificate) |
| `proxy`          | Your nginx, Traefik or ingress  | The gateway serves plain HTTP on `--http-port` (8080); set `--trusted-proxies`                                              |
| `http`           | Nobody                          | Evaluation only: cookies are not `Secure`; browsers allow it only on `localhost`                                            |

The details and the requirements for a proxy in front (WebSockets, no
buffering, timeouts, client address) are in
[existing reverse proxy, internal CA and plain HTTP](reverse-proxy.md).

**Without questions.** Every answer is also a flag, or a `LICTORY_<FLAG>`
variable (dashes become underscores), which keeps secrets out of the process
list and shell history:

```sh
sudo LICTORY_SMTP_PASSWORD='…' lictory install --yes \
  --host lictory.example.com --acme-email ops@example.com \
  --email smtp --smtp-host smtp.example.com --smtp-user lictory \
  --smtp-from 'Lictory <lictory@example.com>' \
  --backup local --backup-path /mnt/nas/lictory
```

Interactive mode is used when stdin is a terminal and `--yes` is absent.

## Access policy

Lictory is an administered product: by default nobody can create an account
or an organization on their own. Three settings decide what people may do
without an administrator; `install` asks for them and writes them to `.env`.

| Setting (`.env`)                           | Install option            | Values                                                                                                                                                                      |
| ------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LICTORY_SIGNUP_MODE`                      | `--signup-mode`           | `invite` (default): a new account needs a pending invitation for its email. `closed`: only instance administrators create accounts. `open`: anyone who can reach the server |
| `LICTORY_ALLOWED_EMAIL_DOMAINS`            | `--allowed-email-domains` | Comma-separated domains for self-service accounts, single sign-on included; empty: any. Administrators may create any address                                               |
| `LICTORY_ORGANIZATION_CREATION`            | `--organization-creation` | `administrators` (default): only instance administrators create organizations. `everyone`: any signed-in person                                                             |
| `LICTORY_ORGANIZATION_DELETION_GRACE_DAYS` | (not asked)               | Days between an owner scheduling an organization's deletion and the deletion (1 to 365, default 30). The organization is locked meanwhile, and an owner can cancel          |

The server enforces them for every way an account can appear (password
sign-up, Google, Microsoft), never only in the browser. The company identity
provider is your directory: with `OIDC_AUTO_CREATE_USERS` (on by default) the
people it lets in get an account on first sign-in in every mode, still
limited to the allowed domains. Assign the application at the provider to
decide who that is ([single sign-on](sso.md)).

**Instance administrators** run the installation. They are separate from
organization roles: an instance administrator creates accounts and
organizations, deactivates accounts and appoints other instance
administrators in the admin console (`https://<host>/admin`) or with
`lictory admin`; organization owners and admins manage their own
organization's members and settings. Being an instance administrator gives no
access to an organization's work items.

## The first administrator

The last install step creates the first instance administrator (email
verified, so no email is needed) and an organization they own: its name, its
handle (the address `https://<host>/<handle>`, suggested from the name), the
administrator's name, work email and password, asked twice. On an SSO-only
installation (`PASSWORD_LOGIN_ENABLED=false`) there is no password: the
administrator signs in through the identity provider with that email.

Without questions, pass `--organization`, `--organization-handle` (optional),
`--admin-name` and `--admin-email`, and the password in
`LICTORY_ADMIN_PASSWORD` (never a flag; it reaches the server on stdin):

```sh
sudo LICTORY_ADMIN_PASSWORD='…' lictory install --yes --host lictory.example.com \
  --acme-email ops@example.com --organization 'Acme' \
  --admin-name 'Ada Lovelace' --admin-email ada@example.com
```

`--yes` without `--admin-email`, or services that do not answer yet, leave
this step for later: `sudo lictory admin setup` runs it on its own. Once an
administrator exists, `install` leaves administration alone.

**Re-running converges.** `install` never regenerates secrets and never
replaces `.env`: it changes only the keys whose answers differ, lists them,
asks for confirmation (unless `--yes`), keeps the previous file as
`.env.backup-<timestamp>` and re-activates the running release with the new
settings. In interactive mode Enter keeps each current value. Change any
other setting with `lictory config set KEY=value` (or `config edit`), or edit
`.env` by hand and apply it with `lictory config apply`.

## Commands

| Command                                                                           | What it does                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lictory install`                                                                 | Installs or reconfigures an environment (root)                                                                                                                                                                                                                 |
| `lictory admin <command>`                                                         | Instance administration from the server ([below](#instance-administration))                                                                                                                                                                                    |
| `lictory status [--json]`                                                         | Active release, image digests and service health (`deploy.sh status`), the address, channel and access policy                                                                                                                                                  |
| `lictory doctor [--json]`                                                         | Host requirements, `.env`, services, the public route and certificate, DNS, replication slot, WAL, queued work, last backup and timers; exits 1 on any failure                                                                                                 |
| `lictory database check [--json]`                                                 | The database against [Lictory's requirements](external-database.md#requirements), with the fix for each gap; exits 1 on any failure                                                                                                                            |
| `lictory database setup`                                                          | Creates Lictory's roles and databases on an external database; the administrator URL from `LICTORY_DATABASE_ADMIN_URL` or a hidden prompt, never stored                                                                                                        |
| `lictory upgrade [version] [--check] [--yes]`                                     | The newest release of the environment's channel, or that version                                                                                                                                                                                               |
| `lictory rollback [--yes]`                                                        | Re-activates the previously activated release's images                                                                                                                                                                                                         |
| `lictory backup [list [--json]]`                                                  | An encrypted backup now (`lictory-backup <env> manual`), or the stored backups with the keys `restore` takes; an external database is backed up by its provider                                                                                                |
| `lictory restore <identity-file\|none> [latest\|<key>\|<file>] [--drill] [--yes]` | Replaces the database with a backup (root); `--drill` restores into a throwaway stack instead; not for an external database (its provider's point-in-time recovery)                                                                                            |
| `lictory config show\|get\|set\|unset\|edit\|apply`                               | Reads and changes `.env` ([below](#settings)): secrets masked, unknown keys and generated secrets refused, a copy kept, applied with an automatic undo                                                                                                         |
| `lictory logs [service] [-f\|--follow] [--tail N]`                                | Logs of `postgres` (bundled database only), `zero-cache`, `api`, `worker`, `collaboration` or `proxy` (default: all, last 200 lines)                                                                                                                           |
| `lictory support-bundle [--output F] [--since 24h]`                               | A `0600` archive of versions, status, doctor, masked settings, deploy history and service logs, with `.env` secrets, email addresses and bearer tokens replaced                                                                                                |
| `lictory uninstall [--purge [--no-backup]] [--yes]`                               | Stops the environment and removes its containers and timers, keeping data and `.env` (`config apply` restarts it); `--purge` deletes its volumes and directory after a final off-server backup and a typed confirmation; an external database is never touched |
| `lictory registry-login [--username U]`                                           | `docker login` to the environment's registry for the deploy user (and root); token on stdin                                                                                                                                                                    |
| `lictory completion bash`                                                         | Bash completion (commands, options, environments, services, setting names); the bootstrap installs it in `/etc/bash_completion.d/lictory`                                                                                                                      |
| `lictory version [--json]`                                                        | The host tools' release and each environment's release and channel, read from disk                                                                                                                                                                             |
| `lictory help [command]`, `lictory <command> --help`                              | Usage, or one command's options                                                                                                                                                                                                                                |

Every command takes `--env <name>` (`-e`) when the server hosts several
environments; with one, it is found automatically. `-y`/`--yes` answers every
question with yes or its default. Run as root (`sudo`) or as the deploy user.

Install options (each also `LICTORY_<NAME>`, for example
`--smtp-password` as `LICTORY_SMTP_PASSWORD`):

| Option                                                                                                                                                | Values and default                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `--host`                                                                                                                                              | The host name users open (required)                                                                                                      |
| `--tls`                                                                                                                                               | `acme` (default), `proxy`, `internal`, `http`                                                                                            |
| `--acme-email`                                                                                                                                        | Required for `acme` and for `internal` with `--acme-ca`                                                                                  |
| `--acme-ca`                                                                                                                                           | `internal`: your CA's ACME directory URL; empty: the gateway's own CA                                                                    |
| `--http-port`, `--bind`                                                                                                                               | `proxy`/`http`: port (8080) and `127.0.0.1` (default) or `0.0.0.0`                                                                       |
| `--public-url`                                                                                                                                        | `proxy`: the address your proxy serves (default `https://<host>`)                                                                        |
| `--trusted-proxies`                                                                                                                                   | `proxy`: space-separated IPs/CIDRs your proxy connects from                                                                              |
| `--database`                                                                                                                                          | `bundled` (default) or `external` ([external and managed PostgreSQL](external-database.md)); fixed once a release is active              |
| `--database-host`, `--database-port`, `--database-sslmode`, `--database-ca-file`                                                                      | `external`: the direct endpoint, port (5432), `verify-full` (default) or `require`, a CA bundle (PEM) when the CA is not public          |
| `--database-admin-url`                                                                                                                                | `external`: an administrator connection that creates the roles once; pass it as `LICTORY_DATABASE_ADMIN_URL`, it is never stored         |
| `--email`                                                                                                                                             | `smtp`, `resend`, `none` (default)                                                                                                       |
| `--smtp-host`, `--smtp-port`, `--smtp-user`, `--smtp-password`, `--smtp-from`                                                                         | SMTP server (port 587 default, STARTTLS; 465 TLS; 25)                                                                                    |
| `--resend-api-key`, `--email-from`                                                                                                                    | Resend                                                                                                                                   |
| `--storage`, `--s3-endpoint`, `--s3-region`, `--s3-bucket`, `--s3-access-key-id`, `--s3-secret-access-key`, `--s3-force-path-style`                   | `s3` or `none` (default); an empty endpoint means AWS S3                                                                                 |
| `--oidc`, `--oidc-issuer`, `--oidc-client-id`, `--oidc-client-secret`, `--oidc-display-name`                                                          | `yes` or `no` (default); display name default `SSO`                                                                                      |
| `--backup`                                                                                                                                            | `local` (default), `s3`, `rclone`, `none`                                                                                                |
| `--backup-path`                                                                                                                                       | `local`: a host directory (NAS, second disk); empty: a Docker volume on this server                                                      |
| `--backup-bucket`, `--backup-s3-provider`, `--backup-s3-endpoint`, `--backup-s3-region`, `--backup-s3-access-key-id`, `--backup-s3-secret-access-key` | `s3` backups (rclone provider `AWS`, `Cloudflare`, `Minio`, `Other`…)                                                                    |
| `--backup-rclone-remote`                                                                                                                              | `rclone` backups: an rclone remote or connection string                                                                                  |
| `--backup-age-recipient`, `--backup-identity-file`                                                                                                    | An age public key, `generate` (default) or `none`; where a generated identity is written                                                 |
| `--signup-mode`, `--allowed-email-domains`, `--organization-creation`                                                                                 | [Access policy](#access-policy): `invite` (default), `closed` or `open`; domains (default any); `administrators` (default) or `everyone` |
| `--organization`, `--organization-handle`, `--admin-name`, `--admin-email`                                                                            | [The first administrator](#the-first-administrator); the password only in `LICTORY_ADMIN_PASSWORD`                                       |
| `--channel`, `--version`                                                                                                                              | `stable` (default) or `nightly`; a specific first release                                                                                |
| `--deploy-user`, `--ignore-requirements`                                                                                                              | The deploy user (default the owner of the root); memory and disk minimums as warnings                                                    |

Invalid values are refused before anything changes (exit 64).

## Settings

`lictory config` reads and changes the environment's `.env` without opening
it, for settings the installer does not ask for (analytics, legal notices,
Google or Microsoft sign-in, worker intervals) or to change one quickly.

| Command                                   | What it does                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lictory config show [--reveal] [--json]` | Every set value; secrets masked unless `--reveal`                                                                                                                                                                                                                                        |
| `lictory config get <KEY>`                | One value, unmasked, for scripts; exit 1 when unset                                                                                                                                                                                                                                      |
| `lictory config set <KEY=value>...`       | Changes values (`KEY=` clears one), then applies them                                                                                                                                                                                                                                    |
| `lictory config unset <KEY>...`           | Clears values, then applies                                                                                                                                                                                                                                                              |
| `lictory config edit`                     | Opens a copy in `$VISUAL`/`$EDITOR`, lists the changes and asks before saving                                                                                                                                                                                                            |
| `lictory config apply`                    | Re-activates the active release with the current `.env`, after a hand edit                                                                                                                                                                                                               |
| `lictory config rotate <KEY>`             | A new random value for a generated secret, applied in PostgreSQL first for a database password; the previous value stays if PostgreSQL refuses. An external database's role passwords are changed with `config set --force --no-apply`, then `lictory database setup` and `config apply` |

Every write lists the changed keys, keeps the previous file as
`.env.backup-<timestamp>` and re-activates the active release (`--no-apply`
only writes). If the services do not start with the new values, the previous
file is restored and re-activated, and the command exits 1. Two kinds of
change are refused (exit 65) unless you pass `--force`:

- a key that neither the configuration template nor the release's Compose
  file names: the services would never read it, which usually means a typo;
- a change to a generated value other state depends on: the database role
  passwords and `LICTORY_DB_NAME` (PostgreSQL keeps the old ones),
  `BETTER_AUTH_SECRET` (signs everyone out) and `DELIVERY_CREDENTIALS_KEY`
  (stored Jira credentials become unreadable). Setting an empty one is fine.

## Instance administration

`lictory admin` runs inside the environment's api container, so it works
from the server even when nobody can sign in. Everything except `setup` is
also in the admin console.

| Command                                                                                                             | What it does                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `lictory admin setup`                                                                                               | The first instance administrator and their organization (refused once one exists)                                             |
| `lictory admin status [--json]`                                                                                     | The access policy, and how many administrators, accounts and organizations exist                                              |
| `lictory admin list`                                                                                                | Instance administrators                                                                                                       |
| `lictory admin grant <email>`, `revoke <email>`                                                                     | Appoints or removes an instance administrator; the last active one cannot be removed                                          |
| `lictory admin create-user <email> --name <name> [--admin] [--organization <handle> [--role member\|admin\|owner]]` | An account with a verified email; a password from the prompt or `LICTORY_USER_PASSWORD`, else none (SSO or "Forgot password") |
| `lictory admin set-password <email>`                                                                                | A new password (prompt or `LICTORY_USER_PASSWORD`); signs the account out everywhere                                          |
| `lictory admin deactivate <email>`, `reactivate <email>`                                                            | Blocks sign-in and ends every session, or allows it again; nothing is deleted                                                 |

Removals (`revoke`, `deactivate`) ask for confirmation; `--yes` skips it.

**Recovery.** Lost the only administrator's password: `sudo lictory admin
set-password <email>`. The administrator left the company:
`sudo lictory admin grant <someone's email>`, then revoke or deactivate the
old account. No administrator at all (`lictory doctor` warns):
`sudo lictory admin grant <email>` for an existing account, or
`sudo lictory admin create-user <email> --name … --admin`.

## Backups and restore

Backups are nightly `pg_dump` archives encrypted with
[age](https://age-encryption.org); the semantics are in
[backups and recovery](recovery.md). With `--backup-age-recipient generate`
(the default) `install` creates a key pair with the release's ops image, puts
only the public key in `.env` and writes the private identity to
`/root/lictory-<env>-backup-identity.txt`. Move that file to your password
manager or an offline copy and delete it from the server: restores need it,
and a server compromise must not expose old backups.

With an [external database](external-database.md#backups), Lictory takes no
backups: the provider's backups and point-in-time recovery protect it, and
`backup` and `restore` refuse.

`local` without a path keeps backups in a Docker volume on the same disk,
which protects against mistakes but not against losing the server; prefer a
NAS path, `s3` or `rclone`.

```sh
lictory backup                                    # now
sudo lictory restore ./identity.txt --drill       # monthly: verify the latest backup in isolation
sudo lictory restore ./identity.txt latest        # replace the database (asks for the environment name)
```

`restore` stops the services, copies the current database into a volume named
`lictory-<env>_postgres_data-before-restore-<timestamp>`, restores the backup
into a fresh cluster and verifies it against its manifest, discards the Zero
replica (it resyncs), applies any newer migrations of the active release and
re-activates it. Writes after the backup are lost. Remove the kept volume once
you are satisfied. `restore` also accepts a backup key or a local
`.dump[.age]` file with its manifest next to it.

**Server loss.** Bootstrap and install a new server with the same answers and
the `.env` secrets from your password manager (`BETTER_AUTH_SECRET` keeps
sessions, `DELIVERY_CREDENTIALS_KEY` keeps Jira credentials readable), then
`sudo lictory restore <identity> latest`.

## Upgrades and channels

```sh
lictory upgrade            # newest release of the environment's channel
lictory upgrade 1.6.0      # a specific release of that channel
lictory rollback           # back to the previously activated release
```

`upgrade` shows the active and the target version and the release notes, asks
for confirmation, verifies `release.env` against GitHub's digest and runs
`deploy.sh <env> release`. That keeps every deployment safeguard: a backup
before pending migrations, migrations before any service changes, waiting for
zero-cache to replicate the schema, health checks, and restoring the previous
release's images if activation fails. Upgrades only move forward; migrations
are never reverted, so returning to an older version is a `rollback`, which
switches images and keeps the schema.

The channel is a property of the environment (`LICTORY_RELEASE_CHANNEL`):

- `stable`: tested releases (`vX.Y.Z`). The default.
- `nightly`: a prerelease built daily from `main` when the platform changed
  (`vX.Y.Z-nightly.YYYYMMDD.N`). For staging or evaluation servers.
  Nightlies older than 14 days are removed from GitHub Releases once a newer
  one exists; the newest nightly is always kept, so `upgrade` on this channel
  always finds one. A removed nightly can no longer be installed by version
  ([retention](releases.md#nightly-retention)).

Switch with `sudo lictory install --channel nightly` (or `stable`); the next
`upgrade` follows it. Moving from nightly to stable waits for a stable release
newer than the nightly you run.

Upgrades are manual. To automate them, schedule `lictory upgrade --yes` in your
own scheduler; it is a no-op when nothing newer exists.

## Troubleshooting

Start with `lictory doctor`; every failure line names the fix.

| Symptom                                                   | Fix                                                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| "The registry refused to pull"                            | Official images are public, so check `LICTORY_IMAGE_REGISTRY`. A fork with private images must log in, see [Bootstrap](#bootstrap). |
| "Port 80 is in use"                                       | Another web server runs on the host: stop it, or put Lictory behind it with `--tls proxy`                                           |
| `/readyz` not reachable but "the gateway answers locally" | DNS, the firewall (80/443) or your proxy; certificates are issued only once DNS points here                                         |
| No certificate yet                                        | `lictory logs proxy`: Let's Encrypt reports why (DNS, rate limits, a CAA record)                                                    |
| A new person cannot create an account                     | Invite the person from the admin console or organization settings, or create the account: `lictory admin create-user`               |
| Nobody can manage accounts                                | `sudo lictory admin setup` (no administrator yet) or `sudo lictory admin grant <email>`                                             |
| Sign-up email never arrives                               | `--email none` or wrong SMTP settings: `sudo lictory install --email smtp …`, then `lictory logs worker`                            |
| "Another deployment of <env> is running"                  | Wait for it; `deploy.sh` holds a lock per environment                                                                               |
| "This environment accepts stable releases"                | The version belongs to the other channel: `sudo lictory install --channel …`                                                        |
| "The database does not meet Lictory's requirements"       | An external database: `sudo lictory database check` names each gap and its fix; missing roles: `sudo lictory database setup`        |
| Replication slot or WAL warnings                          | [Replication slot and WAL growth](recovery.md#replication-slot-and-wal-growth)                                                      |
| Everyone shares one sign-in rate limit behind a proxy     | Set `--trusted-proxies`; `doctor` prints the address a proxy on the same host connects from                                         |

Logs of the tooling itself are in `/srv/lictory/<env>/deploy.log` and
`release-history.log`. The layout, database roles, health checks and scaling
limits are the same as in [deployment](deployment.md).
