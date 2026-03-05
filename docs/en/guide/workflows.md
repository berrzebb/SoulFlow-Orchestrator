# Workflows

Workflows orchestrate multiple AI agents across sequential phases — each phase runs agents in parallel, with optional critic review before advancing. This guide covers template authoring, execution modes, and the visual editor.

## Quick Start

1. Open the dashboard → **Workflows** page
2. Click **Templates** tab → **+ New** or **Import**
3. Define phases, agents, and critics
4. Click **Run** → monitor progress in real-time

Or place a YAML file in `workspace/workflows/` and it appears automatically.

## Concepts

### Phases

A workflow is a sequence of **phases**. Each phase contains one or more agents that run in parallel, followed by an optional critic review.

```
Phase 1: Research           Phase 2: Strategy
├─ [Market Analyst]  ←      ├─ [Strategist]
├─ [Tech Analyst]    ← parallel  └─ [Critic] ← gate
└─ [Critic]          ← gate
```

### Agents

Each agent within a phase has:
- **Role** and **label** — identity and display name
- **Backend** — which AI provider to use (e.g., `openrouter`, `claude_cli`)
- **System prompt** — instructions for the agent
- **Tools** — allowed tool names (e.g., `web_search`, `shell`)
- **Max turns** — conversation depth limit

### Critics

An optional quality gate after all agents complete. The critic reviews all agent outputs and either approves (→ next phase) or rejects (→ retry/escalate).

---

## Template Format (YAML)

Templates are stored in `workspace/workflows/` as YAML files.

### Minimal Template

```yaml
title: Market Research
objective: "Analyze the market for {{topic}}"

phases:
  - phase_id: research
    title: Data Collection
    agents:
      - agent_id: analyst
        role: Market Analyst
        label: "Market Analyst"
        backend: openrouter
        system_prompt: "Analyze market size, growth, and trends."
        tools: [web_search]
        max_turns: 5
```

### Full Template

```yaml
title: Market Research
objective: "Comprehensive market analysis for {{topic}}"
variables:
  topic: "AI infrastructure"

phases:
  - phase_id: research
    title: Data Collection
    mode: parallel                    # parallel | interactive | sequential_loop
    failure_policy: best_effort       # fail_fast | best_effort | quorum
    agents:
      - agent_id: market_analyst
        role: Market Analyst
        label: "Market Analyst"
        backend: openrouter
        model: gpt-4o
        system_prompt: "Analyze market size, growth rate, and trends."
        tools: [web_search]
        max_turns: 5

      - agent_id: tech_analyst
        role: Tech Analyst
        label: "Tech Analyst"
        backend: claude_cli
        system_prompt: "Analyze technology trends and competitive landscape."
        max_turns: 5

    critic:
      backend: openrouter
      system_prompt: "Review all analyses for logical consistency and data evidence."
      gate: true                      # false = feedback only, no blocking
      on_rejection: retry_targeted    # retry_all | retry_targeted | escalate | goto
      max_retries: 2

  - phase_id: strategy
    title: Strategy Synthesis
    depends_on: [research]            # waits for research phase
    context_template: |
      ## Previous Research
      {{#each prev_phase.agents}}
      ### {{this.label}}
      {{this.result}}
      {{/each}}
    agents:
      - agent_id: strategist
        role: Strategist
        label: "Strategist"
        backend: openrouter
        system_prompt: "Develop business strategy based on the research."
```

### Variables

Use `{{variable}}` syntax in `objective` and other string fields. Variables are substituted at runtime:

```yaml
objective: "Deep analysis of {{topic}} in {{region}}"
variables:
  topic: "EV batteries"
  region: "Southeast Asia"
```

### Context Template

Pass previous phase results into the next phase via `context_template`. Available variables:

| Variable | Description |
|----------|-------------|
| `prev_phase.agents` | Array of agents from the previous phase |
| `this.label` | Agent's display label |
| `this.result` | Agent's final output |
| `prev_phase.critic.review` | Critic's review text |

---

## Execution Modes

Each phase can run in one of three modes.

### Parallel (Default)

All agents run simultaneously. Results collected after all complete.

```yaml
- phase_id: research
  mode: parallel
  agents: [...]
```

### Interactive

A single agent converses with the user to co-create a spec or gather requirements. The agent uses markers to control the flow:

| Marker | Effect |
|--------|--------|
| `[ASK_USER]` | Pause and send a question to the user's channel |
| `[SPEC_COMPLETE]` | Terminate the phase, pass result forward |

```yaml
- phase_id: spec
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

### Sequential Loop

Same agent spawned repeatedly with fresh context per iteration. Results accumulate externally, preventing context rot.

| Marker | Effect |
|--------|--------|
| `[ASK_USER]` | Pause and ask the user a question |
| `[DONE]` | Terminate the loop |

```yaml
- phase_id: implement
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

---

## Phase Branching

### Dependencies (Fork-Join)

Phases can declare dependencies with `depends_on`. Phases with the same dependencies run in parallel; dependent phases wait for all prerequisites.

```yaml
- phase_id: code-review
  depends_on: [implement]
  agents: [...]

- phase_id: security-review
  depends_on: [implement]       # runs parallel to code-review
  agents: [...]

- phase_id: fix
  depends_on: [code-review, security-review]   # waits for BOTH
  agents: [...]
```

### Goto (Critic Rollback)

When a critic rejects and `on_rejection` is `goto`, the workflow jumps back to the specified phase:

```yaml
- phase_id: validate
  critic:
    system_prompt: "Verify all tests pass."
    gate: true
    on_rejection: goto
    goto_phase: fix             # jump back to fix phase
    max_retries: 3              # max goto loops before escalating
```

This enables iterative refinement loops:

```
implement → review → validate ──PASS──→ done
                       │
                      FAIL
                       ↓
                      fix → review → validate (re-verify)
```

---

## Failure Policies

Configure per-phase behavior when some agents fail.

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `fail_fast` | Any failure → immediate phase failure | All agent results mandatory |
| `best_effort` | Continue with available results (default) | Research/analysis |
| `quorum` | Proceed if ≥ N agents succeed | Voting/consensus |

```yaml
- phase_id: research
  failure_policy: quorum
  quorum_count: 2               # at least 2 must succeed
```

## Critic Rejection Strategies

| Strategy | Behavior | Cost |
|----------|----------|------|
| `retry_all` | Re-run all agents with critic feedback injected | High |
| `retry_targeted` | Re-run only agents flagged by critic | Medium |
| `escalate` | Delegate to user — Continue / Retry / Abort (default) | None |
| `goto` | Jump to specified phase | Variable |

---

## HITL (Human-in-the-Loop)

Workflows can pause for user input in several scenarios:

1. **Interactive mode** — agent outputs `[ASK_USER]`
2. **Sequential loop** — agent outputs `[ASK_USER]`
3. **Critic escalation** — critic rejects with `on_rejection: escalate`

When paused, the workflow status becomes `waiting_user_input`. The user can respond via:
- **Dashboard** — Workflow detail page chat panel
- **Channel** — The originating Slack/Telegram/Discord channel

The workflow resumes automatically when a response is received.

---

## Graph Editor

The visual editor provides a node-edge canvas for designing workflows.

### Layout

- **Nodes** represent phases, arranged in topological layers based on `depends_on`
- **Solid edges** — sequential flow / `depends_on` dependencies
- **Dashed edges** — `goto` links (critic rollback jumps)
- **Mode badges** — each node shows its execution mode (∥ parallel, 🔄 interactive, 🔁 loop)

### Interactions

| Action | Effect |
|--------|--------|
| Click node | Open inline property panel (agents, critic, mode) |
| Drag node | Reposition on canvas |
| Add phase | New node appears in the graph |
| Set depends_on | Edge drawn between nodes |
| Set goto_phase | Dashed edge drawn |

### Builder Tabs

The template editor provides three synchronized views:

| Tab | Description |
|-----|-------------|
| **Graph** | Visual node-edge editor |
| **Form** | Structured form with dropdowns and inputs |
| **YAML** | Raw YAML editor with syntax highlighting |

Changes in any tab sync to the others in real-time.

---

## Template Management

### Dashboard

- **Templates tab** — list, create, edit, delete templates
- **Import** — paste YAML or upload a file
- **Run** — execute directly from the builder

### API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workflow-templates` | GET | List all templates |
| `/api/workflow-templates/:name` | GET | Get single template |
| `/api/workflow-templates/:name` | PUT | Create/update template |
| `/api/workflow-templates/:name` | DELETE | Delete template |
| `/api/workflow-templates/import` | POST | Import from YAML text |
| `/api/workflow-templates/:name/export` | GET | Export as YAML |

### Workflow Execution API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workflows` | GET | List running/completed workflows |
| `/api/workflows` | POST | Create and run workflow |
| `/api/workflows/:id` | GET | Get workflow state |
| `/api/workflows/:id` | DELETE | Cancel workflow |
| `/api/workflows/:id/resume` | POST | Resume paused workflow |
| `/api/workflows/:id/messages` | GET | Get agent conversation |
| `/api/workflows/:id/messages` | POST | Send message to agent |
| `/api/workflow-roles` | GET | List role presets |

---

## Example: Autonomous Dev Pipeline

A 6-phase workflow that mirrors the human development process:

```yaml
title: Autonomous Development Pipeline
objective: "{{objective}}"

phases:
  - phase_id: spec
    title: Spec Creation
    mode: interactive
    max_loop_iterations: 20
    agents:
      - agent_id: pm
        role: pm
        label: "PM"
        backend: claude_cli
        system_prompt: |
          Create an implementation spec through conversation.
          Use [ASK_USER] to ask clarifying questions.
          Output [SPEC_COMPLETE] when finalized.

  - phase_id: plan
    title: Planning
    depends_on: [spec]
    agents:
      - agent_id: pl
        role: pl
        label: "Tech Lead"
        backend: claude_cli
        system_prompt: "Break the spec into numbered atomic tasks."
    critic:
      backend: openrouter
      system_prompt: "Check plan completeness."
      gate: true

  - phase_id: implement
    title: Implementation
    mode: sequential_loop
    max_loop_iterations: 50
    depends_on: [plan]
    agents:
      - agent_id: implementer
        role: implementer
        label: "Implementer"
        backend: claude_cli
        system_prompt: |
          Execute the next task. Use [ASK_USER] if blocked.
          Output [DONE] when all tasks complete.
        tools: [shell, file_request]

  - phase_id: review
    title: Code Review
    depends_on: [implement]
    agents:
      - agent_id: reviewer
        role: reviewer
        label: "Reviewer"
        backend: openrouter
        system_prompt: "Review all changes for correctness and security."

  - phase_id: fix
    title: Fix Issues
    mode: sequential_loop
    depends_on: [review]
    agents:
      - agent_id: debugger
        role: debugger
        label: "Debugger"
        backend: claude_cli
        system_prompt: |
          Fix each review issue. Output [DONE] if no issues.
        tools: [shell, file_request]

  - phase_id: validate
    title: Validation
    depends_on: [fix]
    agents:
      - agent_id: validator
        role: validator
        label: "Validator"
        backend: claude_cli
        system_prompt: "Build, test, type-check. Report results."
        tools: [shell]
    critic:
      backend: openrouter
      system_prompt: "Verify all tests pass."
      gate: true
      on_rejection: goto
      goto_phase: fix
      max_retries: 3
```

---

## State Persistence

Workflow state is persisted to SQLite (`workspace/runtime/workflows/phase-workflows.db`) after every phase transition. This enables:

- **Crash recovery** — resume from the last completed phase after restart
- **HITL pauses** — workflow survives server restarts while waiting for user input
- **Audit trail** — full agent conversation history retained per workflow

---

## Related Docs

→ [Dashboard](./dashboard.md)
→ [Agents](../core-concepts/agents.md)
→ [Security](../core-concepts/security.md)
→ [Provider Configuration](./providers.md)
