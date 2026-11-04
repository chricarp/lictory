# Organizations, projects and teams

Lictory has three nested scopes. Each owns a clearly separated part of the
configuration, so a setting has exactly one home.

```text
Organization   a company, or a very large department of one
└─ Project     a product area (Jira, Confluence…): identity, workflow,
   │           delivery and the people who work on it
   └─ Team     a vertical inside the product (Board, Auth…): a group of people
               and an optional label on work items
```

## What each scope owns

| Scope        | Owns                                                                                                                                                                                                                                                                                                          | Managed by                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Organization | Name and branding, membership and invitations, application roles, the work item type registry, Jira connections (credentials), whether Lictory Intelligence may run, organization-wide intelligence context, creating and archiving projects                                                                  | Organization administrators                              |
| Project      | Key and numbering, description, members and their project role, disciplines, teams, workflow statuses, enabled types, labels and milestones, iterations and their cadence, estimate scale, delivery mode, readiness policy, Jira hand-off target, review action policy, project and team intelligence context | Project administrators (and organization administrators) |
| Team         | Name, description, members                                                                                                                                                                                                                                                                                    | Project administrators                                   |

A team owns no configuration. Every item of a project follows the project's
workflow, readiness policy, estimate scale and iteration cadence, whichever
team (if any) works on it. Boards and backlogs can be narrowed to a team; that
is a view, not a different process.

Each team has its own backlog page: the open work it has taken on but not yet
planned (not in an iteration; for external projects, not yet handed off),
ranked by the team, and the project's work that no team has taken yet. Taking
an item sets its team; releasing it clears the team. A team's ranking moves
items between their neighbours in the team's list, so it also orders them
within the project; there is no second rank. Ranking, taking and planning use
the same `changeProperties` capability as everywhere else in the project:
team membership still grants nothing.

Work items belong to exactly one project and optionally one of that project's
teams. Foreign keys enforce that an item's team, status and iteration belong to
its project. Moving an item between teams never changes its key, status or
iteration; items do not move between projects.

## Organization identity

Organizations choose a unique, lowercase handle for their workspace URL (`<your Lictory host>/<handle>`). Every top-level
SPA path (sign-in, account, api, zero and so on) is reserved.
The handle is separate from the immutable organization ID and from person
handles. Organization administrators can change it in General settings;
membership, projects, work item identifiers and history keep the same IDs.
Changing a handle changes the URL for every member, and previously shared links
need the new handle. Existing generated handles remain unchanged until an
administrator chooses a replacement. Static app routes are reserved.

## Access: application roles, project roles and disciplines

Three concepts answer three different questions. They are never combined into
one setting.

**Application role** (organization membership): _can this person administer
the organization?_ `owner`/`admin` are organization administrators; everyone
else is a member. Administrators manage organization settings and every
project. An application role grants no work item capability by itself.

**Project role** (`project_member`): _can this person configure the project?_
`admin` manages the project's configuration listed above; `member` works in
it. Organization administrators decide who administers a project; project
administrators can add members and promote other project administrators.
Every organization member can read every project; private projects are not
implemented (see [synchronization](synchronization.md)).

**Discipline** (`discipline`, per project): _what kind of work does this
person do here, and what may they do to work items?_ Product, Engineering and
QA are seeded in every project. Each discipline carries five capabilities:

| Capability             | Allows                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Edit specifications    | Create spec-backed items, revise main, restore revisions, merge into main            |
| Change properties      | Status, priority, owner, parent, labels, milestones, iterations, ordering, archiving |
| Request reviews        | Request and cancel reviews                                                           |
| Can be asked to review | Be a review responsibility; members decide reviews assigned to the discipline        |
| Hand off               | Export ready work to the project's Jira project and link existing issues             |

A person's capabilities in a project are the union of their active disciplines
there; a discipline in one project grants nothing in another. Adding someone
to a discipline or team makes them a project member; removing them from the
project removes their disciplines and team memberships there. Discussion and
suggestions only need organization membership.

Reviews are requested from a discipline of the item's project; the discipline's
name becomes the review responsibility, so renaming or archiving it never
rewrites history.

Every check happens on the server inside the organization transaction, from
current memberships. The browser only hides controls.

## Delivery modes

Delivery mode is a project setting, so one system owns delivery for all of a
project's work.

**Native (Lictory)**: work is delivered in Lictory with the board, backlog and
sprints or automatic cycles. Readiness policy gates moving spec-backed work
into a started status (`off`, `warn`, `block`). Nothing is exported.

**External (Jira)**: Lictory refines, reviews and approves; Jira delivers.

- Iterations and estimates are owned by Jira: switching to external requires
  completing the active iteration and turns iterations and estimates off.
- The project chooses one Jira project on an organization connection and maps
  its work item types to Jira issue types.
- The **hand-off** view replaces the board: what is ready to hand off, what
  changed since it was handed off, what Jira reports back, and what needs
  attention (conflicts, failures, missing issues).
- Export rules are unchanged (explicit, evidence-gated, idempotent, see
  [delivery](delivery.md)), and only external projects can export.
- **Status sync back**: the worker's status sync (and an on-demand refresh) reads
  each linked issue's status, status category and assignee from Jira. It is
  read-only: it never writes Jira and never changes Lictory-owned fields or the
  item's Lictory status. Routine checks that find nothing new do not rewrite
  projections.

## Audit

`configuration_audit` records every configuration command with its actor and
the previous definition: project settings, members and roles, disciplines,
teams, workflow, types, labels and milestones, and integration changes
(identifiers only, never credentials). Records of the retired delegated
configuration roles are kept there.

## History of this model

Earlier versions attached workflow and delivery settings to teams that could be
shared by several projects, used organization-wide roles for work item
capabilities, and had custom delegated configuration roles. Migration `0010`
moved each project's settings and workflow from its main team, split shared
teams per project, turned organization roles into disciplines of every project
(keeping members), made every organization member a member of every project,
and promoted project-scoped configuration managers to project administrators.
