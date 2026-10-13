# Open source publication

The core uses **AGPL-3.0-only**. The complete, unmodified license is in
[`LICENSE`](../../LICENSE); package metadata uses its SPDX identifier. All
current product features and cloud release tooling are included; there are no
commercial feature exceptions. Organizations may self-host regardless of user
count or company size. The maintained deployment is single-node, as described
in [self-hosting](self-hosting.md).

The license preserves source-sharing obligations, including its network-use
provision for modified versions. It does not prohibit users from developing
HA or scaling infrastructure. See the [official AGPL text](https://www.gnu.org/licenses/agpl-3.0.html)
and [Open Source Definition](https://opensource.org/osd). PostHog's
[self-hosting distribution](https://posthog.com/docs/self-host) similarly describes
a single-machine deployment scope; this is distinct from license restrictions.

## Publication gates

Before changing repository visibility or publishing the first release:

1. Confirm the public repository owner/URL and copyright holders. Verify rights
   to license the existing source, prior contributions, generated artwork and
   documentation. Update `NOTICE`, README, CODEOWNERS and GitHub contact links;
   current `chricarp/lictory` links are provisional, not a settled legal identity.
2. Review third-party provenance: dependency licenses, bundled fonts, logos,
   illustrations, vendored `.agents/skills` (including their lock/source records)
   and dependency patches. Preserve notices and remove or replace material that
   cannot be distributed. `bun audit` is a vulnerability check, not a license audit.
3. Scan the **entire Git history**, branches, tags and release artifacts for
   secrets and confidential material before publication. Removing a file from
   the current tree does not remove it from history. Revoke exposed credentials
   before any coordinated history cleanup. Never publish customer test fixtures.
4. Enable GitHub private vulnerability reporting and supply monitored fallback
   security and conduct contacts. Test the reporting routes. Create the issue
   labels used by templates (`bug`, `enhancement`, `needs-triage`).
5. Protect `main` and release branches: require `Verify`, `Conventional PR title`
   and appropriate review; disallow force pushes. Keep cloud environment secrets
   restricted to trusted protected branches. Do not expose them to fork PRs.
6. Run the complete [verification sequence](development.md#full-verification-before-a-pull-request)
   and validate the production container and single-node install. Review upgrades
   and backup restoration with disposable data. Record current support limits.
7. Publish the exact corresponding source for each deployment at
   `LICTORY_SOURCE_URL`, including modifications and build instructions. A source
   archive must include committed migrations, lockfile, patches and required
   build inputs, without secrets. Confirm the `/source` offer is accessible.
8. Keep the official cloud operational settings separate: explicitly enable
   `LICTORY_CLOUD_ENABLED=true` only in the official deployment repository after
   configuring protected environments. Set `LICTORY_LEGAL_TEMPLATE=cloud` only
   for the operator whose notices describe that actual processing.

These are publication prerequisites, not claims that this change has scanned
private history, obtained contributor consent, launched cloud HA, or changed
repository visibility. The owner decides when to publish.

## Contributions and future commercial work

Contributors certify their right to submit under the project's license using
[the DCO](../../DCO). Copyright remains with contributors. DCO sign-off is not
copyright assignment and does not grant the maintainer unilateral proprietary
relicensing rights. Establish any different contribution agreement explicitly
before relying on it for dual licensing.

Future proprietary cloud services need their own reviewed licensing and
integration boundary. Do not place a new license header over contributed core
code and assume it overrides existing rights. The shared domain model,
migrations, authorization and current features remain in the core.
