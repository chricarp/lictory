# Contributing to Lictory

Thanks for helping. Lictory is review-driven software, and we review
contributions the way the product reviews requirements: a clear problem, an
agreed scope, visible evidence.

Opening a pull request does not oblige maintainers to review or merge it. We may
ask for a smaller scope, defer it, or solve the problem differently.

## Before you start

1. Read [`AGENTS.md`](AGENTS.md). Its product principles and glossary apply to
   code, UI copy and docs from every contributor, human or agent.
2. Set up your machine with the [development runbook](docs/operations/development.md).
3. Search existing issues before filing or starting work.

## Agree on the problem first

- **Small, obvious bug fixes** can go straight to a pull request. Explain the
  defect and why the fix is obvious.
- **Larger bug fixes** need an issue that a maintainer has confirmed, so the
  failure and the intended behavior are established.
- **Features and intentional behavior changes** need a proposal issue with
  explicit maintainer agreement on direction and scope. Link that agreement in
  your pull request. Calling a behavior change a bug fix does not exempt it.

The test for new behavior is the central question in `AGENTS.md`: does it help a
team turn incomplete product intent into an agreed, implementation-ready
specification with less coordination overhead, or deliver that work with
everyday essentials? Changes that add process, configuration or screens without
improving clarity, traceability or readiness are unlikely to be accepted.

## One problem per pull request

Split independent fixes, even when each is useful. Include the schema,
migration, server, client, test and documentation changes that one problem
needs. Adjacent cleanups and refactors go in their own pull request.

Use a conventional commit title in plain language, e.g.
`fix(review): approvals no longer survive a material revision`.

The **Conventional PR title** check is required. `feat` advances the minor
version; `fix` and `perf` advance patch; a `!` before the colon marks a breaking
change. Other supported types do not advance versions unless breaking. Before
1.0, breaking changes advance minor; afterward they advance major. See
[release policy](docs/operations/releases.md) for exact semantics and optional
human-readable PR release notes. Prefer squash merges with the PR title as the
commit subject; released maintenance branches must merge back without squashing
their stable ancestry.

## Changes that always need a maintainer

These areas carry the product's invariants. Expect slower, deeper review, and
call them out in the pull request:

- authentication, Better Auth configuration, SSO, sessions and invitations
- authorization, capabilities and organization (tenant) isolation
- revisions, approvals, readiness checks and their semantics
- the synchronization protocol: change log, checkpoints, receipts, locks
- database schema and migrations (`drizzle/`)
- external side effects: Jira and other delivery providers, email, AI providers
- dependencies, CI, deployment workflows, and agent or contributor instructions

## Show that it works

Explain how you established the problem, how you checked the change, and what
you observed. "Tests pass" alone is not evidence.

- Add or update tests for domain behavior and invariants (see "Behavior
  verification" in `AGENTS.md`). Test behavior, not implementation details.
- For UI changes, include before/after screenshots, and a short recording when
  timing or interaction matters. Upload them to the pull request; never commit
  them.
- Before requesting review, run the full verification sequence from
  [the runbook](docs/operations/development.md#full-verification-before-a-pull-request)
  and report the results. Say what you could not check.

If an agent did the work, name the model and harness at the end of the
description. We judge the problem, scope and evidence, not who or what wrote it.

## Security

Never report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## Closing and reconsideration

A pull request that misses these requirements may be closed before deeper
review. The closing comment names the specific requirement and what would fix
it. Address it and ask for reconsideration, or open focused replacements linked
to the original.
