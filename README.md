# Lictory

Collaborative requirements and engineering-readiness, built with Next.js 16,
Better Auth, Drizzle ORM, and PostgreSQL.

## Local development with Docker

The complete local stack includes the Next.js app, PostgreSQL, and Mailpit for
capturing verification and password-reset emails.

```bash
cp .env.example .env
docker compose up --build
```

- App: http://localhost:3000
- Mailpit inbox: http://localhost:8025
- PostgreSQL: `localhost:5432`

The app container waits for PostgreSQL, reconciles the locked dependencies,
applies committed Drizzle migrations, and starts Next.js in development mode.
Stop it with `docker compose down`. Add `-v` only when you intentionally want
to delete the local database.

## Transactional email

Authentication emails use typed React Email templates from `src/emails`.
Delivery automatically selects a provider:

- When `RESEND_API_KEY` is present, email is sent through Resend.
- Without that key, email is rendered from the same template and delivered to
  the configured SMTP server. The default Compose stack captures it in Mailpit.

For Resend, configure:

```bash
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Lictory <auth@your-verified-domain.com>
```

`onboarding@resend.dev` is retained as the example sender for initial account
testing. Use an address on a verified Resend domain before production. Resend
requests include an idempotency key derived from the recipient, auth flow, and
one-time action URL to avoid duplicate delivery when the same request retries.

## Local development without the app container

```bash
cp .env.example .env
docker compose up -d postgres mailpit
bun install
bun run db:migrate
bun run dev
```

## OAuth setup

OAuth buttons are visible but disabled until their provider has credentials in
`.env`. Configure these redirect URIs in the provider consoles:

- Google: `http://localhost:3000/api/auth/callback/google`
- Microsoft: `http://localhost:3000/api/auth/callback/microsoft`

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, and
`MICROSOFT_CLIENT_SECRET`. Microsoft defaults to the `common` tenant; override
`MICROSOFT_TENANT_ID` when the app should be tenant-specific.

## Database workflow

The schema entry point is `src/db/schema.ts`, which exports the generated Better
Auth schema and the application domain schema. See [the database model](docs/database-model.md)
for revision semantics, tenant constraints, retention, and enforcement boundaries.

```bash
bun run auth:generate # regenerate auth tables after changing Better Auth schema options
bun run db:generate  # create a committed SQL migration after schema changes
bun run db:migrate   # apply committed migrations
bun run db:studio    # inspect local data
bun run db:test      # verify migrations and constraints in a disposable local database
```

## Production notes

- Replace `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
- Set `BETTER_AUTH_URL` to the canonical HTTPS origin.
- Use a managed PostgreSQL database and a verified Resend sending domain.
- Keep OAuth callback URLs aligned with the production origin.

Collaborative requirements and engineering-readiness platform.

This repository currently contains the application scaffold only. Product
philosophy, glossary, and engineering conventions live in [`AGENTS.md`](./AGENTS.md).

## Stack

- [Bun](https://bun.sh) as package manager and script runner
- [Next.js](https://nextjs.org) (App Router, React Server Components)
- React and TypeScript (strict)
- Tailwind CSS
- ESLint (flat config, type-aware) and Prettier

## Prerequisites

- Bun (see the `packageManager` field in `package.json` for the expected version)

Bun is the only supported package manager. Do not use npm, pnpm, or yarn.

## Getting started

```bash
bun install
bun run dev
```

The app runs at http://localhost:3000.

## Scripts

| Command                | Purpose                                     |
| ---------------------- | ------------------------------------------- |
| `bun run dev`          | Start the development server                |
| `bun run build`        | Production build                            |
| `bun run start`        | Serve the production build                  |
| `bun run typecheck`    | TypeScript check without emitting files     |
| `bun run lint`         | Run ESLint                                  |
| `bun run lint:fix`     | Run ESLint with automatic fixes             |
| `bun run format`       | Format the repository with Prettier         |
| `bun run format:check` | Verify formatting without writing           |
| `bun run check`        | Lint, typecheck, and format check (CI-safe) |

`bun run check` never modifies files.

## Editor setup

VS Code and Cursor users should install the recommended workspace extensions
when prompted (`.vscode/extensions.json`): Prettier, ESLint, and Tailwind CSS
IntelliSense.

Workspace settings in `.vscode/settings.json` format files with Prettier on
save and apply ESLint fixes on save. Tailwind classes are sorted automatically
by `prettier-plugin-tailwindcss`.
