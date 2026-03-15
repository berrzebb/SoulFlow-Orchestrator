# Multi-Tenant Design

## Purpose

The `multi-tenant` design defines how the project separates teams and users safely inside a single process while still allowing selected resources to be shared within a team context.
The goal is not simply “support many users,” but to create a runtime model where **team context and personal workspace isolation coexist**.

The main intent is:

- authenticate at the user level, but apply policy and shared resources at the team level
- keep personal runtime data isolated per user workspace
- allow team-shared assets to live in an explicit team scope
- make requests, sessions, channels, SSE, and storage paths agree on the same tenant identity

## Tenant Model

The project adopts the following model:

- `tenant = team`
- `user = a person with membership in a team`
- `workspace = a personal execution space inside that team context`
- `resource scope = global | team | personal`

This model allows the system to describe global administration, team administration, and personal execution without collapsing them into one layer.

## Directory Model

The multi-tenant layout extends the existing workspace-root bootstrap model instead of replacing it.

```text
$WORKSPACE/
├── admin/
│   ├── admin.db
│   └── security/
└── tenants/
    ├── <team_id>/
    │   ├── team.db
    │   ├── runtime/
    │   ├── shared/
    │   └── users/
    │       └── <user_id>/
    │           ├── runtime/
    │           ├── workflows/
    │           ├── templates/
    │           ├── skills/
    │           └── references/
    └── <another_team_id>/
```

Meaning:

- `admin/`
  - global accounts, global settings, global providers
- `tenants/<team_id>/team.db`
  - team metadata, memberships, team policy, team-scoped resource metadata
- `tenants/<team_id>/runtime`
  - team-shared runtime assets
- `tenants/<team_id>/users/<user_id>`
  - personal workspace root for one user

The important point is that runtimes are still rooted in filesystem paths.
Multi-tenancy extends that model by structuring the root as team and user layers.

## Authentication and Request Context

Authentication remains user-based, but request context must include both team and user identity.

A request-level tenant context should minimally carry:

- `user_id`
- `team_id`
- `workspace_path`
- runtime path layers

This context is shared by:

- route context
- workspace resolution
- provider and definition scope filters
- session keying
- channel ownership rules
- SSE broadcast scoping

So multi-tenancy is not just about putting `tid` into a JWT.
It is about making the entire request path operate on the same tenant identity.

## Workspace Runtime Model

Runtime identity must be richer than a single workspace path.

The core model is:

```ts
type WorkspaceKey = {
  team_id: string;
  user_id: string;
  workspace_path: string;
};

type WorkspaceRuntime = {
  team_id: string;
  user_id: string;
  workspace_path: string;
  admin_runtime: string;
  team_runtime: string;
  user_runtime: string;
};
```

This means:

- a runtime is not identified by filesystem path alone
- team and user boundaries must both be present
- routes, sessions, channels, and dashboard state should all resolve through the same runtime identity

Detailed runtime rebinding and lifecycle work belongs in `improved`, but this runtime identity model is the current top-level design reference.

## Resource Scope Model

Not every resource should live at the same scope.
The system uses three explicit scopes:

- `global`
  - shared across the whole installation
- `team`
  - shared within one team
- `personal`
  - owned by one user only

This model applies across:

- providers
- agent definitions
- templates
- workflow presets
- memory
- references
- parts of dashboard state

The important design rule is not whether storage is physically unified or split.
It is that read and write scope resolution must follow the same rules everywhere.

## Provider and Definition Resolution

Providers and definitions are not just global lists.
Visibility depends on the caller context.

The baseline visibility model is:

```text
visible resources
  = global
  + current team
  + current personal scope
```

Write permissions are stricter:

- `global` is admin-only
- `team` requires team management authority
- `personal` is writable only by the owner

This design intentionally separates “what you can see” from “what you can mutate.”

## Sessions and Channels

Session keys and channel storage must preserve team and user separation.

The design uses these rules:

- chat session keys include both team and user identity
- channel instance stores live under the team runtime
- ownership and write guards are checked against team context
- SSE registration and broadcast must also respect team scope

Sessions and channels are therefore not just UI concerns.
They are part of how tenant boundaries are enforced in practice.

## Memory and Personal Assets

Memory, references, skill uploads, and similar personal assets belong under user-specific runtime or user-content paths.

The intent is:

- personal conversation state is not shared across users
- switching teams changes the personal asset root as well
- team-scoped and personal assets should not be mixed under the same root

This matters for higher-level policies such as session reuse and tool budgeting.
If the wrong memory scope is reused, tenant boundaries break.

## Administrators and Team Managers

The design also defines an authority hierarchy:

- `superadmin`
  - manages global settings, global providers, and all teams
- `team owner/manager`
  - manages members and team-scoped resources in one team
- `member/viewer`
  - primarily uses personal resources

This is not just a label.
It affects:

- which scope a caller may write to
- which team they may switch into
- which APIs are allowed
- which dashboard surfaces are visible

## Boundaries

This design does not define:

- workflow phase control
- observability or eval result storage
- network behavior of specific provider implementations
- feedback-loop agreement state

`multi-tenant` defines identity, authority, storage scope, and runtime context boundaries.
It is not a project-status document.

## Meaning in This Project

This project combines a local-first workspace model with dashboard, channels, and workflow execution.
In that environment, multi-tenancy means:

- team is the tenant boundary
- user is the actor inside that boundary
- workspace is the personal execution root
- request context, session identity, channel ownership, and storage scope must all agree

This document fixes that top-level design.
Detailed rollout steps, migration order, and remaining work belong in `docs/*/design/improved/*`.
