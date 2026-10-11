# Lictory docs

Product principles, the glossary and engineering conventions live in
[`AGENTS.md`](../AGENTS.md). Read it first; these documents build on it.

## Working on Lictory

- [Development runbook](./operations/development.md): setup, daily commands,
  tests and the full verification sequence
- [Contributing](../CONTRIBUTING.md): what a pull request needs

## Internals

Durable concepts that are easy to misunderstand. Read the first four before
adding domain writes or synchronized entities.

- [Organizations, projects and teams](./internals/organization-model.md):
  what each scope owns, application roles, project roles and disciplines,
  delivery modes
- [Workspace synchronization and review invariants](./internals/synchronization.md)
- [Delivery model](./internals/delivery.md)
- [Capabilities, MCP and agents](./internals/capabilities.md)
- [Database model](./internals/database-model.md)
- [Lictory Intelligence](./internals/ai.md)
- [Notifications](./internals/notifications.md)
- [Account and workspace onboarding](./internals/onboarding.md): including
  sign-in methods and account linking
- [Private file storage](./internals/file-storage.md)
- [Social link previews](./internals/social-previews.md)
- [Search and AI discoverability](./internals/discoverability.md)
- [Product analytics](./internals/analytics.md)
- [Brand identity](./internals/brand.md)
- [State illustrations and design brief](./internals/illustrations.md)

## Operations

- [Deployment and operations](./operations/deployment.md)
- [Versions, release preparation and hotfixes](./operations/releases.md)
- [Database migrations](./operations/migrations.md)
- [Public legal notices](./operations/legal.md)
