# Design: WorkflowTool — Natural Language → Workflow CRUD + Execution Agent Tool

> **Status**: Implementation complete

## Overview

A single CRUD tool that allows agents to create, query, run, and delete workflows during conversation.
Natural language → DAG inference is the agent's (LLM) responsibility; WorkflowTool saves/executes structured definitions.

## Problem

27 orchestration nodes + graph editor were complete, but agents had no programmatic means to CRUD workflows. When a user said "crawl RSS every morning and summarize," the agent could only guide them to the dashboard UI.

## Architecture

### Single Tool + Action Parameter Pattern

Same pattern as `CronTool` and `DecisionTool`:

```
WorkflowTool
├── action: create | list | get | run | update | delete | export
├── name: workflow name/slug
├── definition: WorkflowDefinition (for create/update)
└── variables: runtime variable overrides (for run)
```

### Action Flow

| Action | Input | Behavior | Output |
|--------|-------|----------|--------|
| `create` | name + definition | Save YAML + auto-register cron | `{ ok, slug }` |
| `list` | - | List templates | `[{ title, slug, phases, orche_nodes, trigger }]` |
| `get` | name | Single lookup | WorkflowDefinition JSON |
| `run` | name or definition | Immediate async execution | `{ ok, workflow_id }` |
| `update` | name + definition | Overwrite + re-register cron | `{ ok, slug }` |
| `delete` | name | Delete file + unregister cron | `{ ok, name }` |
| `export` | name | Return YAML string | raw YAML |

### Dependency Injection

```typescript
// DashboardWorkflowOps interface (dashboard/service.ts)
// Implemented in ops-factory.ts, injected into WorkflowTool in main.ts
constructor(ops: DashboardWorkflowOps)
```

### Automatic Node Catalog Injection

`build_node_catalog()` traverses the NodeHandler registry to generate a text representation of all 27 nodes' I/O schemas. This is included in the tool description so agents know which node types are available.

```
## Available Workflow Node Types (27)
- http [🌐]: (url: string, method: string, ...) → (status: number, body: string, ...)
- code [💻]: (language: string, code: string) → (result: string, stdout: string, ...)
...
```

## Execution Flow

```
User: "Crawl RSS every morning at 9 and summarize"
    ↓
Agent (LLM): natural language → DAG inference
    ↓
Agent → workflow tool: { action: "create", name: "daily-rss", definition: { ... } }
    ↓
WorkflowTool.handle_create() → ops.save_template() → YAML save + cron registration
    ↓
Agent: "Created daily-rss workflow with a 9 AM cron schedule."
```

## File Structure

```
src/agent/tools/
  workflow.ts            # WorkflowTool class (7 action handlers)
  workflow-catalog.ts    # Node catalog text generation
  index.ts               # export + registration

src/dashboard/
  service.ts             # DashboardWorkflowOps interface
  ops-factory.ts         # create_workflow_ops() implementation

src/main.ts              # WorkflowTool registration (ops injection)
```

## Related Documents

→ [Node Registry](./node-registry.md) — Source for 27-node catalog
→ [Phase Loop](./phase-loop.md) — Workflow execution engine
