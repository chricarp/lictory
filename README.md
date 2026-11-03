# Lictory

Collaborative requirements and engineering readiness: specifications are
drafted, reviewed, revised and approved like code, then delivered natively or
handed off to Jira. Product philosophy, the glossary and engineering
conventions live in [`AGENTS.md`](./AGENTS.md); documentation is indexed in
[`docs/README.md`](./docs/README.md). Read [CONTRIBUTING.md](./CONTRIBUTING.md)
before opening a pull request.

## Architecture

One repository, Bun workspaces:

| Workspace        | What it is                                                                              |
| ---------------- | --------------------------------------------------------------------------------------- |
| `apps/platform`  | React + Vite + TanStack Router SPA (`app.lictory.com`), synchronized with Rocicorp Zero |
| `apps/api`       | Hono on Node.js: Better Auth, Zero query/mutate endpoints, files, AI, MCP, delivery     |
| `apps/worker`    | Supervised background jobs: AI runs, email, delivery exports, Jira status, cycles       |
| `apps/marketing` | Next.js public website (`lictory.com`), server-rendered, no database                    |
| `packages/core`  | Domain logic, contracts, database access (Drizzle) and adapters                         |
| `packages/zero`  | Zero schema, server-defined queries and the mutator                                     |
| `packages/ui`    | Shared React primitives, theme and consent UI                                           |

PostgreSQL is the source of truth. Every domain write maintains read
projections in the same transaction; Zero replicates only those projections
(and membership) to browsers. See
[synchronization](docs/internals/synchronization.md) and
[deployment](docs/operations/deployment.md) (single-server Docker Compose).

## Getting started

Requirements: Bun (version in `packageManager`), Node.js 24 LTS, Docker and Git.
Bun is the only supported package manager. Node.js runs the application builds
and provides the supported ABI for Zero's native SQLite module.

```bash
cp .env.example .env
bun install
docker compose up -d   # PostgreSQL, migrations, zero-cache, Mailpit
bun run dev            # SPA, API, worker and website
```

- Platform: http://localhost:3000 (API on 3002, zero-cache on 4848)
- Website: http://localhost:3100
- Mailpit inbox: http://localhost:8025

Every optional integration (OAuth, Resend, S3-compatible file storage, OpenAI,
PostHog, Jira) stays disabled until its variables are set in `.env`; core
refinement works without them. See [the development runbook](docs/operations/development.md) for daily
commands, tests and the full verification sequence.

## Transactional email

Authentication emails use typed React Email templates from
`packages/core/src/emails`. With `RESEND_API_KEY` set, email goes through
Resend (with idempotency keys); otherwise it is delivered to the configured
SMTP server, which Mailpit captures locally.

## OAuth setup

Each OAuth button appears once its provider has credentials in `.env`.
Configure these redirect URIs in the provider consoles (and the production
origin's equivalents on `https://app.lictory.com`):

- Google: `http://localhost:3000/api/auth/callback/google`
- Microsoft: `http://localhost:3000/api/auth/callback/microsoft`

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, and
`MICROSOFT_CLIENT_SECRET`. Microsoft defaults to the `common` tenant; override
`MICROSOFT_TENANT_ID` when the app should be tenant-specific. See
[sign-in methods and account linking](docs/internals/onboarding.md#sign-in-methods-and-account-linking)
for how provider sign-ins attach to existing accounts, and the optional
[OAuth proxy](docs/operations/oauth-proxy.md) for changing local URLs.

## Database workflow

The schema entry point is `packages/core/src/db/schema.ts`. See
[the database model](docs/internals/database-model.md) and
[database migrations](docs/operations/migrations.md), including the Zero
expand/contract deployment order.

```bash
bun run auth:generate # regenerate auth tables after changing Better Auth schema options
bun run db:generate  # create a committed SQL migration after schema changes
bun run db:generate:data # empty SQL migration for small reference-data changes
bun run db:check     # fail when the schema has changes without a migration
bun run db:migrate   # apply committed migrations (local by default)
bun run db:migrate:status # list pending migrations
bun run db:studio    # inspect local data
bun run db:test      # verify migrations and constraints in a disposable local database
```

## Versions and releases

Conventional Commit PR titles determine semantic versions. Merges build nightly
images for staging; **Release to Production** in GitHub Actions deploys a
tested version to the production server after approval. See
[the release runbook](docs/operations/releases.md).

## Scripts

| Command             | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `bun run dev`       | Platform, API, worker, zero-cache and website        |
| `bun run typecheck` | TypeScript check of every workspace                  |
| `bun run lint`      | ESLint (flat config, type-aware)                     |
| `bun run format`    | Format the repository with Prettier                  |
| `bun run check`     | Types, lint, format, unused code and PR assets       |
| `bun test src`      | Domain and unit tests (disposable PostgreSQL)        |
| `bun run test:e2e`  | Production builds and browser workflows (both sites) |

`bun run check` never modifies files.

## Editor setup

VS Code and Cursor users should install the recommended workspace extensions
when prompted (`.vscode/extensions.json`): Prettier, ESLint, and Tailwind CSS
IntelliSense.

Workspace settings in `.vscode/settings.json` format files with Prettier on
save and apply ESLint fixes on save. Tailwind classes are sorted automatically
by `prettier-plugin-tailwindcss`.

## Community and open-source preparation

Read [Contributing](CONTRIBUTING.md), [Governance](GOVERNANCE.md),
[Support](SUPPORT.md), the [Code of conduct](CODE_OF_CONDUCT.md), and the
[Security policy](.github/SECURITY.md).

Lictory is licensed under the [MIT License](LICENSE). Third-party components
retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). Open-source launch is being prepared: the
[launch runbook](docs/operations/open-source.md) tracks rights review, GitHub
configuration and the remaining publication gates. Package manifests remain
private to prevent accidental package publication.
