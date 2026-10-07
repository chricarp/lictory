# Versions and releases

Lictory uses [Semantic Versioning](https://semver.org/): `major.minor.patch`.
`package.json` owns the version. Next.js embeds it at build time, so the account
menu shows the version of the application the person is using. Rebuilding is
required after changing it; there is no runtime version override.

| Release | Example           | Meaning                                                            |
| ------- | ----------------- | ------------------------------------------------------------------ |
| Major   | `1.4.2` → `2.0.0` | Breaking changes to supported APIs, integrations or user workflows |
| Minor   | `1.4.2` → `1.5.0` | New features compatible with existing behavior                     |
| Patch   | `1.4.2` → `1.4.3` | Compatible bug fixes                                               |
| Hotfix  | `1.4.2` → `1.4.3` | An urgent patch, using the same numbering and verification         |

Versions starting with `0` describe initial development. Choose `major` when
ready to establish the first stable `1.0.0` contract. Release tooling currently
supports stable versions only. Feature branches use Vercel previews without
creating production releases.

## Prepare a release

Collect concise user-facing changes under `## [Unreleased]` in
[`CHANGELOG.md`](../../CHANGELOG.md). Summarize behavior and any upgrade action,
rather than listing implementation files. Maintainers choose the release kind;
commit messages do not automatically determine it.

```sh
bun run release:prepare minor --dry-run
bun run release:prepare minor
# Other choices: major, patch, hotfix
```

The command increments `package.json`, moves pending notes into a dated release
section, and leaves an empty `Unreleased` section for subsequent changes. It
refuses missing notes and duplicate release entries. It changes only those two
files; it does not commit, tag, push or deploy. Review and commit them together
with the release changes. The lockfile does not store the root package version
and needs no version edit.

Run the [complete verification sequence](development.md#full-verification-before-a-pull-request)
on the final release tree before pushing or requesting review. Merge the release
commit into `main`. Merges run CI but do not activate production.

## Publish a release

After fetching the merged commit, check it out and validate its version. For a
release prepared as `0.2.0`:

```sh
git fetch origin main --tags
git switch --detach origin/main
bun run release:check v0.2.0
git tag -a v0.2.0 -m "Lictory 0.2.0"
git push origin v0.2.0
```

Tag the exact release commit, not a newer commit that has accumulated unrelated
changes. Never move or reuse a published tag. Corrections need a new patch
version. The existing `0.1.0` package value is an untagged development baseline;
prepare the first release with notes before publishing it.

**Deploy production** accepts `v*` tags. It checks that the tag exactly matches
the stable package version, that dated release notes exist, and that the commit
belongs to `main` or a `release/*` maintenance branch. It then runs the full CI
workflow, builds without assigning production domains, applies migrations from
that same commit, and promotes that build. After activation, it creates a GitHub
Release using the reviewed changelog notes. Existing published notes are left
unchanged on retries. No npm package is published.

If validation, CI, build or migration fails, the new build is not promoted. If
publishing release notes fails after promotion, production is already updated;
retry the failed job. To rerun the entire release without modifying its tag:

```sh
gh workflow run deploy-production.yml --ref v0.2.0
```

Production deployments are serialized. GitHub retains only the newest pending
run in a concurrency group, so wait for the current release to finish before
publishing another tag. Dispatching an older tag deliberately redeploys that
version; database migrations are never rolled back. Check schema compatibility
before any application rollback.

## Hotfix while main contains unreleased work

Branch from the currently deployed tag, apply only the required fix, collect its
notes, and prepare a `hotfix` release:

```sh
git fetch origin --tags
git switch -c release/1.4 v1.4.2
# Apply the fix and add user-facing notes under Unreleased.
bun run release:prepare hotfix
```

Review and verify the fix on this branch, push the maintenance branch, and then
tag its verified release commit as `v1.4.3`. The branch must exist on the remote
before the tag is pushed. The workflow verifies and deploys that tagged commit,
so features accumulated on `main` are not pulled into the hotfix.

Bring the fix back to `main` afterward. Keep `main`'s upcoming version and
unreleased notes intact when resolving the package/changelog differences, and
retain the hotfix's published changelog entry. Do not cherry-pick the version
bump blindly. Each subsequent release needs a distinct, increasing version.

## GitHub setup

The `production` environment must allow the `v*` tags as well as `main` for
manual migration recovery. Keep its existing deployment secrets and approval
policy; see [migration setup](migrations.md#setup).

Protect `v*` tags against updates and deletion, and restrict their creation to
release maintainers. Protect `main` and `release/*` against unreviewed writes.
Tag creation authorizes a deployment of repository code with production
credentials, so release rights belong to trusted maintainers.

The release-notes job has `contents: write`; all earlier jobs keep read-only
repository permissions. Configure these environment and repository rules before
publishing the first production tag. Vercel's automatic Git deployment for
`main` stays disabled; branch previews remain available.
