# Versions and releases

Lictory releases through two channels: **Nightly** and **Stable**. Maintainers
merge reviewed PRs normally. GitHub Actions calculates versions, writes release
notes, creates tags, and deploys nightlies. The release decision is selecting
**Release to Production → Run workflow** on `main` when a nightly is ready.

```text
Conventional PR title → merge → nightly images (→ staging) → test nightly
                                                   ↓
                                      Release to Production
                                                   ↓
                      stable images → migrate on server → activate → publish
```

This follows the source-selection principle in
[T3 Code's release workflow](https://github.com/pingdotgg/t3code/blob/main/.github/workflows/release.yml)
and [release guide](https://github.com/pingdotgg/t3code/blob/main/docs/operations/release.md):
production builds the commit a verified nightly shipped, not a moving `main`.
Lictory calculates its version from merged PR metadata rather than T3 Code's
package-based nightly patch calculation.

## PR titles and version calculation

Titles follow [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/).
The required **Conventional PR title** check uses the pinned
`amannn/action-semantic-pull-request` action. It runs without checking out PR
code, including on fork PRs. Editing a title reruns the check.

| PR title                                                                          | Effect after a published stable `1.4.2` |
| --------------------------------------------------------------------------------- | --------------------------------------- |
| `feat(auth): add SSO`                                                             | `1.5.0`                                 |
| `fix(editor): preserve drafts`                                                    | `1.4.3`                                 |
| `perf(search): reduce latency`                                                    | `1.4.3`                                 |
| `feat(api)!: replace authentication`                                              | `2.0.0`                                 |
| `chore!: change a supported contract`                                             | `2.0.0`                                 |
| `docs`, `chore`, `ci`, `test`, `refactor`, `style`, `build`, `revert` without `!` | No increment                            |

Mark **every** breaking PR with `!` in its title. The title, rather than a
breaking footer hidden in the PR body, is the versioning contract. A revert is
not assumed to be harmless: use `fix` when it repairs behavior, or `!` when it
changes a supported contract.

The highest bump across all unreleased PRs wins: breaking, then feature, then
fix/performance. Two features and three fixes after `1.4.2` predict `1.5.0` on
every nightly until a stable release is published. Nightlies do not increment
one another's stable version.

During `0.x`, breaking PRs advance the minor version and reset patch, for example
`0.4.9 → 0.5.0`. Features also advance minor; fixes advance patch. Initial
development never silently declares a stable API. To establish the `1.0.0`
contract, merge a reviewed breaking PR marked `release:stable-api`; that semantic
declaration makes its next candidate `1.0.0` automatically. The label requires a
breaking title and is captured in release provenance. There is no numeric version
override on the production form. After `1.0.0`, breaking PRs advance major.

The baseline is the highest published stable GitHub Release, which must also be
GitHub's latest stable release. Its immutable tag supplies the exact source SHA.
The collector walks the Git graph from that commit to the candidate and uses
GitHub's commit-to-PR API and actual merged PR titles. PR numbers are deduplicated,
and their merge commits must be in the candidate's unreleased graph. Squash,
merge-commit and rebase merges are supported; dates and Git subject lines do not
determine whether a change is included. An older candidate cannot acquire PRs
merged later just because `main` has advanced.

Stacked PRs may retain a feature branch as their recorded target after their
changes reach `main`. They count like any other merged PR when their merge
commit is in the candidate's unreleased graph, regardless of that target branch.
Unmerged PRs and PRs whose merge commits are outside the release range cannot
account for new commits. Commits without an eligible PR still require explicit
direct-push recovery.

Use human-readable titles. Optionally add a `## Release notes` section to a PR
body with a concise description of user behavior and upgrade actions. Notes are
grouped into Breaking changes, Added, Fixed, Performance and Maintenance, with PR
links and authors. Nightly notes compare to the preceding published nightly on
the same source branch when it is an ancestor; the first nightly falls back to
the stable baseline. Stable notes always include the complete stable range.

## Automatic Nightly

**Nightly** runs for every push to `main` and protected `release/<major>.<minor>`
maintenance branches. It also runs automatically after stable publication so
the remaining `main` work gets a candidate based on the new stable baseline.
Ordinary PRs do not create release tags or GitHub Releases.

CI runs directly for pull requests and manual dispatches. To save Actions
minutes, pushes to `main` and maintenance branches are not re-verified: the
merged PR already passed CI, and Release to Production verifies the exact
candidate again before activation.

1. Pin the triggering SHA and calculate a candidate from the stable baseline.
2. Form `X.Y.Z-nightly.YYYYMMDD.<run_number>` using the workflow's original UTC
   creation date and run number. Retries do not use today's date or a new run
   attempt number.
   The `nightly-intent` journal preserves the original candidate across whole-run
   retries, even if another stable release appears while it is being repaired.
3. Build all images for `linux/amd64` and `linux/arm64` with the staging
   origins and push them to the registry (`IMAGE_REGISTRY`), tagged with the
   version; the deployment journal records their digests. Nightlies never run
   production migrations or touch the production server, and the job holds no
   deployment credential.
4. Reserve the immutable tag/manifest, publish a GitHub prerelease (never latest),
   and record success. The complete workflow must succeed before production
   selection treats the release as eligible.
5. When `STAGING_DEPLOY_ENABLED` is `true`, a separate job (GitHub environment
   `staging`) prepares, migrates and activates the nightly on the staging
   server. Staging runs nightlies only.

Each candidate's image digests appear in the Actions summary and the
deployment journal. Publication retries reuse the journaled images instead of
rebuilding. Nightly runs are serialized with retained queues. Failed builds or
publication cannot change production. A maintenance-only nightly remains useful
for testing but cannot become stable without a semantic version increment.

`package.json` in Git remains the development baseline. Build checkouts receive
the calculated version without commits to `main`; images embed it, and the
platform's account menu and the website show `X.Y.Z-nightly.*` on nightlies and
the clean `X.Y.Z` in production. Release manifests and image labels record
that same version and SHA.

## Release to Production

In GitHub **Actions → Release to Production → Run workflow**, select `main`.
Leave `nightly_tag` empty to select the newest eligible, successfully verified
nightly, or enter an exact tag such as `v1.5.0-nightly.20261008.142`.

Selection requires a published prerelease created by the release bot, a matching
immutable tag and manifest, a successful Nightly workflow for its exact SHA,
and a successful image build journaled for the configured registry.
The candidate's PR metadata and proposed version are recalculated against the
current stable baseline. A stale, downgraded, duplicate, or changed candidate is
rejected; it is never silently assigned a different version. If `main` has moved
ahead, the chosen older nightly remains the source.

The manual run records its chosen candidate in the GitHub `production-intent`
deployment journal. Rerunning all jobs keeps that intent, even after newer
nightlies appear. The temporary plan artifact is an execution copy, not the only
record of the decision.

The selected SHA passes the minimal CI workflow (types and migration checks)
again with the stable version. Only the deploy job accesses the protected
`Production` environment, its required approvals and the deployment SSH key.
Its release controller comes from the dispatch's protected `main` commit; the
application and migration code are checked out in a separate directory at the
nightly's exact SHA.

The deployment builds **new images with production origins** from that commit,
then, on the production server through the restricted SSH command: validates
that production only moves forward (no older version, no version reuse for
different code, no unpublished activation pending), prepares the release by
digest, takes a pre-deploy backup and applies migrations, waits for zero-cache
to replicate them, and activates the images
([deployment](deployment.md#deploying-a-release)). The server's reported active
version and image digests decide what is live. Only after migrations pass is
the stable tag reserved; only after activation does its GitHub Release become
published and latest. The original nightly remains unchanged.

Nightly and Stable share a verified source commit, not byte-identical images:
their versions and public origins differ.

## Hotfixes

Open a protected `release/<major>.<minor>` branch from the **current stable tag**,
and merge fix/performance PRs into it. Its automatic nightly excludes features
on `main`; feature PRs are excluded from maintenance candidates on the current
stable train. Compatible fixes become patches; an explicitly breaking urgent fix
retains its proper major bump (minor during `0.x`). Test it on staging, then select that exact nightly tag in
**Release to Production**. No manual version, notes, or tag commands are needed.

Merge the released maintenance branch back into `main` **with a merge commit**,
preserving the stable tag's ancestry. Do not squash or cherry-pick this history
integration. The next release excludes the already published fix and includes
the remaining main PRs exactly once. Main nightlies block until the latest
stable commit is an ancestor. Hotfix migrations must obey expand/contract; an
old branch with unknown applied migrations plus new pending migrations is
refused by the existing migration safety rules.

## Direct pushes and recovery

Require PRs for main and maintenance branches, including bot/dependency changes.
Unattributed direct commits block releases rather than being guessed from their
messages or dropped from the changelog. The bootstrap SHA is the only historical
boundary exempt from attribution.

For an exceptional direct push, merge a reviewed recovery PR through the normal
protected-branch process. Give it a Conventional Commit title describing the
combined repair, the `release:direct-push` label, and one body footer per exact
unattributed SHA: `Release-Commit: <40-character-sha>`. That PR owns the bump and
notes for those commits. A footer without the label, or a SHA outside the release
range, fails validation. Do not use version-bump commits or move published tags.

## Failures, retries and rollback

- Retry failed jobs in Actions. Published and draft manifests bind tags to one
  source and metadata snapshot. Matching retries are idempotent; collisions
  fail closed. Do not delete or move a reserved tag to reuse its version.
- A failed migration never activates a build or consumes a stable tag. Fix the
  problem and retry the same candidate. If code needs to change, dispatch a new
  verified candidate deliberately rather than letting a retry float to it.
- If activation succeeds but status recording or GitHub publication fails,
  retry the release. The server's active release and the deployment journal
  repair publication without rebuilding, remigrating or reactivating. An
  activated, unpublished version blocks a different production release until
  repaired.
- A failed activation restores the previous release's images automatically.
- Production database recovery uses **Database migrations** on `main` with a
  release version already prepared on the server. It shares the production
  release lock and never activates an application.
- Old production versions cannot be reactivated through this workflow. Release
  a reviewed revert as a new fix/breaking PR and promote its verified nightly.
  An emergency `deploy.sh production rollback` on the server is an
  administrator procedure outside the normal path. It switches images only,
  to a previously published stable release; the next Release to Production
  accepts that state and moves forward again.
- Database migrations are never automatically rolled back. Previous application
  code runs against the new schema between migration and activation, so every
  migration must remain backward compatible. See [migrations](migrations.md).

Previously published nightlies remain immutable after a stable promotion. Their
old baseline can make them ineligible; a new automatic nightly recalculates from
the new stable release. Publication retries preserve an already published
version's identity instead of creating a second version.

## One-time GitHub and server configuration

Repository variables:

| Variable                                        | Value                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `RELEASE_BOOTSTRAP_SHA`                         | Exact currently deployed legacy source commit; keep this fallback configured    |
| `RELEASE_BOOTSTRAP_VERSION`                     | Its clean version, default `0.1.0`; ignored once a stable release exists        |
| `IMAGE_REGISTRY`                                | Registry namespace for images, for example `ghcr.io/<owner>`                    |
| `IMAGE_CACHE_REGISTRY`                          | Optional BuildKit cache repository, for example `ghcr.io/<owner>/lictory-cache` |
| `STAGING_SITE_URL`, `STAGING_PLATFORM_URL`      | Origins compiled into nightly images                                            |
| `STAGING_POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST` | Optional browser analytics settings for nightlies                               |
| `LICTORY_LEGAL_*`                               | Legal notice details compiled into the website                                  |
| `STAGING_DEPLOY_ENABLED`                        | `true` to run every nightly on the staging server                               |

GitHub environment **Production** (required reviewers; branches `main` and
`release/*` only):

| Setting                                           | Value                                                           |
| ------------------------------------------------- | --------------------------------------------------------------- |
| Secret `DEPLOY_SSH_KEY`                           | Private key whose public half is restricted to `lictory-remote` |
| Variable `DEPLOY_SSH_TARGET`                      | `deploy@<production server>`                                    |
| Variable `DEPLOY_SSH_KNOWN_HOSTS`                 | The server's verified `ssh-ed25519` host key line               |
| Variables `SITE_URL`, `PLATFORM_URL`              | `https://lictory.com`, `https://app.lictory.com`                |
| Variables `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST` | Production browser analytics (optional)                         |

GitHub environment **staging** holds the same SSH settings for the staging
server. Packages are pushed with the workflow's `GITHUB_TOKEN`
(`packages: write`); the servers pull with a read-only token. No database or
application secret is stored in GitHub: they live in each server's `.env`
([deployment](deployment.md)).

Allow only `main` and protected `release/*` in **Production**, with no tag
allowance or pull-request branch access. Stable activation is also restricted
in code to a manual dispatch from `main`. `production-intent` and
`nightly-intent` are journals, not credential environments.

Protect main and maintenance branches against direct/force pushes and deletion.
Require **Conventional PR title** and **Verify**, with the team's normal review
policy. Prefer squash merges and set the squash commit subject to **PR title**;
enable merge commits for released maintenance history. Protect `v*` tags against
creation by unauthorized users and against updates/deletion, allowing release
automation to create tags. Ensure repository rules permit the workflow's tag
creation without granting it a main-branch write bypass. Protect changes to
release workflows and `deploy/` with maintainer review/CODEOWNERS.

Create the `release:direct-push` and `release:stable-api` labels. Add the required
title check to branch protections once its workflow has been installed on main;
the first installation PR uses the existing Verify/review requirements.
Pre-automation tags lack the new workflow files: legacy maintenance branches need
a reviewed import of release infrastructure and the version display before their
pushes can create nightlies. Import those changes without merging unrelated main
features. Future stable tags already contain that infrastructure.

Normal operation has no package bump, changelog edit, local deployment, or tag
push. Legacy stable releases remain valid baselines; their historical changelog
is retained in `CHANGELOG.md`. Release metadata and journals are not disposable
CI artifacts and must be retained for selection/recovery. Keep the registry's
images at least as long as the releases you may roll back to.

GitHub's `queue: max` preserves up to 100 pending runs; avoid exceeding that
platform limit and inspect canceled runs if it is reached. Actionlint 1.7.12
does not yet recognize this documented GitHub property: validate with its exact
`unexpected key "queue" for "concurrency" section` diagnostic suppressed, plus
the repository's YAML queue/permission/source guardrail tests. All other
actionlint diagnostics remain enabled. Real deployment credentials and DNS are
one-time operator configuration, not automatically provisioned by repository
tests.
