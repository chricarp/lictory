#!/usr/bin/env bash
# Decides which CI suites a pull request needs from its changed paths (one per
# line on stdin) and prints `unit=`, `e2e=`, `audit=`, `docs=` and `trial=`
# lines for $GITHUB_OUTPUT. Static checks (types, lint, formatting, unused code,
# migrations) always run. Anything not recognised runs everything: a skipped
# suite must never be the reason a regression reaches main.
set -euo pipefail

unit=false
e2e=false
audit=false
docs=false
trial=false
while IFS= read -r path || [ -n "$path" ]; do
  [ -n "$path" ] || continue
  case "$path" in
    bun.lock | package.json | */package.json) audit=true ;;
  esac
  case "$path" in
    # The documentation site is built (MDX compiled, pages exported) only when
    # it or what it renders changes.
    apps/docs/* | packages/ui/* | bun.lock) docs=true ;;
  esac
  case "$path" in
    # The laptop trial (deploy/try.sh) against the newest stable release.
    deploy/try.sh | tests/try/* | .github/actions/trial/*) trial=true ;;
  esac
  case "$path" in
    # CI itself: prove the whole pipeline still works.
    .github/workflows/ci.yml | .github/actions/* | .github/scripts/*)
      unit=true e2e=true ;;
    # Rendered by the applications, even when written as Markdown.
    apps/marketing/* | apps/platform/* | packages/*)
      unit=true e2e=true ;;
    # Prose, licenses and repository metadata (formatting is still checked).
    # The docs website needs no smoke workflows: its build is a static check.
    *.md | docs/* | LICENSE | LICENSES/* | apps/docs/* | .github/ISSUE_TEMPLATE/* | \
      .github/CODEOWNERS | .github/labels.json | .github/dependabot.yml | .github/*.md) ;;
    # Release tooling, deployment scripts and the other workflows are guarded
    # by domain tests (packages/core/src/release), not by browser workflows.
    deploy/* | .github/* | Dockerfile | .dockerignore) unit=true ;;
    *) unit=true e2e=true ;;
  esac
done

printf 'unit=%s\ne2e=%s\naudit=%s\ndocs=%s\ntrial=%s\n' "$unit" "$e2e" "$audit" "$docs" "$trial"
