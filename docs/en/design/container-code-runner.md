# Container Code Runner Design

## Purpose

`container code runner` is the design that allows the code node to execute non-JavaScript and non-shell languages inside a constrained container runtime.
Its purpose is to support multi-language workflow execution while keeping resource limits, filesystem boundaries, and network policy explicit.

The current project uses this design to satisfy the following needs:

- run Python, Go, Rust, and similar languages from workflows
- avoid hard-coupling those runtimes to the local host environment
- keep code execution inside a constrained and mostly read-only sandbox
- preserve one code node abstraction while offering multiple execution paths

## Current execution model

The current code node has three execution paths:

- JavaScript
  - in-process `vm` sandbox
- shell
  - local shell runtime
- container language
  - podman/docker-backed container code runner

So container code runner is not a separate workflow node type.
It is the third execution path of the `code` node.
That lets workflow authors keep one node abstraction while changing language and isolation level.

## Runtime mapping

Container code runner does not treat a language name as a raw shell command.
It maps each supported language to:

- a default image
- a temporary file extension
- an in-container execution command

This means language support is managed as code-level runtime policy rather than as prompt convention or free-form command text.

## Isolation boundary

The current design uses the following default boundaries:

- read-only mounted code directory
- read-only mounted workspace
- limited memory and CPU
- `tmpfs` for temporary writable space
- `--network=none` by default

The important point is that the container is not just a convenience layer.
It is part of the sandbox policy for multi-language code execution.
Network access and container persistence are explicit opt-in options on the code node.

## One-shot and persistent modes

The current design supports two execution modes:

- one-shot
  - `run --rm` style execution
- persistent
  - named container reuse followed by `exec`

One-shot is the default path because it favors isolation and simplicity.
Persistent mode exists as a performance optimization for repeated execution under the same runtime.

So `keep_container` is not the baseline contract.
It is an explicit optimization mode.

## Engine selection

The current system supports both podman and docker, but treats them through one “available container engine” contract.
Engine detection happens ahead of execution and can be cached, while the code node simply consumes the selected engine result.

This keeps workflow definitions from being tightly coupled to one engine’s CLI syntax.

## Meaning in the current project

This project is both a local-first orchestrator and a multi-language workflow system.
Container code runner is the design used to add safe language execution without exploding the number of workflow node types.

In the current architecture this means:

- multi-language execution stays inside the `code` node abstraction
- local shell execution and container sandbox execution remain distinct paths
- resource limits and network policy are explicit node options
- execution results are normalized into the shared output contract

## Non-goals

- forcing all code execution through containers
- becoming a full long-lived development environment by itself
- moving general container orchestration into the workflow code node
- making docker/podman CLI syntax the source of truth for workflow design

This document describes the currently adopted container code runner design concept.
Rollout details and future work belong under `docs/*/design/improved/*`.
