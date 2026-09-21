# Lictory

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
