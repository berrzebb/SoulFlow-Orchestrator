# Design: Agent Gallery & Definition System

> **Status**: Design complete, implementation in progress

## Overview

A system that allows users to define their own agents and explore/reuse them in a gallery. The structured frontmatter format of existing `src/skills/roles/*/SKILL.md` files is exposed directly as a UI form, enabling creation of agents with clear roles and boundaries — either manually or with AI assistance.

A new top-level route `/agents`, completely separate from `/workspace/agents` (runtime monitoring).

## Problem

Agent role/behavior rules currently exist only in `src/skills/roles/*/SKILL.md` files:
- Users must edit the file system directly to create custom agents
- No UI for extending or adapting existing role skills
- Agent role boundaries ("Do NOT use for...") are only implicitly defined
- No way to describe an agent in natural language and convert it to a structured definition

## Core Design Principle: Composed System Prompt

`AgentDefinition` is a **SKILL.md equivalent** stored in DB instead of files. The final system prompt is composed from layers — not a single text block:

```
[Shared Protocols]       ← Selected _shared/ documents (common rules)
        +
[Role SKILL.md body]     ← soul + heart + role responsibilities
        +
[Tool Skills body]       ← agent capability scope
        +
[use_when / not_use_for] ← explicit role boundary
        +
[extra_instructions]     ← custom additional instructions
```

AI generation also produces individual fields — not a raw text blob.

## Data Model

### AgentDefinition

```typescript
type AgentDefinition = {
  id: string;
  name: string;
  description: string;   // "Use when X." summary

  icon?: string;         // emoji

  // SKILL.md frontmatter fields
  role_skill: string | null;     // base role skill name (e.g., "role:pm")
  soul: string;                  // persona — character/personality
  heart: string;                 // persona — communication style
  tools: string[];               // allowed tool list
  shared_protocols: string[];    // _shared/ protocols to include
  skills: string[];              // additional tool-type skills

  // Boundary definition
  use_when: string;              // "Use when..." situations
  not_use_for: string;           // "Do NOT use for..." exclusions
  extra_instructions: string;    // additional custom instructions

  // Execution config
  preferred_providers: string[];
  model?: string;

  is_builtin: boolean;           // true = read-only system-provided
  use_count: number;             // usage count
  created_at: string;
  updated_at: string;
};
```

**Built-in agents** = content of `src/skills/roles/*/SKILL.md` seeded into DB.
When a user forks, an `is_builtin: false` custom definition is created.

### Common Rules (Shared Protocols)

Protocol documents in `src/skills/_shared/`:

| Protocol | Description |
|---------|-------------|
| `clarification-protocol` | Ambiguous request classification (LOW/MEDIUM/HIGH) |
| `phase-gates` | Task phase transition checklists |
| `error-escalation` | Error escalation rules |
| `session-metrics` | Session metrics collection criteria |
| `difficulty-guide` | Task difficulty assessment guide |

Same structure as the `shared_protocols` field in role skills.

## Architecture

```
Dashboard UI (/agents)
  Gallery view / card grid
  Create/edit modal (SKILL.md form structure)
  AI generation panel (natural language → structured fields)
         │
         └──── REST API ────────────────┐
                                        │
                          AgentDefinitionStore (SQLite)
                            agent_definitions table
                                        │
                          Builtin seed (role skills → DB)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent-definitions` | Full list (builtin + custom) |
| POST | `/api/agent-definitions` | Create new definition |
| PUT | `/api/agent-definitions/:id` | Update (custom only) |
| DELETE | `/api/agent-definitions/:id` | Delete (custom only) |
| POST | `/api/agent-definitions/generate` | Natural language → structured definition via AI (SSE) |
| POST | `/api/agent-definitions/:id/fork` | Fork builtin → create custom |

## UI Design

### Gallery Page (`/agents`)

```
┌─────────────────────────────────────────────────────┐
│  [🔍 Search agents...]          [+ New Agent]        │
│  [All] [concierge] [pm] [implementer] [reviewer]...  │
├─────────────────────────────────────────────────────┤
│  Built-in Agents                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ 🎩 Concierge │  │ 📋 PM        │  │ 🔧 Impl.  │ │
│  │ Front desk   │  │ Planning     │  │ Code impl │ │
│  │ [role:concierge] │  │ [role:pm]    │  │ [role:impl] │ │
│  │      [Fork]  │  │      [Fork]  │  │   [Fork]  │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
├─────────────────────────────────────────────────────┤
│  My Agents                                          │
│  ┌──────────────┐                                   │
│  │ 🔍 PR Review │                                   │
│  │ GitHub PR    │                                   │
│  │ [role:reviewer] │                                │
│  │ [Edit] [Del] │                                   │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

### Create/Edit Modal

SKILL.md frontmatter structure exposed directly as form fields:

```
┌─ Agent Configuration ────────────────────────────────┐
│  [Generate with AI] tab  │  [Write manually] tab      │
│                                                       │
│  ① Basic Info                                        │
│     Icon [🤖]   Name [________________]              │
│     Description (Use when...) [__________________]   │
│                                                       │
│  ② Role (Role Skill)                                 │
│     [role:pm ▼]  → soul/heart auto-populated         │
│     soul: [overridable text field]                   │
│     heart: [overridable text field]                  │
│                                                       │
│  ③ Common Rules (Shared Protocols)                   │
│     [✓] clarification-protocol                      │
│     [✓] phase-gates                                 │
│     [ ] error-escalation                            │
│     [ ] session-metrics / difficulty-guide          │
│                                                       │
│  ④ Allowed Tools                                     │
│     Add/remove from role defaults                    │
│     [read_file ✓] [write_file ✓] [exec ✓] ...       │
│                                                       │
│  ⑤ Additional Skills                                │
│     [+ Add skill]  github / cron / memory ...        │
│                                                       │
│  ⑥ Boundary                                         │
│     Use when: [__________________________________]   │
│     Do NOT use for: [____________________________]   │
│                                                       │
│  ⑦ Extra Instructions                               │
│     [optional text editor]                           │
│                                                       │
│                          [Cancel]  [Save]            │
└──────────────────────────────────────────────────────┘
```

### AI Generation Flow

```
User input: "An agent that automates GitHub PR reviews"
                    │
                    ▼
POST /api/agent-definitions/generate (SSE)
  LLM context:
    - Available role skills list
    - Available tools list
    - _shared/ protocol list
    - AgentDefinition field schema
                    │
                    ▼
  SSE streaming generates each field sequentially:
    role_skill: "role:reviewer"
    soul: "Guardian of code quality..."
    heart: "Cites specific code lines with improvement suggestions..."
    tools: ["read_file", "exec", "web_fetch"]
    shared_protocols: ["clarification-protocol", ...]
    use_when: "PR code review, quality inspection..."
    not_use_for: "Direct code modification — delegate to implementer"
                    │
                    ▼
  UI: Shows fields being filled in real-time
  User: Review, optionally modify, then [Save]
```

## File Structure

### Backend

```
src/agent/
  agent-definition.types.ts      # AgentDefinition types
  agent-definition.store.ts      # SQLite CRUD
  agent-definition-builtin.ts    # role skills → DB seed data

src/dashboard/ops/
  agent-definition.ts            # REST API handlers
```

### Frontend

```
web/src/pages/agents/
  index.tsx                      # Gallery main page
  agent-card.tsx                 # Individual card component
  agent-modal.tsx                # Create/edit modal
```

## Builtin vs Custom Policy

| Aspect | Builtin | Custom |
|--------|---------|--------|
| Source | `src/skills/roles/*/SKILL.md` seed | User-created |
| Edit | Not allowed | Allowed |
| Delete | Not allowed | Allowed |
| Fork | Allowed → creates custom | Allowed |
| `is_builtin` | `true` | `false` |

## Implementation References

- `src/agent/provider-store.ts` — SQLite store pattern reference
- `src/dashboard/ops/agent-provider.ts` — API handler pattern reference
- `src/skills/roles/pm/SKILL.md` — Builtin agent data source
- `src/skills/_shared/*.md` — Common rules protocol source
