# Lictory docs

Product principles, the glossary and engineering conventions live in
[`AGENTS.md`](../AGENTS.md). Read it first; these documents build on it.

User documentation (concepts, a team guide, terminal workflows, self-hosting
and integrations) is
the documentation site in [`apps/docs`](../apps/docs/content/docs), published at
[docs.lictory.com](https://docs.lictory.com). The documents below are for
people working on Lictory and operating lictory.com.

For everyday terminal use, start with the hosted [server CLI guide](https://docs.lictory.com/self-hosting/terminal)
and [coding agent / MCP guide](https://docs.lictory.com/integrations/agents).

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
- [Lictory Spaces](./internals/spaces.md): spaces and pages, live drafts,
  commits and reviewed publishing, access inherited from projects and teams,
  the collaboration service (in development)
- [Live drafts of specifications](./internals/specification-drafts.md):
  several people editing a specification line at once, and how only Save
  revision and Commit turn the shared draft into history
- [One editor for pages and Markdown](./internals/editor.md): how the rich
  editor stores Markdown without changing unedited text, references and their
  chips
- [Knowledge links](./internals/knowledge-links.md): references, citations,
  attachments, provenance, branch origins and context links between pages
  and work, who owns each and who may see them
- [Audit log](./internals/audit.md): what is recorded, immutability,
  retention and how features record new events
- [Organization data export](./internals/data-export.md): the export job,
  what an archive contains, and the archive format and its versioning
- [Database model](./internals/database-model.md)
- [Lictory Intelligence](./internals/ai.md)
- [Notifications](./internals/notifications.md)
- [Account and workspace onboarding](./internals/onboarding.md): including
  sign-in methods and account linking
- [Account deletion](./internals/account-deletion.md): anonymization, what is
  removed and kept, former members
- [Organization deletion](./internals/organization-deletion.md): scheduling by
  an owner, the locked grace period, the deletion job and what remains
- [Instance administration](./internals/instance-administration.md): instance
  administrators, the access policy (who may sign up and create
  organizations), deactivation and its history
- [Two-factor authentication and passkeys](./internals/two-factor-authentication.md):
  factors, the organization requirement and recovery
- [Private file storage and profile photos](./internals/file-storage.md)
- [Search, AI discoverability and safe social previews](./internals/discoverability.md)
- [Product analytics](./internals/analytics.md)
- [Identity and illustrations](./internals/design.md): shared artwork, product
  scenes, empty states and asset delivery
- [Accessibility](./internals/accessibility.md): the WCAG 2.2 AA target,
  automated lint and browser checks, and known gaps

## Operations

- [Configuration reference](./operations/configuration.md): every environment
  variable, which service reads it, defaults, secrets and startup validation
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
- [External and managed PostgreSQL](./operations/external-database.md): what
  makes a PostgreSQL compatible (checked by `lictory database check`), role
  setup without a superuser, degraded modes, backups and provider settings
- [Backups and recovery](./operations/recovery.md): backups, restore drills,
  database, Zero replica and worker recovery
- [Local and preview OAuth](./operations/oauth-proxy.md): fixed callbacks and
  separate production/development clients
- [AI providers](./operations/ai-providers.md): OpenAI, Anthropic, Azure
  OpenAI and self-hosted models for Lictory Intelligence, reaching an
  endpoint from containers, the connection check
- [Single sign-on](./operations/sso.md): a company OpenID Connect identity
  provider (Okta, Entra ID, Keycloak, Dex…) and SSO-only installations
- [Versions, release preparation and hotfixes](./operations/releases.md)
- [Database migrations](./operations/migrations.md)
- [Public legal notices](./operations/legal.md)
- [Repository administration and publication checks](./operations/open-source.md)
