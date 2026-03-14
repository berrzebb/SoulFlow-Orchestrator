# Workflow Tool Design

## Purpose

`workflow tool` is the agent-facing tool contract used to create, inspect, modify, and execute structured workflow definitions.
Its purpose is to let agents participate in workflow authoring without turning workflow persistence into ad-hoc file writing.

In other words, this design exists so that an agent can work through a workflow contract instead of directly editing raw YAML as its primary source of truth.

## Role in the current architecture

Workflow tool sits between:

- model-side reasoning that decides what phases or nodes are needed
- dashboard-side workflow operations that store and run workflow definitions

The current responsibility split is:

- model or workflow writer
  - infers the graph or phase structure
- workflow tool
  - exposes structured actions for create/read/update/run operations
- dashboard workflow ops
  - owns template storage, retrieval, deletion, and run creation

So workflow tool is not the source of truth for workflow definitions.
It is the structured control surface used to reach that source of truth.

## Action-based contract

The current design uses one tool with an action parameter rather than many separate workflow tools.
That keeps workflow operations under one explicit contract.

The main actions are:

- `create`
- `list`
- `get`
- `run`
- `update`
- `delete`
- `export`
- `flowchart`
- `sequence`
- `node_types`
- `models`

The intent is not to maximize tool count.
It is to make workflow creation, mutation, inspection, and execution explicit under a single structured API.

## Relationship to node catalog and model discovery

Workflow tool is not only a storage wrapper.
It also exposes node catalog and backend/model discovery so the agent can understand the valid workflow surface before attempting creation.

This means:

- node types come from the registry-backed catalog
- workflow definitions are expected to align with that catalog
- backend/model selection is tied to actually available runtime options

So the tool acts as both a workflow control surface and a schema discovery surface.

## Storage boundary

Workflow tool does not own raw file persistence directly.
In the current architecture, storage and retrieval are delegated to `DashboardWorkflowOps`.

That boundary follows these rules:

- workflow tool calls ops
- ops own template storage and run creation
- agents should not treat arbitrary file writes as the primary workflow authoring path

This keeps dashboard UI, runtime, and agent tooling aligned to the same storage rules.

## Execution boundary

The `run` action supports both template-based execution and inline-definition execution.
In both cases, actual run creation still goes through the same workflow ops boundary.

So workflow tool does not directly execute the workflow engine itself.
It bridges from structured declaration into runtime execution creation.

## Meaning in the current project

This project combines dashboard workflow authoring with agent-driven automation.
Workflow tool is the layer that connects those two surfaces.

In the current architecture this means:

- users can ask for workflows in natural language
- agents turn those requests into structured workflow actions
- the same workflow definition can be used by storage, execution, and visualization
- diagram generation and node discovery are part of the same workflow surface

## Non-goals

- fully deterministic natural-language-to-graph generation by itself
- managing workflow YAML through arbitrary file writes as the main contract
- re-implementing the workflow execution engine inside the tool
- creating a storage path that bypasses dashboard workflow ops

This document describes the currently adopted workflow tool design concept.
Rollout details and work breakdown belong under `docs/*/design/improved/*`.
