# Role / Protocol Architecture Design

## Purpose

The `role / protocol architecture` treats system prompting as policy composition rather than raw string assembly.
Its purpose is to read role-specific behavior, shared protocol rules, and execution checklists from document assets, normalize them into a common structure, and let orchestration and workflow tooling consume the same baseline.

The design has four main intentions:

- keep role criteria in skill assets instead of hardcoded strings
- resolve shared protocols as real policy content, not just names
- compile role policy into a structured prompt profile before execution
- let runtime execution and workflow UI share the same role definition

## Source of Truth

The current source of truth for role policy is the role skill asset set.

- `src/skills/roles/*/SKILL.md`
- role-specific `resources/*`
- shared protocol assets

In this design, code does not invent role policy.
Code only reads, normalizes, and composes those documents.

## Core Model

### RolePolicyResolver

`RolePolicyResolver` turns role skill metadata into a normalized `RolePolicy`.

That policy includes fields such as:

- `role_id`
- `soul`
- `heart`
- `tools`
- `shared_protocols`
- `preferred_model`
- `use_when`
- `not_use_for`
- `execution_protocol`
- `checklist`
- `error_playbook`

Its rules are strict:

- it reads role assets
- it does not invent missing policy
- absent values stay null or empty

### ProtocolResolver

`ProtocolResolver` resolves `shared_protocols` names into actual protocol content.

That means a role can declare a reusable policy like `"approval-safety"` by name, and execution receives the actual protocol body as structured content.

This avoids repeating long guidance blocks across roles and allows multiple roles to share the same protocol asset.

### PromptProfileCompiler

`PromptProfileCompiler` combines `RolePolicy` with resolved protocol sections and produces a `PromptProfile`.

This is the step that turns role policy into an executable baseline prompt profile.

The resulting profile contains:

- role identity
- soul / heart
- shared protocol sections
- execution protocol
- checklist
- error playbook
- preferred model

The compiler does not own role assets directly.
It depends on resolvers and composes their outputs.

## Current Consumption Surfaces

### 1. Orchestration execution

`OrchestrationService` can map an alias or role id to a compiled `PromptProfile` and append that profile to the runtime-generated system prompt.

This means:

- the runtime context builder still creates the base system prompt
- the role / protocol layer appends the baseline policy
- if no role matches, the system falls back to a concierge baseline

Role policy therefore acts as part of execution baseline, not just as an optional hint.

### 2. Workflow tooling and dashboard

Dashboard workflow operations use the same compiler to expose role listings and rendered prompt previews.

This keeps the UI and runtime aligned.
Users see role description, heart, tools, shared protocols, and rendered prompt from the same source.

## Relationship to PersonaMessageRenderer

`role / protocol architecture` and `PersonaMessageRenderer` solve different problems.

- role / protocol
  - execution baseline, system prompt, behavioral rules
- persona renderer
  - expression layer for deterministic user-facing messages

They are related but not the same layer.
Role policy defines how the executor should behave. Persona rendering defines how deterministic messages should sound to the user.

In other words, the architecture separates:

- what the system should be guided to do
- how the system should sound when speaking to the user

## Boundaries in the Current Architecture

This design assumes the following boundaries:

- skill assets own role source material
- orchestration owns role/protocol resolution
- runtime context builder owns base prompt assembly
- persona renderer owns deterministic user-facing tone

Therefore the role / protocol layer does not:

- render user-facing status text directly
- decide skill routing or gateway routing
- store workflow execution state
- treat ad-hoc prompt strings as source of truth

## Meaning in the Current Project

This project combines local execution, workflow authoring, and dashboard operations.
That requires role definitions to stay coherent across runtime and UI.

This architecture adopts the following rules:

- role criteria live in document assets
- code structures them through resolvers and a compiler
- runtime and UI consume the same compiled profile
- raw prompt editing may still exist, but baseline policy comes from role profiles

## Non-goals

- current round status tracking
- audit verdicts or agreement history
- user preference memory design itself
- replacing deterministic persona renderer policy

This document describes the currently adopted design concept.
Migration details, work breakdown, and remaining implementation steps belong under `docs/*/design/improved/*`.
