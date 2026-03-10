# Recommended Usage & Best Practices

This guide covers SoulFlow's core capabilities and recommended patterns for getting the most out of the orchestrator.

## Core Value Proposition

SoulFlow is not just a chatbot wrapper. It is a **multi-agent orchestration runtime** that enables:

1. **Parallel specialist collaboration** with quality gates
2. **Visual workflow automation** with 141 node types across 6 categories
3. **Sandboxed execution** in isolated containers
4. **Human-in-the-loop** workflows via chat channels
5. **Auto-recovery** with error classification and failover chains

---

## Execution Modes

The orchestrator classifier automatically selects the best execution mode for each request.

| Mode | Trigger | Behavior |
|------|---------|----------|
| **once** | Simple question, single tool call | One-shot agent response |
| **agent** | Multi-step work, multiple tools | Agent Loop with tool cycle |
| **task** | Long-running, checkpoint-based | Task Loop with sequential steps |
| **phase** | Multi-specialist analysis, complex projects | Phase Loop with parallel agents + critic |

### Choosing the Right Mode

- **once**: "What time is it in Tokyo?" — no tools, instant answer
- **agent**: "Find the bug in auth.ts" — reads file, analyzes, responds
- **task**: "Refactor the entire API layer" — multi-step, tracks progress
- **phase**: "Full market research on AI chips" — needs multiple specialists working simultaneously

The classifier handles this automatically. For explicit control, use the Workflows page or WorkflowTool.

---

## Multi-Agent Phase Loop

Phase Loop is SoulFlow's most powerful execution model. It runs **parallel agents within a phase**, passes results through a **critic quality gate**, then proceeds to the next phase.

### When to Use Phase Loop

- Tasks requiring multiple perspectives (research, analysis, competitive review)
- Projects with distinct stages (spec → plan → implement → review → validate)
- Situations where quality gates matter (critic must approve before proceeding)

### Key Features

**Per-agent conversation**: Each agent in a phase has an independent chat session. Click the 💬 button on any agent card in the dashboard to ask follow-up questions or request corrections.

**Inter-agent communication**: Agents within the same phase can autonomously query each other via `ask_agent`. For example, a Market Analyst can ask the Tech Analyst for process technology data without orchestrator intervention.

**Critic quality gate**: After all agents complete, a critic reviews results. Options on rejection:
- `retry_all` — re-run all agents with feedback
- `retry_targeted` — re-run only flagged agents
- `escalate` — ask the user to decide (default, safest)
- `goto` — jump to a specific phase (e.g., fix loop)

**Failure policies**: Configure per-phase how to handle agent failures:
- `fail_fast` — any failure stops the phase
- `best_effort` — continue with available results (default)
- `quorum` — proceed if N or more agents succeed

### Example Workflow YAML

```yaml
title: "Market Research"
objective: "Comprehensive analysis for {{topic}}"

phases:
  - phase_id: research
    title: Data Collection
    agents:
      - role: Market Analyst
        backend: openrouter
        model: claude-sonnet-4-20250514
        system_prompt: "Analyze market size, growth rate, and trends."
        tools: [web_search]
      - role: Tech Analyst
        backend: openrouter
        model: claude-sonnet-4-20250514
        system_prompt: "Analyze tech stack, patents, and technology trends."
        tools: [web_search]
    critic:
      backend: claude_sdk
      system_prompt: "Review for logical consistency and missing data."
      gate: true

  - phase_id: strategy
    title: Strategy Synthesis
    context_template: |
      ## Previous Phase Results
      {{#each prev_phase.agents}}
      ### {{this.label}}
      {{this.result}}
      {{/each}}
    agents:
      - role: Strategist
        backend: claude_sdk
        system_prompt: "Synthesize findings into actionable strategy."
```

---

## Interactive & Sequential Loop Modes

Beyond parallel execution, Phase Loop supports two additional modes for phases.

### Interactive Mode

A single agent converses with the user to co-create a spec or gather requirements.

```yaml
- phase_id: spec
  title: Spec Creation
  mode: interactive
  max_loop_iterations: 20
  agents:
    - agent_id: spec-writer
      role: pm
      system_prompt: |
        Create an implementation spec through conversation.
        Use [ASK_USER] to ask clarifying questions.
        Output [SPEC_COMPLETE] when finalized.
```

The agent outputs `[ASK_USER] What framework do you prefer?` → the user responds in their chat channel → the workflow resumes with the answer.

### Sequential Loop Mode

The same agent spawns repeatedly with **fresh context** per iteration, preventing context window rot on long task lists.

```yaml
- phase_id: implement
  title: Task Execution
  mode: sequential_loop
  max_loop_iterations: 50
  agents:
    - agent_id: implementer
      role: implementer
      system_prompt: |
        Execute the next incomplete task from the plan.
        If blocked, use [ASK_USER] to ask the user.
        Output [DONE] when all tasks are complete.
      tools: [shell, file_request]
```

Each iteration receives accumulated results from previous iterations but starts with a clean context window.

---

## Visual Workflow DAG

The graph editor supports 141 node types across 6 categories (flow, data, AI, integration, interaction, advanced). Use it for deterministic automation pipelines that don't require LLM reasoning at every step.

### Recommended Node Combinations

**Data pipeline**: HTTP → Code (transform) → Template (format) → HTTP (webhook)

**Conditional routing**: HTTP → IF (status check) → LLM (on success) / Template (error notification)

**Approval workflow**: Form → Gate (approval) → LLM → Send-File

**Scheduled report**: Cron trigger → HTTP (data fetch) → LLM (analysis) → Template (report) → Notify (Slack)

### WorkflowTool — Agent-Driven Automation

Agents can create workflows during conversation without the dashboard:

```
User: Every day at 6 PM, check my GitHub PRs and send a Slack summary
Agent: I'll create a workflow for that.
→ WorkflowTool { action: "create", name: "daily-pr-summary", definition: { ... } }
→ "Created daily-pr-summary with cron trigger at 18:00."
```

Available actions: `create`, `list`, `get`, `run`, `update`, `delete`, `export`.

---

## Container Sandbox Execution

### Code Node Languages

The Code node supports 7 container-based languages beyond JavaScript/Shell:

| Language | Image | Use Case |
|----------|-------|----------|
| Python | `python:3.12-slim` | Data analysis, ML scripts |
| Ruby | `ruby:3.3-slim` | Text processing, scripting |
| Bash | `bash:5` | System automation |
| Go | `golang:1.22-alpine` | Performance-critical logic |
| Rust | `rust:1.77-slim` | Systems programming |
| Deno | `denoland/deno:2.0` | TypeScript with permissions |
| Bun | `oven/bun:1` | Fast TypeScript execution |

All containers run with `--network=none`, `--read-only`, `--memory=256m` by default. Enable `network_access: true` only when the code needs external connectivity.

### Container Agent Isolation

When using the `container_cli` backend, each agent runs in a dedicated Docker container with 7-layer security:

1. **Gateway** — classifier prevents unnecessary spawns
2. **AgentBus** — communication permission matrix
3. **Tool filtering** — only role-permitted tools exposed
4. **Filesystem** — volume mount scope only
5. **Network** — `network:none` by default
6. **Resources** — memory/CPU/PID limits
7. **Docker proxy** — API whitelist (containers-only)

---

## Auto-Recovery & Resilience

SoulFlow automatically handles failures without user intervention.

### Error Classification Pipeline

| Error Type | Recovery |
|-----------|----------|
| Context overflow | Compaction (3 attempts) → tool result truncation → give up |
| Auth error | Rotate to next auth profile → if exhausted, model failover |
| Rate limit | Exponential backoff |
| Container crash | Respawn container, retry |
| Model unavailable | FailoverError → outer orchestrator switches model |

### CircuitBreaker

Each provider has a CircuitBreaker that tracks health. On repeated failures, the backend automatically falls back:
- `claude_sdk` → `claude_cli`
- `codex_appserver` → `codex_cli`

### Auth Profile Rotation

Multiple API keys for the same provider are rotated on auth errors. The retry budget scales with the number of profiles (32–160 iterations).

---

## Backend Selection Guide

| Scenario | Recommended Backend |
|----------|-------------------|
| General-purpose, high quality | `claude_sdk` |
| Need code execution sandbox | `container_cli` |
| Cost-sensitive, many requests | `openai_compatible` (local Ollama) |
| Access 100+ models | `openrouter` |
| Codex-specific features | `codex_appserver` |
| Maximum isolation | `container_cli` (Docker sandbox) |

Configure fallback chains in Providers page. The orchestrator auto-switches on failure.

---

## Workflow Design Patterns

### Critic-Based Goto (Retry Loop)

```yaml
- phase_id: validate
  critic:
    system_prompt: "Verify all tests pass."
    gate: true
    on_rejection: goto
    goto_phase: "fix"
    max_retries: 3
```

If validation fails, the workflow jumps back to the fix phase, then re-validates. After 3 failed loops, it escalates to the user.

### Fork-Join (Parallel Branches)

```yaml
- phase_id: code-review
  depends_on: [implement]
  agents: [...]

- phase_id: security-review
  depends_on: [implement]
  agents: [...]

- phase_id: fix
  depends_on: [code-review, security-review]
  agents: [...]
```

`code-review` and `security-review` run in parallel. `fix` waits for both to complete.

### Dynamic Workflow Generation

When no template matches a request, the orchestrator can auto-generate a workflow:

1. Classifier returns `{ mode: "phase", workflow_id: undefined }`
2. No matching template found
3. Workflow planner LLM generates `PhaseDefinition[]`
4. Preview shown to user → execute only after approval

---

## Tips

- **Start simple**: Use `once` / `agent` mode for most tasks. Reserve Phase Loop for genuinely multi-perspective work.
- **Use critic gates**: Always set `gate: true` on critics for production workflows. Without it, critic feedback is logged but doesn't block progression.
- **Fresh context for long tasks**: Use `sequential_loop` mode when a task list exceeds 10 items. Context rot degrades quality significantly.
- **Workspace workflows**: Save reusable workflows as YAML in `workspace/workflows/`. They appear in WorkflowTool's `list` action and can be triggered by cron.
- **Monitor via dashboard**: The Workflows page shows real-time phase progress, per-agent results, and critic reviews. Use it to track long-running pipelines.

## Related Docs

→ [Workflows Guide](./workflows.md)
→ [Dashboard Guide](./dashboard.md)
→ [Provider Configuration](./providers.md)
→ [Installation & Setup](../getting-started/installation.md)
