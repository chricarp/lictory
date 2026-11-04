# Security policy

Lictory is self-hosted software. Installations store sensitive organizational
knowledge: unreleased plans, architecture, security reviews and delivery
credentials. We take reports seriously.

## Supported versions

Security fixes go into the latest stable release line only. Fixes ship as a
new stable release (`vX.Y.Z` on
[GitHub Releases](https://github.com/chricarp/lictory/releases), images
`ghcr.io/chricarp/lictory-*`); older releases are not patched. Upgrade with
`lictory upgrade` to receive them.

| Version                          | Supported |
| -------------------------------- | --------- |
| Latest stable release (`vX.Y.Z`) | Yes       |
| Older stable releases            | No        |
| Nightly builds (`-nightly.*`)    | No        |

Nightly builds are for testing. A fix lands in them first, but they are not a
supported way to receive security fixes.

## Reporting a vulnerability

Report privately through GitHub's
[private vulnerability reporting](https://github.com/chricarp/lictory/security/advisories/new)
for this repository. Do not open a public issue, pull request or discussion.

Include what is affected, the version, how to reproduce it, and the impact you
observed. Cross-organization data access, authorization bypasses,
authentication flaws and exposure of delivery or AI credentials are the most
valuable reports. Never include real credentials or other people's data in a
report.

Test against your own installation, for example a local development setup or
a server you operate. Do not test against installations run by others without
their permission, and do not access, modify or retain data that is not yours.

The project operates no hosted Lictory service. Issues in the marketing
website (`lictory.com`) or the documentation (`docs.lictory.com`) can be
reported the same way.

We will acknowledge the report, keep you informed while we investigate and fix
it, and credit you when the fix ships unless you prefer otherwise. Please give
us a reasonable opportunity to remediate before any public disclosure.
