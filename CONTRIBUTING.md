# Contributing to Lictory

Thanks for helping. Lictory is review-driven software, and we review
contributions the way the product reviews requirements: a clear problem, an
agreed scope, visible evidence.

Opening a pull request does not oblige maintainers to review or merge it. We may
ask for a smaller scope, defer it, or solve the problem differently.

## Your first contribution

1. **Pick a starter issue.** Issues labelled
   [good first issue](https://github.com/chricarp/lictory/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
   are scoped by a maintainer: each names the files involved and what counts as
   done. Comment on the issue before you start so two people don't take the
   same one.
2. **Ask early.** Questions about the code, setup or an idea that isn't a
   proposal yet belong in [Discussions](https://github.com/chricarp/lictory/discussions).
   Ask in the issue itself when the question is about that issue.
3. **Run Lictory locally.** Follow [Develop locally](README.md#develop-locally);
   the [repository layout](README.md#repository-layout) shows where each part
   lives. `bun run dev` serves the app at http://localhost:3000.
4. **Check as you go.** Run the tests nearest your change:
   `bun test --isolate <path>` for domain code,
   `bun run test:e2e tests/platform/<file>.spec.ts` for a browser workflow. The
   [development runbook](docs/operations/development.md#daily-commands) lists
   the daily commands.
5. **Open the pull request.** Fill in the template, show that it works (see
   below), and run the full verification sequence first: `bun run verify`
   runs all of it, starting and removing the database and mail services it
   needs (Docker required). If something on your machine prevents part of it,
   say which step and what happened; a maintainer can help.
   A draft pull request gets only the static checks in CI, and its
   `Verify` check stays red until you mark it ready for review, which runs the
   domain and browser tests.

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
- UI changes must keep WCAG 2.2 AA: they pass the accessibility lint rules and
  the browser suite's axe checks, and work with a keyboard. See
  [accessibility](docs/internals/accessibility.md).
- Before requesting review, run the full verification sequence from
  [the runbook](docs/operations/development.md#full-verification-before-a-pull-request)
  (`bun run verify`, or the commands by hand) and report the results; the
  summary it prints lists every step. Say what you could not check.

If an agent did the work, name the model and harness at the end of the
description. We judge the problem, scope and evidence, not who or what wrote it.

## Security

Never report vulnerabilities in public issues. See [the security policy](.github/SECURITY.md).

## Closing and reconsideration

A pull request that misses these requirements may be closed before deeper
review. The closing comment names the specific requirement and what would fix
it. Address it and ask for reconsideration, or open focused replacements linked
to the original.

## Community and contribution rights

Follow the [code of conduct](CODE_OF_CONDUCT.md). See [governance](GOVERNANCE.md)
for decisions and maintainership, and [support](SUPPORT.md) for help.

By intentionally submitting a contribution, you agree to license it under the
project's [MIT License](LICENSE). You retain copyright in your contributions;
no copyright assignment, CLA or DCO sign-off is currently required. Submit only
work you have the right to contribute, including any required employer approval.
Preserve third-party license notices and identify copied code, assets or
generated material that needs attribution. A human contributor remains
responsible for AI-assisted work, its correctness and the right to submit it.

The owner must complete the rights and artifact checks in the
[publication runbook](docs/operations/open-source.md#public-distribution)
before soliciting or merging outside contributions.
