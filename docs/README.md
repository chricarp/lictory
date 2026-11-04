# Lictory docs

Product principles, the glossary and engineering conventions live in
[`AGENTS.md`](../AGENTS.md). Read it first; these documents build on it.

User documentation (concepts, a team guide, self-hosting and integrations) is
the documentation site in [`apps/docs`](../apps/docs/content/docs), published at
[docs.lictory.com](https://docs.lictory.com). The documents below are for
people working on Lictory and operating lictory.com.

## Working on Lictory

- [Development runbook](./operations/development.md): setup, daily commands,
  tests and the full verification sequence
- [Contributing](../CONTRIBUTING.md): what a pull request needs
- [Third-party notices](../THIRD_PARTY_NOTICES.md): bundled materials and dependency reports

## Internals

Durable concepts that are easy to misunderstand. Read the first four before
adding domain writes or synchronized entities.

- [Organizations, projects and teams](./internals/organization-model.md):
  what each scope owns, application roles, project roles and disciplines,
  delivery modes
- [Workspace synchronization and review invariants](./internals/synchronization.md)
- [Delivery model](./internals/delivery.md)
- [Work item lifecycle](./internals/lifecycle.md): proposals, agreed scope,
  reviewed breakdowns, delivery completion and reusable product knowledge
- [Capabilities, MCP and agents](./internals/capabilities.md)
- [Audit log](./internals/audit.md): what is recorded, immutability,
  retention and how features record new events
- [Organization data export](./internals/data-export.md): the export job,
  what an archive contains, and the archive format and its versioning
- [Database model](./internals/database-model.md)
- [Lictory Intelligence](./internals/ai.md)
- [Notifications](./internals/notifications.md)
- [Account and workspace onboarding](./internals/onboarding.md): including
  sign-in methods and account linking
- [Two-factor authentication and passkeys](./internals/two-factor-authentication.md):
  factors, the organization requirement and recovery
- [Private file storage](./internals/file-storage.md)
- [Profile photos](./internals/profile-photos.md)
- [Social link previews](./internals/social-previews.md)
- [Search and AI discoverability](./internals/discoverability.md)
- [Product analytics](./internals/analytics.md)
- [Brand identity](./internals/brand.md)
- [State illustrations and design brief](./internals/illustrations.md)
- [Accessibility](./internals/accessibility.md): the WCAG 2.2 AA target,
  automated lint and browser checks, and known gaps

## Operations

- [Self-hosting](./operations/self-hosting.md): install and operate Lictory on
  your own Linux server with `get.sh` and the `lictory` command (install,
  upgrade, backup, restore, doctor)
- [Deployment and operations](./operations/deployment.md): single-server
  Docker Compose topology, worker scheduling, first launch, upgrades and rollback
- [Websites on Cloudflare](./operations/websites.md): the marketing
  website and the documentation; the `websites` environment,
  token scope, DNS, how deploys trigger and rollback
- [Existing reverse proxy, internal CA and plain HTTP](./operations/reverse-proxy.md):
  nginx and Traefik in front of the gateway, WebSockets, streaming, client
  addresses, certificates and the limits of plain HTTP
- [Backups and recovery](./operations/recovery.md): backups, restore drills,
  database, Zero replica and worker recovery
- [Local and preview OAuth](./operations/oauth-proxy.md): fixed callbacks and
  separate production/development clients
- [Single sign-on](./operations/sso.md): a company OpenID Connect identity
  provider (Okta, Entra ID, Keycloak, Dex…) and SSO-only installations
- [Versions, release preparation and hotfixes](./operations/releases.md)
- [Database migrations](./operations/migrations.md)
- [Public legal notices](./operations/legal.md)
- [Open-source launch and repository administration](./operations/open-source.md)
