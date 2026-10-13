# Community and cloud distribution

One application implements requirements refinement and both delivery modes.
All current features are in the open source core: collaboration, immutable
revisions, suggestions, approvals, readiness, native delivery, external delivery,
organization capabilities, AI assistance and provider integrations. No current
feature requires a license server, a cloud account or a per-seat entitlement.

## Deployment scope

The maintained community distribution is `compose.self-host.yaml`: a single
machine with one application instance, one PostgreSQL database and a background
worker. It provides neither failover nor horizontal scaling. Its operator owns
security, SMTP, storage, backups, restores, updates and availability. There is
no limit based on company size or number of users. Resource limits come from
hardware and workload, not licensing or artificial product checks.

High availability, autoscaling, fleet management, metering, billing and managed
backups are possible future cloud capabilities. They are not implemented or
promised here. Users retain the rights granted by the software license to
build their own deployment infrastructure. A single-node support scope is not
a contractual ban on scaling.

## Code boundary

Keep the application in its current domain modules. A package split is useful
when there are independently consumed or released packages; directory movement
alone does not justify a monorepo or a plugin framework.

`src/cloud/release` contains the official operator's release pipeline and
Vercel-specific promotion safeguards. It is open with the current core, but is
operational tooling, not a product dependency. Only scripts and its own tests
may import `src/cloud`. CI checks this direction. The runtime, migrations and
community deployment must keep working without cloud credentials.

Future commercial code must have an explicit license and a reviewed boundary
before it is added or distributed. A directory name does not create a license
exception. Do not assume AGPL code can be combined with proprietary modules
without addressing the applicable licensing obligations and contributor rights.
Prefer separately operated cloud services for infrastructure concerns. Do not
add entitlement checks to the current collaboration workflow.

## Configuration and data

Infrastructure is selected at deployment boundaries. PostgreSQL remains the
source of truth. Storage uses the existing `ObjectStorage` interface with R2
or configured S3; delivery and AI retain their adapters. SMTP supports hosts
other than the official cloud email provider. OAuth clients belong to each
operator. Analytics is disabled when its token is unset and has no upstream
reporting channel or default shared project.

Cloud and community use the same schema, authorization and revision semantics.
Do not fork migrations, tenant isolation, approval validity or readiness by
edition. Delivery mode remains a project choice, independent of hosting.

Hosted service contracts and provider declarations are not the software license.
Self-hosted legal pages default to an explicit operator draft. The official
operator can select its existing cloud text with `LICTORY_LEGAL_TEMPLATE=cloud`.
Other operators must supply notices for their actual processing. See
[legal notices](../operations/legal.md).
