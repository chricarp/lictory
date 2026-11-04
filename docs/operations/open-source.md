# Open-source launch

This runbook separates committed preparation from owner decisions and GitHub
settings. It is not a certification that the repository is safe to publish.
Keep the repository private until every blocking gate below has evidence.
No repository settings, visibility, Git history or credentials are changed by
adding these files.

## Licensing

The owner selected **MIT**, with Christian Carpinelli named as copyright holder.
The root `LICENSE` contains the license text; first-party package manifests
use SPDX `MIT`. CONTRIBUTING.md adopts inbound-equals-outbound terms with no
CLA, copyright assignment or DCO requirement. Contributors retain copyright.

Christian Carpinelli confirmed that the original code and artwork were created
by him with no third-party ownership exceptions. The bundled third-party source,
fonts and icons are inventoried in [third-party notices](../../THIRD_PARTY_NOTICES.md).
Preserved notices accompany those materials. Dependency artifact review remains
separate: the installed package report flags missing notice files and does not
establish license compatibility or binary-distribution compliance.

| Option     | What recipients may do                                                                                                           | Commercial implication                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| MIT        | Use, modify and redistribute, including proprietary products, retaining the required notice                                      | Very simple adoption; no explicit patent grant in the text                            |
| Apache-2.0 | Use, modify and redistribute, including proprietary products, with notice obligations and an explicit patent grant               | Alternative with an explicit patent grant; competitors can offer hosted forks         |
| AGPL-3.0   | Use commercially under copyleft; a modified network service must offer its corresponding source to remote users under section 13 | Encourages sharing service modifications; adds compliance considerations for adopters |

All three permit commercial activity. AGPL does not prohibit competing hosts or
require everyone merely using a service to publish unrelated code. A
noncommercial or no-competing-host clause would change the open-source promise.
Discuss compatibility and obligations for the actual distribution with counsel.
Do not append custom restrictions to a standard license and keep its name.

MIT permits commercial hosting and proprietary forks. Decide whether the
business is managed hosting/support around
an open product, or whether separate proprietary functionality is intended.
Recommendation: start with one coherent open product and paid hosting/support;
do not split the domain model or weaken self-hosted refinement to invent a paywall.
This is a recommendation, not a commercial commitment.

The owner must:

- Confirm the rights holder, employment/contractor assignments and any
  contributor permissions. AI assistance does not establish ownership.
- Inventory copied code, vendored agent skills, fonts, icons, illustrations,
  screenshots, fixtures, transitive dependencies and container contents. Record
  provenance, exact version, license and required notices. Bun audit reports
  vulnerabilities; it does not establish license compatibility.
- Keep the MIT license text, copyright notices and SPDX metadata consistent.
  Keep packages `private` until intentional package publishing is designed.
- Preserve third-party notices; add a third-party notice inventory based on the
  actual artifacts. Do not claim all dependencies use the project's license.
- The initial contribution policy is inbound-equals-outbound MIT without a
  mandatory DCO or CLA. Reassess it before changing the licensing strategy.
  A DCO certifies origin; it does not assign copyright or grant blanket future
  relicensing rights. If commercial dual licensing is intended, decide whether
  a reviewed CLA or assignments are needed before contributions arrive.
- Keep README and CONTRIBUTING aligned with the adopted policy. If DCO is
  introduced later, document `git commit -s`, the
  public identity record and recovery for missing sign-offs, and install the
  DCO check before requiring it. Never let an agent sign for another person.
- Decide and document name/logo usage separately. Trademark rights and hosted
  service terms are distinct from the software license; retain all rights
  already granted for third-party assets. The current web service legal notices
  are not a software license and are not a self-hoster's privacy policy.

Sources: [MIT](https://opensource.org/license/mit),
[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0),
[AGPL-3.0](https://opensource.org/license/agpl-3.0), and
[Developer Certificate of Origin](https://developercertificate.org/).

## Publication gates

The owner records completion evidence in the launch issue. None of these gates
is implied complete by the templates in this change.

- [x] Record the owner's original-code/artwork declaration and preserve verified
      notices for bundled source, agent skills, fonts and icons.
- [ ] Review the exact notices and obligations for distributed dependency binaries,
      Linux variants and container OS layers; see THIRD_PARTY_NOTICES.md.
- [ ] Scan **all history and refs to be published**, not just the working tree,
      with a current secret scanner (for example Gitleaks). Review findings privately;
      also inspect Git LFS objects, tags, release assets, Actions logs/artifacts,
      container images/layers and issue/PR attachments. Check internal hostnames,
      personal data and real customer fixtures. Keep scan output out of Git.
- [ ] Revoke/rotate exposed credentials first. Removing a file or rewriting
      history does not revoke a secret. If history needs rewriting, agree on scope
      and coordinate clones/forks before doing it; this runbook authorizes no rewrite.
- [x] Publish the owner-confirmed private conduct contact (`me@chricarp.com`)
      and enforcement owner in CODE_OF_CONDUCT.md.
- [x] Document the sole-maintainer reporting limitation; add an independent
      fallback when a trusted person is available.
- [ ] Enable GitHub private vulnerability reporting after publication and test it.
      Until available, keep the repository private or publish an owner-approved
      monitored private security contact. Do not route vulnerabilities to public issues.
- [x] Apply standard labels and protect `main` with PRs, required checks, current
      branch status, resolved conversations, and no force pushes/deletion.
- [ ] Complete publication-only settings and review artifact/log exposure below.
- [ ] Reproduce first checkout from a clean clone with no private packages,
      company credentials, personal files or optional paid integrations. Verify both
      delivery modes, core review without AI, migrations and backup restoration.
- [ ] Run the complete local verification sequence in the development runbook
      on the final tree. Record the exact commit, commands and results, including
      environment limitations; never use the application database for this gate.
- [ ] Publish a supported-release/security policy, deployable release artifacts
      and installation instructions that work for independent operators. Existing
      operator-specific deployment instructions need a clean-machine rehearsal;
      do not advertise one-click self-hosting until it has been demonstrated.
- [ ] Prepare synthetic demo content and an approved screenshot/short walkthrough
      for the README, with no customer content. Explain the review workflow first.
- [ ] Owner makes the visibility decision only after reviewing the evidence.

## GitHub configuration

These are administrator actions, not effects of merging YAML. Use
[repository settings](https://github.com/chricarp/lictory/settings) and record
what was actually enabled. No GitHub App installation is needed for issue forms,
CODEOWNERS, labels or the existing title check.

1. Enable Issues. Keep proposals as issues initially; add Discussions only when
   someone can moderate it. Set an accurate description, homepage and topics
   (requirements, collaboration, self-hosted). Set the license to MIT consistently in public project descriptions.
2. The standard labels have been applied through the API. For future updates, run **Repository labels**
   manually from Actions. It creates/updates `.github/labels.json` entries without
   deleting other labels. Review name/color/description changes before running;
   the token has issues write permission only in that job. The existing
   `release:stable-api` label has release semantics; it is not a triage marker.
3. Protect `main` and release branches with a ruleset: block deletion and force
   pushes, require a PR, resolved conversations, and the existing **Verify** and
   **Conventional PR title** checks. Select actual check runs in GitHub. Require
   CODEOWNERS approval once an independent reviewer is available. With a sole
   maintainer, self-approval is impossible: record a narrowly scoped, audited
   maintainer bypass rather than creating a rule nobody can satisfy. Dismiss
   stale approvals when new commits land. Keep bypass access minimal.
4. Prefer squash merges with the conventional PR title. Preserve the maintenance
   branch merge semantics in the release runbook. Automatically delete merged
   topic branches; do not automatically merge dependency or AI-generated changes.
5. Default Actions tokens to read-only and require approval for workflows from
   outside contributors. Run untrusted PRs only on GitHub-hosted disposable
   runners without secrets; do not attach public PRs to production/self-hosted
   runners. Keep third-party actions pinned to full SHAs (Dependabot updates them).
6. Keep the title workflow's `pull_request_target` metadata-only: never check out
   PR code, load its scripts or execute its title/body. Use `pull_request` for
   code checks. Do not grant PR jobs deployment credentials or repository write
   tokens. Review `workflow_run`, reusable workflows and artifacts for trust
   boundaries before adding automation.
7. Protect the `release` and `websites` environments with reviewers and allowed branches,
   and restrict the `websites` environment to `main`.
   Audit repository/environment secrets, SSH and Cloudflare permissions, registry
   ownership and release dispatch permissions. Forks must be able to test without
   Lictory infrastructure and must not automatically publish Lictory releases.
   Existing deployment workflows assume operator configuration: independently
   review their behavior before enabling Actions on a fork.
8. Enable dependency graph, Dependabot alerts/security updates, secret scanning
   and push protection where available; confirm scope/plan support. Dependabot
   configuration alone does not enable every security feature. Security
   scanning workflows are already in the repository (see "Security scanning"
   below). Minimal CI checks only types and migrations; local evidence remains
   required.
   Revisit hosted domain/browser checks as external contribution volume grows.
9. Enable private vulnerability reporting, verify who receives notifications,
   and give a backup maintainer access. Align `.github/SECURITY.md` with the
   releases actually maintained. Do not promise remediation deadlines or a bounty.
10. Before container/package distribution, inventory shipped licenses and plan
    SBOM/provenance generation tied to the exact artifact digest. Keep production
    promotion human-controlled. Do not describe unsigned artifacts as verified.

### Security scanning

| Workflow                                                           | Runs on                                           | Private repository |
| ------------------------------------------------------------------ | ------------------------------------------------- | ------------------ |
| `codeql.yml` (TypeScript and Actions, `security-extended`)         | PRs and pushes to `main`, except docs             | Skipped            |
| `dependency-review.yml` (fails on high/critical advisories)        | PRs that change dependencies, workflows or images | Skipped            |
| `scorecard.yml` (OpenSSF Scorecard, published)                     | Pushes to `main`, branch protection changes       | Skipped            |
| `workflow-lint.yml` (actionlint and zizmor)                        | Changes under `.github/`                          | Runs               |
| `gitleaks.yml` (commits a PR adds; full history when run manually) | PRs                                               | Runs               |

Code scanning and dependency review need GitHub Code Security on a private
repository, and Scorecard only publishes public repositories, so those jobs are
skipped (not failed) unless `github.event.repository.visibility` is `public`.
They activate by themselves when the repository becomes public; scheduled runs
are avoided because scheduled events carry no repository visibility. Public
repositories pay no Actions minutes for these jobs.

zizmor reads `.github/zizmor.yml`; justify every suppression there or inline.
Reviewed gitleaks false positives go in `.gitleaksignore` by fingerprint.
Dependabot refreshes the digests of base images pinned as
`image:tag@sha256:digest` in `Dockerfile` and the compose files. It may not
recognize the `${VAR:-image}` defaults in `deploy/compose*.yaml`; when merging
an image update, keep those equal to the matching images by hand.

References: [Actions security](https://docs.github.com/en/actions/reference/security/secure-use),
[private reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## Triage and review

Start new reports with `needs-triage`. A maintainer reproduces bugs, asks for
missing context with `needs-information`, links duplicates or records why a
request is declined. Apply `accepted` only after explicit scope agreement.
Use `good first issue` only for bounded work with reproduction, expected behavior
and verification guidance; security-sensitive invariants are poor starter tasks.
`help wanted` means implementation help is welcome, not that review is guaranteed.
Avoid automatic stale closure: old unresolved defects remain useful evidence.

Review in this order: agreed problem and scope; tenant isolation and human
review authority; data/history and migration safety; behavior in both delivery
modes; verification evidence; then maintainability. PR templates are prompts,
not enforceable proof. Do not let an AI review or passing type check replace a
maintainer's decision. See CONTRIBUTING.md for the actual required local checks.

For the first public month, reserve maintainer time for setup failures, question
triage, a few bounded contributor issues and a release rehearsal. Review the
volume and quality of reports before adding bots, project boards or new channels.
Keep core refinement usable without hosted AI, analytics or proprietary services.

## Inspiration

[T3 Code's contribution guide](https://github.com/pingdotgg/t3code/blob/main/CONTRIBUTING.md)
is useful for agreed scope and evidence; its
[MIT license](https://github.com/pingdotgg/t3code/blob/main/LICENSE) is one business
choice, not a requirement to copy. Lictory already follows much of this review
approach. [Ghostfolio](https://github.com/ghostfolio/ghostfolio#readme) provides
another useful example: it documents self-hosting alongside a paid managed
service and uses AGPL. These examples demonstrate possible structures, not proof
that a particular license or business model will succeed for Lictory.

## Remaining operator actions

The following describes the preparation checked on 28 October 2026. Recheck
settings immediately before publication; GitHub settings are not versioned here.
The project remains private, and no release or deployment was triggered.

Already applied: 14 standard labels (other labels preserved), vulnerability
alerts enabled, and `main` branch protection. Its required checks are `Verify`
and `Conventional PR title`, restricted to the GitHub Actions app. PRs must be
up to date, conversations resolved, and administrators are subject to the rules.
Required approval count is zero while there is only one maintainer. The default
workflow token was already read-only; Actions cannot approve PRs, and there are
no registered self-hosted runners. Production already restricts deployment to
`main` but has no required environment reviewer.

The nightly workflow in this change skips forks. Fork operators who want their
own release pipeline must adapt that repository guard and configure their own
infrastructure. Node 24 is now documented alongside Bun; a bare Bun-only clean
installation failed in Zero's native install, whereas the paired environment
uses the supported Node ABI.

Before changing visibility:

1. Review and merge the prepared source changes through a PR; this task does
   not publish a PR. Keep the full verification evidence with the reviewed SHA.
2. Review all historical releases and their descriptions for internal information.
   Existing release tags predate the new MIT notice: publish the first public
   source release from a commit containing LICENSE and the notices, and describe
   exactly which version you support. Do not imply that an old artifact contains
   the new notice files. Current Docker targets copy the project/bundled notices;
   dependency and OS-layer obligations still need release-specific review.
3. Inspect Actions logs and any issue/PR attachments for credentials, personal
   information and private hostnames. Git history and artifact scans do not cover
   those surfaces. Review container registry package visibility independently of
   repository visibility; do not make old images public without inspecting them.
4. In **Actions → Caches**, delete old caches immediately before making the
   repository public. The audit found 20 caches totaling about 8.7 GB. Treat this
   as a launch-time purge, since private CI can recreate caches before then.
5. In **Settings → General → Danger Zone → Change visibility**, choose Public
   only when the above review is complete. This is the owner's publication action.

Immediately after changing visibility:

1. Open **Settings → Actions → General → Approval for running fork pull request
   workflows** and select **Require approval for all outside collaborators**.
   The API rejected this setting while private with HTTP 422, so it cannot be
   preconfigured here. The current title workflow remains metadata-only.
2. Open **Settings → Code security** (or **Security & analysis**) and enable
   available secret scanning, push protection, Dependabot alerts and security
   updates. Confirm the dependency graph is populated. Public-repository features
   are not assumed enabled just because their configuration files exist.
3. Activate the security scanning workflows: keep CodeQL **default setup** off
   (the repository uses the advanced `codeql.yml` workflow; both cannot run),
   then run **CodeQL** and **Scorecard** once from Actions so alerts appear in
   the Security tab. Optionally require **Dependency review** and **Secret scan**
   on `main` once they have run green.
4. Enable **Private vulnerability reporting** there; verify notifications reach
   you. The endpoint returned 404 while private. SECURITY.md now provides
   `me@chricarp.com` as the private fallback, so reporters have a working channel.
5. Check the repository signed out: license detection, README, issue forms,
   private security reporting, and contribution links. Use synthetic content for
   the product walkthrough and announce the documented support level.

When adding a second maintainer, agree an independent conduct reporting contact
and update CODE_OF_CONDUCT.md, require one approval and CODEOWNERS review,
add a Production environment reviewer, and review release-branch protections.
No release branches currently exist. Until then, protect each new `release/*`
branch before accepting changes to it; do not weaken the documented maintenance
merge semantics just to enforce a linear-history rule.
