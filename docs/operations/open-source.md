# Repository administration

Lictory is distributed as self-hosted software under the root MIT license.
Contribution terms are in [CONTRIBUTING.md](../../CONTRIBUTING.md); ownership
declarations and bundled-material provenance are in
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). Those are the sources
of truth rather than a second licensing discussion here. Packages remain
`private` to prevent accidental package publication.

This runbook covers repository settings and distribution checks. It does not
certify that an artifact is safe to publish or authorize changing repository
visibility. Keep completion evidence in the publication issue or release
record, tied to the exact commit and artifact digests.

## Before first publication

- Review the rights to contributed code, artwork and fixtures. Preserve the
  project license and each bundled material's required notices.
- Inventory the exact distributed dependency binaries, Linux variants and
  container layers. `bun run licenses:report /tmp/lictory-licenses` inventories
  the installed tree, not every release artifact; see the notices for its limits.
- Scan every history ref being published, plus LFS objects, release assets,
  Actions logs/artifacts, images/layers and issue/PR attachments. Check for
  credentials, personal data, customer content and internal hostnames. Keep
  findings outside Git and revoke exposed credentials before cleanup.
- Test a clean checkout without private dependencies, personal files or paid
  integrations. Verify core review without AI, both delivery modes, migrations,
  the published installer, backup and restoration. Record the full local
  [verification sequence](development.md#full-verification-before-a-pull-request).
- Review historical releases independently: an old tag or image may predate
  the current license and notices. Review registry visibility separately from
  repository visibility.
- Review remaining hosted-era GitHub environments and variables. Delete only
  settings confirmed unused after checking deployment history and current workflows.
- Have the owner review the evidence and decide visibility. Test private
  vulnerability reporting immediately after publication; the endpoint in
  [SECURITY.md](../../.github/SECURITY.md) is unavailable while the repo is private.

Documentation screenshots belong in `apps/docs/public/screenshots`, use
fictional data and explain current behavior. PR-only evidence belongs on the PR.
Neither is proof that the other publication checks are complete.

## GitHub configuration

Repository settings are live state. Verify them in GitHub; do not treat a
snapshot in a Markdown file as evidence that protection is enabled.

- Protect `main` and maintained release branches against deletion and force
  pushes. Require PRs, resolved conversations, **Verify** and **Conventional PR
  title**. Add CODEOWNERS approval when an independent reviewer is available;
  record any necessary sole-maintainer bypass narrowly and audit its use.
- Prefer squash merges with the conventional PR title. Preserve maintenance
  ancestry as described in [releases](releases.md). Delete merged topic branches.
- Default Actions tokens to read-only. Require approval for outside workflows
  and run untrusted PR code on disposable runners without deployment secrets.
  Keep third-party actions pinned to full commit SHAs.
- Keep the title workflow's `pull_request_target` metadata-only: never execute
  PR code or title/body text. Review reusable workflows, `workflow_run` and
  artifact consumption for trust boundaries.
- Restrict `release` and `websites` environment branches to `main`, with
  required reviewers if appropriate. `RELEASE_MANAGERS` controls who may
  release; when unset only the owner can. See [release access](releases.md#who-can-release)
  and [website credentials](websites.md#github-configuration).
- Enable dependency/security alerts, secret scanning, push protection and
  private vulnerability reporting where available. Verify who receives reports;
  the code of conduct documents the sole-maintainer reporting limitation.
- Apply labels through **Repository labels**, which updates `.github/labels.json`
  entries without deleting other labels. Keep `release:stable-api` for its
  documented release semantics.

## Security scanning

| Workflow                | Scope                                                            | Private repository |
| ----------------------- | ---------------------------------------------------------------- | ------------------ |
| `codeql.yml`            | TypeScript and Actions, security-extended                        | Skipped            |
| `dependency-review.yml` | Dependency, workflow and image changes; high/critical advisories | Skipped            |
| `scorecard.yml`         | OpenSSF Scorecard                                                | Skipped            |
| `workflow-lint.yml`     | actionlint and zizmor for workflow changes                       | Runs               |
| `gitleaks.yml`          | Added PR commits; full history on manual dispatch                | Runs               |

The first three require a public repository under the current workflow guards.
They activate when visibility becomes public. Reviewed suppressions belong in
`.github/zizmor.yml` or inline with a reason; reviewed secret-scanner false
positives use `.gitleaksignore` fingerprints.

PR CI runs static checks and selects domain and browser smoke tests by changed
paths. Nightly runs every browser workflow. Neither replaces the complete local
verification gate in the development runbook.

Dependabot updates pinned image digests. Check variable-default image references
in deployment Compose files by hand when it cannot recognize them.

## Triage and review

Start reports with `needs-triage`; use `needs-information` for missing context
and `accepted` only after explicit scope agreement. `good first issue` needs a
bounded problem and verification guidance. Avoid automatic stale closure of
unresolved defects. See [contributing](../../CONTRIBUTING.md) for scope and
review requirements, [support](../../SUPPORT.md) for help and
[governance](../../GOVERNANCE.md) for decisions and maintainership.
