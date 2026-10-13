# Official cloud operations

This directory holds deployment tooling for the official hosted service. It is
part of the current core's license, not a commercial feature exception.

`release/` calculates releases, verifies provenance and promotes Vercel builds
only after verification and migrations. Its fixed official domains are safety
checks for that service; community operators use the independent production
container and their own origin instead.

Application modules must never import this directory. Scripts and colocated
cloud tests may use it. This keeps community builds independent of official
hosting infrastructure. See the [distribution model](../../docs/internals/distribution.md)
and [release runbook](../../docs/operations/releases.md).
