---
name: test-lictory-app
description: Verify a user-facing Lictory change end to end in a browser against an isolated database. Use after changing UI, review workflow, approvals, readiness, delivery or onboarding behavior, and when collecting before/after evidence for a pull request.
---

# Test the Lictory app

Verify the complete interaction that changed, not that a control renders
(`AGENTS.md`, "Frontend verification"). Prefer the harness's built-in browser
tools (for example a preview panel). If none exist, write or extend a Playwright
spec in `tests/` and run it with `bun run test:e2e`.

## Isolate state

Never test against the developer's main database or a shared environment.

1. Ensure `docker compose up -d postgres mailpit` is running.
2. Create a disposable database, e.g.
   `docker compose exec -T postgres createdb -U lictory lictory_agent_<id>`.
3. Run with `DATABASE_URL` and `DATABASE_URL_UNPOOLED` pointing at it:
   `bun run db:migrate`, then `bun run dev --port <free port>`.
4. Drop the database when the user no longer needs the running app.

Reuse a healthy server already started for this task. Stop only processes you
started.

## Seed meaningful data

Sign up through the UI; verification links arrive in Mailpit at
http://localhost:8025. Complete onboarding with a project and team that match
the change (native or external delivery, sprints or continuous flow). For
review flows you need a second user: invite them from organization settings and
use a separate browser context so both sides are observable.

`tests/workspace.spec.ts` and `tests/onboarding-helpers.ts` show how the suite
seeds verified users directly; reuse those patterns in specs rather than
inventing new fixtures.

## Exercise the domain, not just the screen

For refinement changes, walk the chain the change touches, for example:

```text
author edits → revision increments → reviewer sees diff
→ thread or suggestion → accept → new revision
→ approval stale or valid as expected → readiness checks update
```

Check the realtime path (second user's view updates without reload) and the
recovery path (reload shows the same durable state). Check the empty, error and
permission-denied states the change can reach.

## Evidence

Capture before/after screenshots, and a short recording when timing or motion
matters. Attach them to the pull request; never commit them (`bun run check`
rejects media outside the directories that ship it). Keep secrets, emails of
real people and tokens out of screenshots.
