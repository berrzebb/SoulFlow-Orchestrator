# Design: Node Registry — OCP-Based Node Architecture

> **Status**: Implementation complete · 47 node types registered + container sandbox code execution + interaction nodes

## Overview

Node Registry eliminates the Open-Closed Principle (OCP) violation where adding a new node type required modifying **8 files across 18+ locations**. Now: **1 descriptor file + 1 barrel registration line**.

## Problem

Before the refactoring, each of these locations needed manual updates per new node:

| Location | File | Type |
|----------|------|------|
| `ORCHE_COLORS` | graph-editor.tsx | Record |
| `ORCHE_ICONS` | graph-editor.tsx | Record |
| `ORCHE_TYPES` | graph-editor.tsx | Set |
| `AuxNode` switch | graph-editor.tsx | 12-case switch |
| `addOrcheNode` defaults | graph-editor.tsx | Record |
| Toolbar buttons | graph-editor.tsx | 12 × JSX |
| `OrcheNodeEditModal` | builder.tsx | 12 × if-block |
| `execute_orche_node` | orche-node-executor.ts | 12-case switch |
| `test_orche_node` | orche-node-executor.ts | 12-case switch |
| `NODE_OUTPUT_SCHEMAS` | workflow-node.types.ts | Record |
| Type unions (×3) | graph-editor / phase-loop.types | literal unions |

## Architecture

### Core Concept: Descriptor + Handler

```
┌──────────────────────────────────────────────────┐
│  Backend: NodeHandler                             │
│  node_type, icon, color, shape,                   │
│  output_schema, input_schema, create_default(),   │
│  execute(), test()                                │
├──────────────────────────────────────────────────┤
│  Frontend: FrontendNodeDescriptor                 │
│  node_type, icon, color, shape,                   │
│  toolbar_label, output_schema, input_schema,      │
│  create_default(), EditPanel component            │
└──────────────────────────────────────────────────┘
```

### Backend Layer (`src/agent/`)

```typescript
// node-registry.ts
interface NodeHandler {
  node_type: string;
  icon: string;
  color: string;
  shape: "rect" | "diamond";
  output_schema: OutputField[];
  input_schema: OutputField[];
  create_default: () => Record<string, unknown>;
  execute: (node, ctx) => Promise<OrcheNodeExecuteResult>;
  test: (node, ctx) => OrcheNodeTestResult;
}

function register_node(handler: NodeHandler): void;
function get_node_handler(type: string): NodeHandler | undefined;
function get_all_handlers(): NodeHandler[];
```

### Frontend Layer (`web/src/pages/workflows/`)

```typescript
// node-registry.ts
interface FrontendNodeDescriptor {
  node_type: string;
  icon: string;
  color: string;
  shape: "rect" | "diamond";
  toolbar_label: string;
  output_schema: OutputField[];
  input_schema: OutputField[];
  create_default: () => Record<string, unknown>;
  EditPanel: React.ComponentType<EditPanelProps>;
}

interface EditPanelProps {
  node: Record<string, unknown>;
  update: (partial: Record<string, unknown>) => void;
  t: (key: string) => string;
}
```

## Data-Driven Patterns

### Toolbar (auto-generated)

```tsx
{get_all_frontend_nodes().map((d) => (
  <button key={d.node_type} onClick={() => addOrcheNode(d.node_type)}
    style={{ color: d.color }}>
    {d.toolbar_label}
  </button>
))}
```

### AuxNode (shape-based dispatch)

```tsx
const desc = get_frontend_node(node.type);
if (desc?.shape === "rect") return <OrcheRectNode .../>;
// diamond: 4 specialized components (IF/Merge/Split/Switch)
```

### EditModal (single delegation)

```tsx
const desc = get_frontend_node(node.node_type);
{desc?.EditPanel && <desc.EditPanel node={node} update={update} t={t} />}
```

### Executor (registry lookup)

```typescript
const handler = get_node_handler(node.node_type);
return handler.execute(node, ctx);
```

## File Structure

```
src/agent/
  node-registry.ts           # NodeHandler + registry API
  nodes/
    index.ts                  # barrel registration (idempotent)
    http.ts, code.ts, if.ts, merge.ts, set.ts, split.ts,
    llm.ts, switch.ts, wait.ts, template.ts, oauth.ts, sub-workflow.ts,
    filter.ts, loop.ts, transform.ts, db.ts, file.ts,
    analyzer.ts, retriever.ts, ai-agent.ts, text-splitter.ts,
    task.ts, spawn-agent.ts, decision.ts, promise.ts,
    embedding.ts, vector-store.ts,
    notify.ts, aggregate.ts, send-file.ts, error-handler.ts, webhook.ts,
    hitl.ts, approval.ts, form.ts, tool-invoke.ts, gate.ts,
    escalation.ts, cache.ts, retry.ts, batch.ts, assert.ts,
    container-code-runner.ts   # Container sandbox runner (python, ruby, go, ...)

web/src/pages/workflows/
  node-registry.ts            # FrontendNodeDescriptor + registry API
  nodes/
    index.ts                  # barrel registration (idempotent)
    http.tsx, code.tsx, if.tsx, merge.tsx, set.tsx, split.tsx,
    llm.tsx, switch.tsx, wait.tsx, template.tsx, oauth.tsx, sub-workflow.tsx,
    filter.tsx, loop.tsx, transform.tsx, db.tsx, file.tsx,
    analyzer.tsx, retriever.tsx, ai-agent.tsx, text-splitter.tsx,
    task.tsx, spawn-agent.tsx, decision.tsx, promise.tsx,
    embedding.tsx, vector-store.tsx,
    notify.tsx, aggregate.tsx, send-file.tsx, error-handler.tsx, webhook.tsx,
    hitl.tsx, approval.tsx, form.tsx, tool-invoke.tsx, gate.tsx,
    escalation.tsx, cache.tsx, retry.tsx, batch.tsx, assert.tsx
```

## Type Safety

`OrcheNodeType` union is defined in two canonical locations:
- Backend: `src/agent/workflow-node.types.ts`
- Frontend: `web/src/pages/workflows/graph-editor.tsx`

All other files import from these sources. Adding a new node type requires updating the union in these 2 files + creating 2 descriptor files.

## Adding a New Node

1. Create `src/agent/nodes/my-node.ts` — implements `NodeHandler`
2. Add to `src/agent/nodes/index.ts` barrel
3. Create `web/src/pages/workflows/nodes/my-node.tsx` — implements `FrontendNodeDescriptor` with `EditPanel`
4. Add to `web/src/pages/workflows/nodes/index.ts` barrel
5. Add `"my_node"` to `OrcheNodeType` in both `workflow-node.types.ts` and `graph-editor.tsx`

## Affected Files

| File | Change |
|------|--------|
| `src/agent/node-registry.ts` | **New** |
| `src/agent/nodes/*.ts` (12) | **New** |
| `src/agent/nodes/index.ts` | **New** |
| `src/agent/orche-node-executor.ts` | switch → registry lookup |
| `src/agent/workflow-node.types.ts` | Deleted `NODE_OUTPUT_SCHEMAS` |
| `web/src/pages/workflows/node-registry.ts` | **New** |
| `web/src/pages/workflows/nodes/*.tsx` (12) | **New** |
| `web/src/pages/workflows/nodes/index.ts` | **New** |
| `web/src/pages/workflows/output-schema.ts` | Proxy-based registry lookup |
| `web/src/pages/workflows/graph-editor.tsx` | Deleted ORCHE_* constants, data-driven |
| `web/src/pages/workflows/builder.tsx` | 12 if-blocks → `desc.EditPanel` |
| `src/agent/phase-loop.types.ts` | Import `OrcheNodeType` |
