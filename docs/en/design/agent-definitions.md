# Agent Definitions Design

## Purpose

`agent definitions` describe how the project stores and exposes role-like agents across built-in assets, user-defined records, and scoped visibility rules.
The goal is to let **runtime execution and dashboard editing share one structured definition model**.

The core intent is:

- store role-like agents as structured definitions rather than opaque prompt blobs
- treat built-in and user-defined agents through one read model
- apply `global | team | personal` scope rules consistently
- allow runtime, dashboard, and workflow features to consume the same definition layer

## Source of Truth

Agent definitions come from two sources:

- built-in definitions
  - derived from system role-skill assets
- custom definitions
  - persisted in SQLite and owned by users or teams

At the top-level design, the important point is that their origins differ but their read model is shared.
Execution and UI layers should care more about the common `AgentDefinition` contract than the storage origin.

## Core Model

An agent definition typically includes:

- name and description
- icon
- role-skill reference
- `soul`
- `heart`
- allowed tools
- shared protocols
- additional skills
- `use_when`
- `not_use_for`
- extra instructions
- preferred providers
- model preference
- scope (`global | team | personal`)

This is not just prompt storage.
It is a structured role-and-boundary model.

## Built-In vs Custom

Built-in and custom definitions live in the same conceptual system, but mutation rules differ.

- built-in
  - system-provided
  - not directly editable or deletable
  - forkable into custom definitions
- custom
  - user- or team-owned
  - editable and deletable subject to scope rules

This distinction preserves the boundary between system assets and tenant-owned assets.

## Scope Model

Agent definitions follow the same 3-tier scope structure used elsewhere in the project:

- `global`
  - shared system-wide
- `team`
  - shared within one team
- `personal`
  - owned by one user

The model differs between read visibility and write authority.

### Read Visibility

Typical visible definitions are:

```text
visible definitions
  = global
  + current team
  + current personal
```

### Write Authority

Write authority is stricter:

- `global` belongs to admin-level control
- `team` requires team-management authority
- `personal` is writable only by the owner

So the design is not just about listing definitions.
It is about scope-aware visibility and mutation.

## Relation to Role / Protocol Architecture

`agent definitions` is closely related to `role-protocol-architecture`, but it solves a different problem.

- role / protocol architecture
  - explains how role assets and shared protocols are interpreted and compiled
- agent definitions
  - explains how role-like definitions are stored, exposed, and scoped

So role/protocol is the interpretation layer, while agent definitions is the storage and exposure layer.

## Relation to Dashboard

The dashboard should be able to list, create, update, and fork agent definitions.

At the design level:

- the dashboard is not the source of truth
- it is an editing surface over the scoped definition store
- structured fields are preferred over raw prompt-blob editing

So dashboard editing is a presentation layer over the definition model, not the definition model itself.

## Relation to Runtime

Agent definitions are not only gallery assets.
They should be connectable to runtime behavior.

Examples:

- selecting a role-like agent for a workflow node
- mapping an alias to a role-skill baseline
- feeding role-like structure into prompt-profile compilation

That is why the definition store matters to execution, not just UI.

## Fork Model

Forking creates a new custom definition from an existing built-in or custom definition.

This matters because it:

- protects system-provided definitions from in-place mutation
- lets teams and users create safe variants
- preserves role shape and scope intent while creating a tenant-owned copy

Forking is therefore not just a convenience action.
It is part of the boundary between system assets and tenant assets.

## Boundaries

This design does not:

- redefine full role-skill parsing rules
- describe prompt compiler internals in detail
- lock down dashboard layout specifics
- record phase, audit, or completion status

`agent definitions` documents storage, exposure, and scope boundaries for role-like agents.

## Meaning in This Project

This project combines built-in role skills, workflow role selection, dashboard editing, and tenant scope rules.
That makes a file-only definition model insufficient.

This document fixes the adopted top-level design:

- built-in and custom agents share one definition model
- definitions have explicit scope
- dashboard surfaces can edit them
- runtime execution can bind to them

## Non-Goals

- storing current audit state
- tracking UI completion status
- managing rollout order or migration steps here
- copying `improved` work-breakdown details into this document

This document describes the adopted agent-definition design.
Detailed rollout and work breakdown belong in `docs/*/design/improved/*`.
