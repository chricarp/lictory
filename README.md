# Lictory

**Requirements, reviewed like code.** Lictory helps product, engineering and QA
turn rough proposals into agreed, implementation-ready specifications.

Draft a proposal, discuss specific passages, accept suggested changes, review
immutable revisions and approve the version you actually read. Readiness comes
from checks and review evidence. Then deliver the work in Lictory or publish it
to an external delivery system. Each project chooses its delivery mode.

All current product features belong to the open source core. Self-hosting has
no user-count or company-size restriction. The maintained community deployment
runs on one machine; managed high availability and scaling are future cloud
operational capabilities. See [the distribution model](docs/internals/distribution.md)
for the boundary. The core is licensed under [AGPL-3.0-only](LICENSE); see [licensing](docs/operations/open-source-release.md) for launch prerequisites.

## Try it locally

Install Docker and the Bun version from `package.json`. Bun is the supported
package manager.

```sh
cp .env.example .env
docker compose up --build
```

Open http://localhost:3000 and create an account. Verification messages arrive
in [Mailpit](http://localhost:8025). Create an organization and project, then
start a proposal. Optional AI, analytics, OAuth and file storage are disabled
until you configure them. Core refinement requires none of those services.

To run the app on your machine instead of in Docker:

```sh
cp .env.example .env
docker compose up -d postgres mailpit
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

Local credentials are for development only. `docker compose down` preserves
local data; `docker compose down -v` deletes it.

## Use, host or contribute

- [First specification](docs/guides/first-specification.md): proposal, review,
  approvals, readiness and delivery.
- [Self-hosting](docs/operations/self-hosting.md): single-node deployment,
  configuration, backups and upgrades.
- [Documentation](docs/README.md): user guides, operations and architecture.
- [Contributing](CONTRIBUTING.md): scope, development and required verification.
- [Security](SECURITY.md): private vulnerability reporting.
- [Governance](GOVERNANCE.md) and [community conduct](CODE_OF_CONDUCT.md).

## Project structure

| Path                                    | Responsibility                                                     |
| --------------------------------------- | ------------------------------------------------------------------ |
| `src/app`, `src/components`             | Shared Next.js application and interface                           |
| `src/sync`, `src/db`                    | Collaboration, authorization, durable state and history            |
| `src/delivery`, `src/ai`, `src/storage` | Infrastructure and provider boundaries                             |
| `src/cloud`                             | Official cloud release operations; never imported by product code  |
| `drizzle`                               | Committed, immutable database migrations                           |
| `scripts`, `tests`                      | Development, administration and verification                       |
| `docs`                                  | Markdown sources and navigation for a future documentation website |

Next.js, React, TypeScript, PostgreSQL and Bun run the same product in community
and cloud installations. `private: true` in `package.json` prevents accidental
npm publication; it does not determine source-code licensing.

Public repository identity and copyright attribution are still being finalized.
Existing upstream links are provisional; forks should update community contact
links before accepting reports. No hosted HA offering or availability commitment
is announced by this repository.
