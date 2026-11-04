# Self-hosting

This runbook is for a company that runs Lictory on its own Linux server. The
server pulls published releases from GitHub; nothing pushes to it. The
maintainer's own production (lictory.com, released by GitHub Actions over
SSH) is described in [deployment](deployment.md). Both use the same release
tooling, images and safeguards.

```sh
curl -fsSL https://raw.githubusercontent.com/chricarp/lictory/main/deploy/get.sh | sudo sh
sudo lictory install
```

An installation is one environment (`production` unless you name another)
served on one host name, for example `lictory.example.com`. It needs no
marketing site: links to "the website" go to the app itself.

## Requirements

| Requirement             | Minimum                                   | Why                                                                                                               |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Linux, amd64 or arm64   | Any distribution with Docker              | Images are published for `linux/amd64` and `linux/arm64`                                                          |
| Docker Engine           | 25.0                                      | Every service's health check uses `start_interval`                                                                |
| Docker Compose v2       | 2.24                                      | The plugin (`docker compose`), not the old `docker-compose`                                                       |
| Host tools              | `bash`, `curl`, `jq`, `openssl`, `flock`  | The release tooling; `flock` comes with util-linux                                                                |
| Memory                  | 2 GB (4 GB recommended)                   | Service limits add up to about 4 GB; production measures about 1 GB                                               |
| Free disk (Docker root) | 10 GB (20 GB recommended), plus your data | Images take about 3 GB; PostgreSQL keeps up to 2 GB of WAL and, while zero-cache is down, up to 8 GB for its slot |
| Network                 | Ports 80 and 443 free, outbound HTTPS     | Automatic certificates; GitHub Releases and `ghcr.io` for releases. Not needed with `--tls proxy` or `--tls http` |
| DNS                     | An `A`/`AAAA` record for the host name    | Certificates are issued for it. `install` warns, but does not stop, when the name does not resolve to this server |

`install` and `doctor` check all of these. `--ignore-requirements` turns the
memory and disk minimums into warnings for evaluation machines.

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

| Variable          | Default        | Meaning                                          |
| ----------------- | -------------- | ------------------------------------------------ |
| `LICTORY_CHANNEL` | `stable`       | `stable` or `nightly`                            |
| `LICTORY_VERSION` | newest         | A specific release, for example `1.4.2`          |
| `LICTORY_ROOT`    | `/srv/lictory` | Tooling and environment root                     |
| `DEPLOY_USER`     | `deploy`       | Unprivileged user that owns the root and deploys |
| `LICTORY_ENV`     | `production`   | Environment prepared for `lictory install`       |

Pass variables to the shell that runs the script:
`curl -fsSL … | sudo LICTORY_CHANNEL=nightly sh`.

**Private images.** While the images on `ghcr.io` are not public, pulls fail
with an explanation. Log in with a GitHub token that can read packages: as root
before `get.sh` (`docker login ghcr.io`), and afterwards for the deploy user
with `sudo lictory registry-login --username <github-user>` (the token on
stdin or at the prompt).

## Install

`sudo lictory install` asks only for what a first installation needs and keeps
the template default for everything else:

1. **TLS**: how browsers reach the server (below).
2. **Host name**, and for automatic HTTPS an email for certificate notices.
3. **Outbound email**: SMTP or Resend. You may skip it, but then verification,
   invitation and password reset email are not delivered, so password sign-up
   cannot be completed; single sign-on still works.
4. **Attachment storage** (optional): any S3-compatible bucket reachable from
   browsers ([private file storage](../internals/file-storage.md)). Without
   one, attachments are disabled.
5. **Single sign-on** (optional): an OpenID Connect provider
   ([single sign-on](sso.md)). Register
   `https://<host>/api/auth/callback/oidc` at the provider.
6. **Backups**: where they go and the age key that encrypts them (below).

It then checks the server, creates `/srv/lictory/<env>/.env` with generated
secrets, deploys the release `get.sh` verified (or `--version`), waits until
`https://<host>/readyz` answers, starts the timers and prints the next steps.

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

**Re-running converges.** `install` never regenerates secrets and never
replaces `.env`: it changes only the keys whose answers differ, lists them,
asks for confirmation (unless `--yes`), keeps the previous file as
`.env.backup-<timestamp>` and re-activates the running release with the new
settings. In interactive mode Enter keeps each current value. Edit anything
else in `.env` by hand; `sudo lictory install --yes` (or
`deploy.sh <env> activate <version>`) applies it.

## Commands

| Command                                                                           | What it does                                                                                                                                                   |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lictory install`                                                                 | Installs or reconfigures an environment (root)                                                                                                                 |
| `lictory status [--json]`                                                         | Active release, image digests and service health (`deploy.sh status`), the address and channel                                                                 |
| `lictory doctor`                                                                  | Host requirements, `.env`, services, the public route and certificate, DNS, replication slot, WAL, queued work, last backup and timers; exits 1 on any failure |
| `lictory upgrade [version] [--yes]`                                               | The newest release of the environment's channel, or that version                                                                                               |
| `lictory rollback [--yes]`                                                        | Re-activates the previously activated release's images                                                                                                         |
| `lictory backup`                                                                  | An encrypted backup now (`lictory-backup <env> manual`)                                                                                                        |
| `lictory restore <identity-file\|none> [latest\|<key>\|<file>] [--drill] [--yes]` | Replaces the database with a backup (root); `--drill` restores into a throwaway stack instead                                                                  |
| `lictory logs [service] [-f\|--follow] [--tail N]`                                | Logs of `postgres`, `zero-cache`, `api`, `worker` or `proxy` (default: all, last 200 lines)                                                                    |
| `lictory registry-login [--username U]`                                           | `docker login` to the environment's registry for the deploy user (and root); token on stdin                                                                    |
| `lictory help`                                                                    | Usage                                                                                                                                                          |

Every command takes `--env <name>` (`-e`) when the server hosts several
environments; with one, it is found automatically. `-y`/`--yes` answers every
question with yes or its default. Run as root (`sudo`) or as the deploy user.

Install options (each also `LICTORY_<NAME>`, for example
`--smtp-password` as `LICTORY_SMTP_PASSWORD`):

| Option                                                                                                                                                | Values and default                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `--host`                                                                                                                                              | The host name users open (required)                                                      |
| `--tls`                                                                                                                                               | `acme` (default), `proxy`, `internal`, `http`                                            |
| `--acme-email`                                                                                                                                        | Required for `acme` and for `internal` with `--acme-ca`                                  |
| `--acme-ca`                                                                                                                                           | `internal`: your CA's ACME directory URL; empty: the gateway's own CA                    |
| `--http-port`, `--bind`                                                                                                                               | `proxy`/`http`: port (8080) and `127.0.0.1` (default) or `0.0.0.0`                       |
| `--public-url`                                                                                                                                        | `proxy`: the address your proxy serves (default `https://<host>`)                        |
| `--trusted-proxies`                                                                                                                                   | `proxy`: space-separated IPs/CIDRs your proxy connects from                              |
| `--email`                                                                                                                                             | `smtp`, `resend`, `none` (default)                                                       |
| `--smtp-host`, `--smtp-port`, `--smtp-user`, `--smtp-password`, `--smtp-from`                                                                         | SMTP server (port 587 default, STARTTLS; 465 is not supported)                           |
| `--resend-api-key`, `--email-from`                                                                                                                    | Resend                                                                                   |
| `--storage`, `--s3-endpoint`, `--s3-region`, `--s3-bucket`, `--s3-access-key-id`, `--s3-secret-access-key`, `--s3-force-path-style`                   | `s3` or `none` (default); an empty endpoint means AWS S3                                 |
| `--oidc`, `--oidc-issuer`, `--oidc-client-id`, `--oidc-client-secret`, `--oidc-display-name`                                                          | `yes` or `no` (default); display name default `SSO`                                      |
| `--backup`                                                                                                                                            | `local` (default), `s3`, `rclone`, `none`                                                |
| `--backup-path`                                                                                                                                       | `local`: a host directory (NAS, second disk); empty: a Docker volume on this server      |
| `--backup-bucket`, `--backup-s3-provider`, `--backup-s3-endpoint`, `--backup-s3-region`, `--backup-s3-access-key-id`, `--backup-s3-secret-access-key` | `s3` backups (rclone provider `AWS`, `Cloudflare`, `Minio`, `Other`…)                    |
| `--backup-rclone-remote`                                                                                                                              | `rclone` backups: an rclone remote or connection string                                  |
| `--backup-age-recipient`, `--backup-identity-file`                                                                                                    | An age public key, `generate` (default) or `none`; where a generated identity is written |
| `--channel`, `--version`                                                                                                                              | `stable` (default) or `nightly`; a specific first release                                |
| `--deploy-user`, `--ignore-requirements`                                                                                                              | The deploy user (default the owner of the root); memory and disk minimums as warnings    |

Invalid values are refused before anything changes (exit 64).

## Backups and restore

Backups are nightly `pg_dump` archives encrypted with
[age](https://age-encryption.org); the semantics are in
[backups and recovery](recovery.md). With `--backup-age-recipient generate`
(the default) `install` creates a key pair with the release's ops image, puts
only the public key in `.env` and writes the private identity to
`/root/lictory-<env>-backup-identity.txt`. Move that file to your password
manager or an offline copy and delete it from the server: restores need it,
and a server compromise must not expose old backups.

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
- `nightly`: a prerelease for every change on `main`
  (`vX.Y.Z-nightly.YYYYMMDD.N`). For staging or evaluation servers.

Switch with `sudo lictory install --channel nightly` (or `stable`); the next
`upgrade` follows it. Moving from nightly to stable waits for a stable release
newer than the nightly you run.

Upgrades are manual. To automate them, schedule `lictory upgrade --yes` in your
own scheduler; it is a no-op when nothing newer exists.

## Troubleshooting

Start with `lictory doctor`; every failure line names the fix.

| Symptom                                                   | Fix                                                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| "The registry refused to pull"                            | The images are private: `sudo lictory registry-login --username <github-user>` (and `docker login ghcr.io` as root before `get.sh`) |
| "Port 80 is in use"                                       | Another web server runs on the host: stop it, or put Lictory behind it with `--tls proxy`                                           |
| `/readyz` not reachable but "the gateway answers locally" | DNS, the firewall (80/443) or your proxy; certificates are issued only once DNS points here                                         |
| No certificate yet                                        | `lictory logs proxy`: Let's Encrypt reports why (DNS, rate limits, a CAA record)                                                    |
| Sign-up email never arrives                               | `--email none` or wrong SMTP settings: `sudo lictory install --email smtp …`, then `lictory logs worker`                            |
| "Another deployment of <env> is running"                  | Wait for it; `deploy.sh` holds a lock per environment                                                                               |
| "This environment accepts stable releases"                | The version belongs to the other channel: `sudo lictory install --channel …`                                                        |
| Replication slot or WAL warnings                          | [Replication slot and WAL growth](recovery.md#replication-slot-and-wal-growth)                                                      |
| Everyone shares one sign-in rate limit behind a proxy     | Set `--trusted-proxies`; `doctor` prints the address a proxy on the same host connects from                                         |

Logs of the tooling itself are in `/srv/lictory/<env>/deploy.log` and
`release-history.log`. The layout, database roles, health checks and scaling
limits are the same as in [deployment](deployment.md).

## Not yet covered

- Restricting sign-up: anyone who can reach the address can create an account
  and an organization, and there is no designated first administrator yet.
  Until invitation-only installations exist, keep the server on a private
  network or VPN, or, with single sign-on and `PASSWORD_LOGIN_ENABLED=false`,
  assign the application only to your own people at the identity provider.
- Helm charts, air-gapped installation bundles and one-click templates.
