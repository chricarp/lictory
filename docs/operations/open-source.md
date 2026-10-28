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

**Blocking before publication:** confirm rights to the existing code and
complete third-party provenance and distribution review. Choosing MIT does not
establish those rights.

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

- [ ] Complete licensing and third-party provenance review above.
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
- [ ] Name an independent fallback for reports involving the enforcement owner.
- [ ] Configure private vulnerability reporting and test the reporting path.
      Until available, keep the repository private or publish an owner-approved
      monitored private security contact. Do not route vulnerabilities to public issues.
- [ ] Complete the GitHub settings below and inspect all privileged workflows.
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
2. After the labels manifest is on the default branch, run **Repository labels**
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
7. Protect Production/staging environments with reviewers and allowed branches.
   Audit repository/environment secrets, SSH and Cloudflare permissions, registry
   ownership and release dispatch permissions. Forks must be able to test without
   Lictory infrastructure and must not automatically publish Lictory releases.
   Existing deployment workflows assume operator configuration: independently
   review their behavior before enabling Actions on a fork.
8. Enable dependency graph, Dependabot alerts/security updates, secret scanning
   and push protection where available; confirm scope/plan support. Dependabot
   configuration alone does not enable every security feature. Consider CodeQL
   or another SAST tool after validating monorepo coverage and noise. Minimal CI
   currently checks only types and migrations; local evidence remains required.
   Revisit hosted domain/browser checks as external contribution volume grows.
9. Enable private vulnerability reporting, verify who receives notifications,
   and give a backup maintainer access. Align `.github/SECURITY.md` with the
   releases actually maintained. Do not promise remediation deadlines or a bounty.
10. Before container/package distribution, inventory shipped licenses and plan
    SBOM/provenance generation tied to the exact artifact digest. Keep production
    promotion human-controlled. Do not describe unsigned artifacts as verified.

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
