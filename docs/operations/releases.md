# Versions and releases

Lictory releases through two channels: **Nightly** and **Stable**. A release
publishes; it deploys nothing. The project hosts no platform: every
installation upgrades itself from GitHub Releases with
[`lictory upgrade`](self-hosting.md). Maintainers merge reviewed PRs normally;
GitHub Actions calculates versions, writes release notes, creates tags and
publishes nightlies. The release decision is a release manager pressing
**Actions → Release → Run workflow** on `main`.

```text
Conventional PR title → merge → daily nightly: full verification, images, prerelease
                                                   ↓
                                 Release (one button, release managers)
                     ├─ platform changed?    → stable images + GitHub Release (release.env)
                     ├─ lictory.com changed? → deploy the marketing website
                     └─ docs changed?        → deploy docs.lictory.com
```

This follows the source-selection principle in
[T3 Code's release workflow](https://github.com/pingdotgg/t3code/blob/main/.github/workflows/release.yml)
and [release guide](https://github.com/pingdotgg/t3code/blob/main/docs/operations/release.md):
a stable release builds the commit a verified nightly shipped, not a moving
`main`.
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

Only platform changes count. A PR that changes nothing but the websites
(`apps/marketing`, `apps/docs`), maintainer documentation (`docs/`), CI
(`.github/`) or top-level Markdown neither bumps the platform version nor
appears in its release notes, whatever its title; a PR that also touches the
platform counts. The rule lives in `packages/core/src/release/paths.ts`.

Use human-readable titles. Optionally add a `## Release notes` section to a PR
body with a concise description of user behavior and upgrade actions. Notes are
grouped into Breaking changes, Added, Fixed, Performance and Maintenance, with PR
links and authors. Nightly notes compare to the preceding published nightly on
the same source branch when it is an ancestor; the first nightly falls back to
the stable baseline. Stable notes always include the complete stable range.

## Automatic Nightly

**Nightly** runs on a schedule, as in T3 Code: every day at 03:23 UTC it
builds `main` if the platform changed since the newest nightly, and publishes
nothing otherwise (website- or documentation-only days included). **Actions → Nightly → Run workflow** on `main` produces one
immediately, under the same rule. Protected `release/<major>.<minor>`
maintenance branches still release on every push, so a hotfix candidate is
ready without waiting. A run also follows every stable publication, so the
remaining `main` work gets a candidate based on the new stable baseline.
Ordinary PRs do not create release tags or GitHub Releases.

Pull requests get the [layered CI](development.md#test-tiers). Before a
nightly is published, the same CI workflow runs on its exact source with its
embedded version and **every** browser workflow (`suite: full`), in parallel
with the image builds. A candidate that fails any tier is never published, so
every nightly a tester installs, and every stable release promoted from one,
passed the complete suite.

1. Pin the triggering SHA and calculate a candidate from the stable baseline.
2. Form `X.Y.Z-nightly.YYYYMMDD.<run_number>` using the workflow's original UTC
   creation date and run number. Retries do not use today's date or a new run
   attempt number.
   The `nightly-intent` journal preserves the original candidate across whole-run
   retries, even if another stable release appears while it is being repaired.
3. Build the four backend images natively on `linux/amd64` and `linux/arm64`
   runners, join them into multi-platform images in the registry
   (`IMAGE_REGISTRY`), tagged with the version; the deployment journal records
   their digests. No release job holds a deployment credential.
4. Reserve the immutable tag/manifest and attach `release.env` (the exact
   image digests self-hosted installations pull; its `MARKETING_IMAGE` equals
   `API_IMAGE` on purpose: no marketing image is built since the website moved
   to Cloudflare, and installed `deploy.sh` versions still require the key, see
   [deployment](deployment.md)), publish a GitHub prerelease
   (never latest), and record success. The complete workflow must succeed before
   a stable release treats the nightly as eligible.
5. Run the [laptop trial](self-hosting.md#try-lictory-on-a-laptop) on the
   published candidate: `deploy/try.sh` of its source with its own images and
   compose file, then sign-in, realtime sync and email. This is the only check
   that runs the release images with the production compose file before a
   stable release. A failure leaves the prerelease installable for testing,
   but the run fails, so Release does not promote it.

Installations on the nightly channel (`LICTORY_CHANNEL=nightly`) pick it up
with `lictory upgrade`; that is how a nightly is tested before it is promoted.

Each candidate's image digests appear in the Actions summary and the
deployment journal. Publication retries reuse the journaled images instead of
rebuilding. Nightly runs are serialized with retained queues. A failed build or
publication changes nothing any installation can pull. A maintenance-only nightly remains useful
for testing but cannot become stable without a semantic version increment.

`package.json` in Git remains the development baseline. Build checkouts receive
the calculated version without commits to `main`; images embed it, and the
platform's account menu shows `X.Y.Z-nightly.*` on nightlies and the clean
`X.Y.Z` on stable releases; the marketing website shows the latest stable. Release manifests and image labels record
that same version and SHA.

## Nightly retention

Nightlies are candidates, not a history. **Prune nightlies**
(`.github/workflows/prune-nightlies.yml`) runs daily at 05:47 UTC and deletes
the GitHub Release of a nightly when both are true:

- it was published more than **14 days** ago (exactly 14 days is kept), and
- a **newer nightly exists**, by publication date.

The newest nightly is therefore never deleted, however old it is: if nothing
was published for weeks, the last nightly stays and the nightly channel
(`lictory upgrade`, `get.sh`), which installs the newest nightly by
publication date, always has one. Nightlies sharing that newest publication
time are kept with it.

A nightly is a published (not draft) prerelease whose tag has the shape
`vX.Y.Z-nightly.YYYYMMDD.N`, the same test `lictory upgrade` and `get.sh`
apply. Stable releases, drafts (including candidates being reserved) and any
other release are never touched. Only the GitHub Release is deleted: the Git
tag stays, so release-note compare links and `git checkout <tag>` keep
working, and the images stay in the registry. Installations keep running
whatever they installed; `lictory rollback` uses the release files on the
server, not GitHub.

A stable release reads its source nightly again when it publishes and when a
run is retried, so every nightly named by a `production-intent` record from
the last 30 days (how long a run can wait for approval or be re-run) is kept
too. In practice Release promotes the newest eligible nightly, which retention
keeps anyway; this matters when `nightly_tag` names an older one, such as a
hotfix nightly. Promote a hotfix nightly within 14 days, or while it is still
the newest nightly.

The run reads every page of the release listing and the release intents
before deleting anything; if either is incomplete or fails, nothing is
deleted. Deletions go oldest first and stop at the first failure; the summary
says what was deleted, what failed and what remains. Running it again
recomputes the selection. Runs share the nightly queue, so a prune never
overlaps a nightly being planned or published.

**Actions → Prune nightlies → Run workflow** previews by default (`dry_run`
checked): it lists what would be deleted and cannot write. Unchecking
`dry_run` applies the rule now, with the same selection as the schedule; only
a release manager may do that by hand, and the schedule needs no one.

A deleted nightly can no longer be installed by version
(`lictory upgrade <version>`) or selected as `nightly_tag`.

## Who can release

Nightlies are automatic. **Release** changes what every installation upgrades
to and what the public websites say, so only release managers can run it, or
redeploy a website on its own:

1. **`RELEASE_MANAGERS`** (repository variable, Settings → Secrets and
   variables → Actions → Variables): comma-separated GitHub logins. When it is
   unset, only the repository owner can release (an organization-owned
   repository must set it). The first job of Release, and the first step of
   each website deployment, checks the person who started (or re-ran) the run;
   anyone else's run fails with a clear message before anything is built or
   deployed. Only repository administrators can change the variable.
2. **Required reviewers** (Settings → Environments): on the **release**
   environment they approve publishing a stable release; on **websites**,
   deploying a website. Add yourself or a team; for a team, also add its
   members to `RELEASE_MANAGERS`. Leave "Prevent self-review" off if a single
   maintainer both starts and approves.
3. Both environments' deployment branches are limited to `main`, and `main` is
   protected, so a branch with an edited workflow cannot publish or reach the
   Cloudflare token.

The first stable release after this pipeline changed must promote a nightly
built after the change: Release verifies the candidate with the CI of its own
source.

## Release

In GitHub **Actions → Release → Run workflow**, select `main`. One press
decides three things independently and shows them in the run summary:

| Part               | Ships when                                                           | What happens                                                                                           |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Platform           | release-worthy platform PRs merged since the latest stable release   | The newest eligible nightly (or `nightly_tag`) is rebuilt as stable and published with its release.env |
| `lictory.com`      | its sources changed since its last deployment, or the platform ships | [Marketing deployment](websites.md) from `main`, showing the latest stable version                     |
| `docs.lictory.com` | its sources changed since its last deployment                        | [Documentation deployment](websites.md) from `main`                                                    |

Each website records the commit it deployed (the `marketing-site` and
`docs-site` deployment journals); the next Release compares `main` against
it. `redeploy_websites` deploys both regardless. A website deploys only after
the platform release succeeded or was not needed, so the docs never describe
a version that failed to publish. With nothing to ship, the run says so and
succeeds.

Platform selection requires a published prerelease created by the release bot,
a matching immutable tag and manifest, a successful Nightly workflow for its
exact SHA, and a successful image build journaled for the configured
registry. The candidate's PR metadata and proposed version are recalculated
against the current stable baseline. A stale, downgraded, duplicate, or
changed candidate is rejected; it is never silently assigned a different
version. If `main` has moved ahead, the chosen older nightly remains the
source. When the platform changed but no verified nightly carries the change
yet, the run fails and says so: wait for the nightly or run it.

The run records its chosen candidate in the `production-intent` deployment
journal. Rerunning all jobs keeps that intent, even after newer nightlies
appear. The selected SHA passes CI again (static checks, domain tests and the
smoke workflows) with the stable version; its nightly already passed every
browser workflow. The release controller comes from the dispatch's protected
`main` commit; the application code is checked out separately at the
nightly's exact SHA. Stable images are **rebuilt** from that commit with the
stable version, then the tag is reserved, release.env attached, and the
GitHub Release published as latest. The original nightly remains unchanged.

Nightly and Stable share a verified source commit, not byte-identical images:
their versions differ. Neither embeds a domain or analytics setting; each
server supplies them at runtime from its `.env` ([deployment](deployment.md)).

## Hotfixes

Open a protected `release/<major>.<minor>` branch from the **current stable
tag**, and merge fix/performance PRs into it. Its nightly runs on every push
and excludes features; feature PRs are excluded from maintenance candidates
on the current stable train. Compatible fixes become patches; an explicitly
breaking urgent fix retains its proper major bump (minor during `0.x`). Test
that nightly on a server of your own, then enter its exact tag as
`nightly_tag` in **Release**. No manual version, notes, or tag commands are
needed.

Merge the released maintenance branch back into `main` **with a merge
commit**, preserving the stable tag's ancestry. Do not squash or cherry-pick
this history integration. The next release excludes the already published fix
and includes the remaining main PRs exactly once. Main nightlies block until
the latest stable commit is an ancestor. Hotfix migrations must obey
expand/contract ([migrations](migrations.md)).

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
- A failed verification or build publishes nothing and consumes no version. If
  code needs to change, merge the fix and release a new verified nightly
  rather than letting a retry float to it.
- If publication fails after the images were built, retry the failed job: the
  journaled build is published without rebuilding.
- A failed website deployment leaves the platform release published; use
  **Re-run failed jobs**. To roll a website back, see [websites](websites.md).
- A published stable release is never withdrawn by automation. Ship a reviewed
  revert as a new fix and release its nightly. Each installation can return
  to its previous release with `lictory rollback` (images only; migrations
  stay applied, so every migration must remain backward compatible, see
  [migrations](migrations.md)).

Previously published nightlies remain immutable after a stable promotion.
Their old baseline can make them ineligible; a new nightly recalculates from
the new stable release. Their GitHub Releases expire under
[nightly retention](#nightly-retention); their tags stay.

## One-time GitHub configuration

Repository variables:

| Variable                    | Value                                                                           |
| --------------------------- | ------------------------------------------------------------------------------- |
| `RELEASE_MANAGERS`          | Comma-separated GitHub logins allowed to release (owner if unset)               |
| `RELEASE_BOOTSTRAP_SHA`     | Exact source commit of the last release before automation; keep it configured   |
| `RELEASE_BOOTSTRAP_VERSION` | Its clean version, default `0.1.0`; ignored once a stable release exists        |
| `IMAGE_REGISTRY`            | Registry namespace for images, for example `ghcr.io/<owner>`                    |
| `IMAGE_CACHE_REGISTRY`      | Optional BuildKit cache repository, for example `ghcr.io/<owner>/lictory-cache` |

Environments, both with deployment branch `main` only:

- **release**: holds nothing; add required reviewers to approve each stable
  publication. Packages and the GitHub Release are written with the
  workflow's `GITHUB_TOKEN` (`packages: write`, `contents: write`).
- **websites**: the Cloudflare token and the websites' public build variables
  ([websites](websites.md#github-configuration)).

Make the image packages public (GitHub → Packages → each `lictory-*` package →
Package settings → Change visibility) so installations can pull without a
registry login. No database, server or application secret is stored in
GitHub.
