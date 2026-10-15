# Versions and releases

Lictory releases through two channels: **Nightly** and **Stable**. Maintainers
merge reviewed PRs normally. GitHub Actions calculates versions, writes release
notes, creates tags, and deploys nightlies. The release decision is selecting
**Release to Production → Run workflow** on `main` when a nightly is ready.

```text
Conventional PR title → merge → verified nightly → test nightly
                                                   ↓
                                      Release to Production
                                                   ↓
                             stable build → migrate → activate → publish
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
Ordinary PR previews do not create release tags or GitHub Releases.

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
3. Create a **Preview deployment in the existing `lictory` Vercel project**
   using `vercel deploy --target=preview` and the project's Preview settings.
   Nightlies never run database migrations or promote a deployment.
4. Reserve the immutable tag/manifest, publish a GitHub prerelease (never latest),
   and record deployment success. The complete workflow must succeed before
   production selection treats the release as eligible.

Each candidate has its own immutable Vercel URL in the Actions summary and
GitHub deployment journal. There is no shared nightly domain or separate project.
Main and maintenance candidates use the same Preview deployment behavior.
Publication retries reuse the matching journaled preview.

Nightly runs are serialized with retained queues. Failed quality gates, builds,
or publication cannot change production. A maintenance-only nightly remains
useful for testing but cannot become stable without a semantic version increment.

`package.json` in Git remains the development baseline. Build checkouts receive
the calculated version without commits to `main`. Next.js embeds that package
version in the account menu; nightly displays `X.Y.Z-nightly.*`, and production
displays the clean `X.Y.Z`. Release manifests record that same version and SHA.

## Release to Production

In GitHub **Actions → Release to Production → Run workflow**, select `main`.
Leave `nightly_tag` empty to select the newest eligible, successfully verified
nightly, or enter an exact tag such as `v1.5.0-nightly.20261008.142`.

Selection requires a published prerelease created by the release bot, a matching
immutable tag and manifest, a successful Nightly workflow for its exact SHA,
and a successful deployment journal entry for the configured nightly project.
The candidate's PR metadata and proposed version are recalculated against the
current stable baseline. A stale, downgraded, duplicate, or changed candidate is
rejected; it is never silently assigned a different version. If `main` has moved
ahead, the chosen older nightly remains the source.

The manual run records its chosen candidate in the GitHub `production-intent`
deployment journal. Rerunning all jobs keeps that intent, even after newer
nightlies appear. The temporary plan artifact is an execution copy, not the only
record of the decision.

The selected SHA passes the minimal CI workflow (types and migration checks)
again with the stable version.
Only the deploy job accesses the protected `production` environment and its
existing required approvals. Its release controller comes from the dispatch's
protected `main` commit; the application and migration code are checked out in a
separate directory at the nightly's exact SHA.

The deployment is deliberately a **new production-configured build**:
`vercel deploy --prod --skip-domain`, followed by source/version validation,
the existing locked transactional migration runner, and `vercel promote`.
The canonical `lictory.com` alias is read to determine what is actually active;
a staged production target is not treated as receiving traffic. Domain and
database channel checks happen before deployment. Only after gates pass is the
stable tag reserved; only after activation does its GitHub Release become
published and latest. The original nightly remains unchanged.

Nightly and Stable share a verified source commit, not byte-identical artifacts.
Their versions, authentication origins and environment settings differ.

## Hotfixes

Open a protected `release/<major>.<minor>` branch from the **current stable tag**,
and merge fix/performance PRs into it. Its automatic nightly excludes features
on `main`; feature PRs are excluded from maintenance candidates on the current
stable train. Compatible fixes become patches; an explicitly breaking urgent fix
retains its proper major bump (minor during `0.x`). Test its immutable URL, then select that exact nightly tag in
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
  retry the release. The active alias, deployment metadata and journal repair
  publication without rebuilding, remigrating or reactivating. An activated,
  unpublished version blocks a different production release until repaired.
- Optional production database recovery uses **Database migrations** on `main`,
  with the exact verified `nightly_tag`. It shares the production release lock
  and never activates an application. Staging recovery remains separate.
- Old production versions cannot be reactivated through this workflow. Release
  a reviewed revert as a new fix/breaking PR and promote its verified nightly.
  An emergency Vercel rollback is an administrator recovery procedure outside
  the normal release path and must reconcile the release journal before resuming.
- Database migrations are never automatically rolled back. Previous application
  code runs against the new schema between migration and activation, so every
  migration must remain backward compatible. See [migrations](migrations.md).

Previously published nightlies remain immutable after a stable promotion. Their
old baseline can make them ineligible; a new automatic nightly recalculates from
the new stable release. Publication retries preserve an already published
version's identity instead of creating a second version.

## One-time GitHub and Vercel configuration

Repository variables:

| Variable                    | Value                                                                        |
| --------------------------- | ---------------------------------------------------------------------------- |
| `RELEASE_BOOTSTRAP_SHA`     | Exact currently deployed legacy source commit; keep this fallback configured |
| `RELEASE_BOOTSTRAP_VERSION` | Its clean version, default `0.1.0`; ignored once a stable release exists     |
| `VERCEL_PROJECT_ID`         | Existing `lictory` project ID, also used to validate nightly journals        |
| `PRODUCTION_DATABASE_HOST`  | Production direct database hostname                                          |

Both release jobs use the existing GitHub environment **Production** with
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` and the existing `VERCEL_TOKEN`. The GitHub
environment name does not select the Vercel deployment target: nightlies still
use Preview, and only the manually dispatched stable workflow promotes production.
Nightly passes no production database secrets to its release process.

The same environment supplies these settings for stable releases:

| Setting                                         | Value                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| Secrets `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Production runtime pooled/direct PostgreSQL URLs with TLS        |
| Secret `DATABASE_MIGRATION_URL`                 | Production administrative direct PostgreSQL URL with TLS         |
| Variable `DATABASE_MIGRATION_EXPECTED_HOST`     | Production direct hostname                                       |
| Variable `RELEASE_BOOTSTRAP_DEPLOYMENT_ID`      | Exact legacy active production deployment for one-time migration |

Production explicitly passes its runtime database URLs to Vercel at build and
runtime. Pooler hostnames may use Neon's `-pooler` form; direct and administrative
hosts must match the declared production host. Secrets never enter manifests or logs.

Allow branches `main` and protected `release/*` in **Production**, with no tag
allowance or pull-request branch access. A shared environment applies the same
approval rules to both release jobs; required reviewers would also gate automatic
nightlies. Stable activation remains restricted in code to a manual dispatch from
`main`. Keep deployment credentials in this single environment.
`production-intent` and `nightly-intent` are journals, not credential environments.

Protect main and maintenance branches against direct/force pushes and deletion.
Require **Conventional PR title** and **Verify**, with the team's normal review
policy. Prefer squash merges and set the squash commit subject to **PR title**;
enable merge commits for released maintenance history. Protect `v*` tags against
creation by unauthorized users and against updates/deletion, allowing release
automation to create tags. Ensure repository rules permit the workflow's tag
creation without granting it a main-branch write bypass. Protect changes to
release workflows with maintainer review/CODEOWNERS.

Create the `release:direct-push` and `release:stable-api` labels. Add the required
title check to branch protections once its workflow has been installed on main;
the first installation PR uses the existing Verify/review requirements.
Pre-automation tags lack the new workflow files: legacy maintenance branches need
a reviewed import of release infrastructure and the version display before their
pushes can create nightlies. Import those changes without merging unrelated main
features. Future stable tags already contain that infrastructure.

Use the existing `lictory` Vercel project for production, PR previews and nightly
previews. `vercel.json` keeps main Git deployments disabled. Configure Next.js
with `bun run build` and the repository's pinned Bun version. No separate nightly
project, database, custom domain or DNS record is needed.

Configure the project's **Preview** environment with test database, authentication,
email, storage and integration settings. Preview database schema preparation is
outside the nightly workflow; use the staging migration runbook when needed.
Keep production credentials and data out of Preview settings and retain deployment
protection. Nightlies inherit these settings without overriding database URLs.

Keep Vercel system environment variables enabled. The workflow stamps
`LICTORY_RELEASE_CHANNEL=nightly`; authentication uses only that Preview deployment's
exact provider-declared `VERCEL_URL`, so each immutable URL works without wildcard
origins. Password authentication works for immutable candidates; social login can
use the [OAuth proxy](oauth-proxy.md) with a fixed callback server. Opted-in PR
previews also use their exact `VERCEL_URL`. Production keeps its canonical origin policy and
scheduled jobs.

Normal operation has no package bump, changelog edit, local deployment, or tag
push. Legacy stable releases remain valid baselines; their historical changelog
is retained in `CHANGELOG.md`. Release metadata and journals are not disposable
CI artifacts and must be retained for selection/recovery.

GitHub's `queue: max` preserves up to 100 pending runs; avoid exceeding that
platform limit and inspect canceled runs if it is reached. Actionlint 1.7.12
does not yet recognize this documented GitHub property: validate with its exact
`unexpected key "queue" for "concurrency" section` diagnostic suppressed, plus
the repository's YAML queue/permission/source guardrail tests. All other
actionlint diagnostics remain enabled. Real deployment credentials and DNS are
one-time operator configuration, not automatically provisioned by repository
tests.
