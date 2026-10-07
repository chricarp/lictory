# Delegated configuration

Configuration authority follows organization → project → team. Organization
administrators associate teams with one or several projects. Project roles apply
to that project and each associated team; team roles apply to one team. Permissions
are additive across a person's active assignments and inherited project roles.
A shared team's configuration changes affect every associated project; association
is therefore an explicit administration decision, displayed in team settings.
Work item identifiers still belong to projects, and team moves require association
with the item's project. These scopes grant configuration capabilities, not private
visibility or workflow approval rights. Team membership continues to organize
people without granting permissions. Existing organization workflow roles remain
unchanged.

Organization administrators define root configuration roles and assign the first
local managers. Configuration permissions cover project settings and taxonomy,
team settings, workflows, enabled organization types, membership and iterations,
delivery mode, scoped integration credentials, and local access management.
Readiness enforcement, organization AI policy, the global type registry,
organization membership and organization credentials remain administrator-owned.

A local access manager may assign roles and create, rename, customize, archive or
restore roles in their scope. A local role must name a parent role the manager holds in that scope. Its proposed permissions must fit both the parent's current ceiling
and the manager's current effective permissions. A project role can bound a team
role within that project. A team role cannot bound roles in another team or a
project. Local roles cannot change their scope or parent after creation; this
keeps the ancestry acyclic and prevents moving authority across boundaries.

Effective local permissions are intersected with every active ancestor. Reducing
or archiving an ancestor immediately limits all descendants, even when their
stored definitions contain older permissions. Restoring it restores permissions
within the remaining ceilings. Revoking a person's assignment removes that
person's rights; other explicit assignments remain until revoked. An organization
administrator's change to a root role intentionally changes all current
assignments and bounded descendants.

Every server write recomputes authority from current organization membership and
assignments under the shared organization transaction lock. Directory refreshes
and normal sync invalidation keep controls current; a queued command with stale
permissions is still refused by the server. Configuration definitions and
assignments use the same atomic receipt path as other workspace commands.
`configuration_audit` retains actors, commands and previous definitions or
assignments, including revocations. Credential audit entries contain identifiers
and site metadata, never credentials. These records survive role archive and
restore.

## Project ownership migration

The additive migration records every project already identified by a team's work
or project defaults. Shared teams retain all projects, work, statuses, iterations,
reports and external links. Unused teams retain no associations until an
administrator configures them; onboarding's initial team is associated when the
first project is created. New teams require a project, and new projects receive
independent default teams. Administrators can add projects and remove associations
only after moving that project's work and changing its default team. Historical
work is retained. A team role bounded by a removed project's local role loses that
inherited ceiling until the association is restored; its definition and assignments
remain in history.

## Delivery credentials

A delivery connection is owned by the organization or one team. A delegated
integration manager may enter or replace credentials for their team, configure or
remove that team's target, and disconnect that team's connection. Project
integration authority inherits into associated teams. A delegate cannot replace an
organization token or use a team connection as another team's or the organization's
export target. Multiple teams can connect the same Jira site with independent
encrypted credentials. Existing organization connections and targets retain their
ownership and identifiers.

Credential entry stays browser-only and online-only, outside the durable command
queue and agent transcripts. Credentials are encrypted on the server and never
returned in the directory. Integration authority is checked before external
verification and again before committing, so revocation during the network call
cannot write configuration. Configuration rights do not grant permission to
publish work: the existing export capability, readiness and explicit publication
workflow still apply.
