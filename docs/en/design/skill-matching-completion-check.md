# Design: Skill Auto-Matching + Completion Check + Project Document Protocol

> **Status**: `planned` | **Type**: Feature Addition

## Overview

Three mechanisms to strengthen task quality and automation in multi-agent orchestration:

1. **SkillIndex** — Analyze user instructions → FTS5-based 4-dimensional skill auto-matching
2. **CompletionChecker** — Mid-task (self-check reminder) + post-task (user follow-up) check questions
3. **Project Document Protocol** — Kanban board as single source of truth; role chain manages plan/context notes/checklists

### Core Principles

- **Match by frontmatter only** — Reading full skills is wasteful. Match via frontmatter → inject only selected skill's body (facade)
- **Skill = Facade** — SKILL.md body is a situational reference routing table
- **3 reference types** — Shared (`_shared/`), skill-specific (`references/`), branching (routing tables)
- **Hybrid checks** — Skill-defined checklists (frontmatter) + dynamic supplement (tool usage pattern-based)

## Problem

### Skill Matching

`suggest_skills_for_text()` uses simple `String.includes()` keyword matching (name:6, alias:4, trigger:5, summary:1). Cannot leverage context signals like intent, file type, or code patterns.

### No Completion Verification

No mechanism to verify quality/safety of agent work results. Missing error handling, security vulnerabilities discovered only after the fact.

### No Inter-Role Collaboration Standards

In multi-agent workflows, work distribution and completion criteria between roles (PM, PL, Implementer, Reviewer, Validator) are unclear.

---

## Mechanism 1: SkillIndex

### Architecture

```
                    ┌──────────────┐
                    │ SkillService │
                    │  (N skills)  │
                    └──────┬───────┘
                           │ build()
                    ┌──────▼───────┐
                    │  SkillIndex  │
                    │  (injected)  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  SQLite DB   │
                    │  FTS5 + WAL  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼────┐ ┌────▼────┐ ┌─────▼─────┐
         │skill_docs│ │ intent  │ │skills_fts │
         │ (master) │ │patterns │ │  (FTS5)   │
         └─────────┘ └─────────┘ └───────────┘
```

### DB Schema

```sql
CREATE TABLE skill_docs (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, triggers TEXT, aliases TEXT,
  summary TEXT, intents TEXT, file_pats TEXT, code_pats TEXT
);
CREATE VIRTUAL TABLE skills_fts USING fts5(
  name, triggers, aliases, summary, intents, file_pats, code_pats,
  content='skill_docs', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
```

### 4-Dimensional Scoring

| Dimension | Source | Score | Method |
|-----------|--------|-------|--------|
| Keyword | triggers, aliases, name | BM25 (FTS5) | FTS5 upgrade of existing keyword matching |
| Intent | intents field | +3/match | Regex patterns → intent classification → intents matching |
| File path | file_patterns field | +4/match | Extract file extensions from request → glob matching |
| Code pattern | code_patterns field | +3/match | Code keyword/library name detection |

### Intent Patterns (Regex, No LLM Calls)

```typescript
// src/orchestration/intent-patterns.ts
const INTENT_PATTERNS: Record<string, RegExp[]> = {
  generate_document: [/만들어|생성|작성|create|generate|make/i, /파일|문서|보고서/i],
  analyze_data: [/분석|통계|데이터|analyze|data/i],
  search_web: [/검색|찾아|search|find/i],
  execute_code: [/실행|코드|스크립트|run|execute/i],
  version_control: [/커밋|PR|이슈|commit|branch/i],
};
```

### SKILL.md Frontmatter Extension

```yaml
metadata:
  intents: [generate_document]
  file_patterns: ["*.pdf", "*.pptx"]
  code_patterns: [python, pandas]
  checks:
    - Was the generated file verified to open correctly?
    - Are Korean fonts rendering properly?
```

### Integration Point

Replace `AgentDomain.recommend_skills()` implementation:

Current call chain: `OrchestrationService` → `runtime.recommend_skills()` → `AgentDomain.recommend_skills()` → `suggest_skills_for_text()`.
Instead of modifying OrchestrationService directly, **replace the recommendation implementation at AgentDomain/RuntimeService level**:

```typescript
// BEFORE: AgentDomain.recommend_skills() → suggest_skills_for_text()
// AFTER:  AgentDomain.recommend_skills() → this.skill_index.select()
```

This keeps `OrchestrationService.resolve_context_skills()` unchanged.

---

## Mechanism 2: CompletionChecker

### Two Check Sources

**A. Skill-defined checks** (frontmatter `checks:`):
- Collect `checks[]` from matched skills whose tools were actually used

**B. Dynamic checks** (tool usage pattern-based):

| Condition | Check Question |
|-----------|---------------|
| write_file/edit_file used | Does the changed file content match your intent? |
| exec/Bash used | Were there any errors in the execution result? |
| web_search/web_fetch used | Are the search result sources reliable? |
| task mode + tool_calls > 10 | Have you reviewed the final deliverable as a whole? |
| secret/oauth tools used | Is any sensitive information exposed? |

Dedup + max 5 questions. Skill-defined checks take priority.

### Self-Check Reminder (Mid-task)

After file-modifying tool execution, inject non-blocking check questions as system messages — **"Senior Colleague" pattern**.

> **Note**: Current `PostToolHook` returns `void` and is consumed via `swallow()`. In-loop injection is **not possible** with the current contract. The flow below is the **Track B target** (requires `PostToolHook` signature extension). Until then, Track A (out-of-band recording) applies — check questions are accumulated and delivered as post-completion follow-up only.

```
[Track B target flow]
Agent: write_file("src/store.ts") executed
    ↓
Self-check reminder (system message):
  "Check the file you just modified:"
  ✓ Did you add error handling?
  ✓ Are there any security concerns?
    ↓
Agent: "Oh right, I forgot error handling" → auto-fix
```

### 7-Step Automated Inspection Flow

```
① Instruction (user message)
    ↓
② Auto-deliver manual (SkillIndex → skill facade + references injection)
    ↓
③ AI performs work (code generation/modification)
    ↓
④ Auto-record files (changed file list + diff collection)
    ↓
⑤ Auto error check (lint, type-check, build)
    ↓
⑥ Self-check reminder ("Did you also check this?")
    ↓
⑦ AI auto-fix (self-completion based on reminder)
    ↓
Repeat (③~⑦) until complete → follow-up check questions to user
```

### Hook Integration: Two-Track Strategy

The existing `PostToolHook` (`tools/types.ts:75`) returns `void` and is consumed via `swallow()` in `tool-loop-helpers.ts:56`.
The current hook contract **cannot inject check messages back into the running loop**.

**Track A: Out-of-band check recording (current hook contract preserved)**
- `post_tool_use` records tool usage + accumulates check scores
- CompletionChecker generates follow-up questions from accumulated data at completion
- Low implementation cost, immediately feasible

**Track B: In-loop self-check (requires new injection channel)**
- Extend `PostToolHook` signature to `string | void` return
- Backends append returned string to tool_result → agent reads it next turn
- High implementation cost — requires modifying all 3 backends (claude-sdk, codex-appserver, tool-loop-helpers)

```typescript
// Track A: current contract — side-effect recording only
post_tool_use: (name, params, result, ctx) => {
  this.tools_accumulator.push(name);
  // check questions generated at completion time
};

// Track B: signature extension (future)
type PostToolHook = (...) => Promise<string | void> | string | void;
// returned string appended to tool_result → agent reads next turn
```

**Decision**: Implement Track A in Phase 3. Track B after validating self-check effectiveness.

---

## Mechanism 3: Project Document Protocol

### Kanban Board = Single Source of Truth

| Document | Storage Location | Author Role |
|----------|-----------------|-------------|
| **Plan** | Board description | PM (Designer) |
| **Context Notes** | Card description | PL (Distributor) |
| **Checklist** | Card subtasks + comments | Reviewer + Validator |

### Role Chain

```
PM (Designer) → Write plan → kanban("create_board")
    ↓
PL (Distributor) → Distribute work + context notes → kanban("create_card") × N
    ↓
Implementer → Execute work → kanban("move_card", "in_review")
    ↓
Reviewer → Code review checklist → approve/return
    ↓
Validator → Build/test/lint → auto-fix or escalation
```

### Work Distribution: Sequential Execution

PL registers all cards in todo, but moves only an **appropriate amount** to in_progress.
Judged by dependencies/complexity/WIP limits.

### Team Presets

| Team | Role Composition | Responsibility |
|------|-----------------|----------------|
| **Planning** | PM | Plan creation, plan review, documentation |
| **Quality Management** | Reviewer + (Implementer) | Code review, error fixing, structural improvement |
| **Testing** | Validator | Functional testing, error diagnosis, visual verification |

Full team: `PM → PL → Implementer → Reviewer → Validator`
Light: `PM → Implementer → Validator`

### Structured Reports

All agent feedback must include 3 elements:
- **What was found** — Describe the phenomenon/problem
- **What was fixed** — Describe changes concretely
- **Why that judgment was made** — Explain reasoning/criteria/context

### Validator Branching Logic

```
Auto error check (build/test/lint)
    ↓
├─ Few errors → AI auto-fix → re-verify → done
└─ Many errors → Return to Implementer (error list + fix direction)
```

This branching logic must be expressible as workflow nodes.

---

## Data Flow

### Pre-execution (Skill Matching)

```
User Message → OrchestrationService.execute()
    → resolve_context_skills(task)
        → runtime.recommend_skills(task, 8)
            → AgentDomain.recommend_skills()
                → SkillIndex.select(task, {file_hints, code_hints})
                    ├→ FTS5 BM25
                    ├→ Intent pattern matching
                    ├→ File extension matching
                    └→ Code pattern matching
    → load_skills_for_context() ← body (facade) only
    → System prompt injection
```

### Mid-task (Track A: Out-of-band Recording)

```
Agent loop:
  tool_call(write_file) → AgentHooks.post_tool_use()
    → tools_accumulator records tool name + check scores
    → (does not intervene in the loop)
    ↓
On completion:
  CompletionChecker.check(accumulator) → generate follow-up questions
```

> **Track B (future)**: After extending `PostToolHook` signature, append check questions to tool_result → agent self-completion

### Post-completion (Check)

```
OrchestrationResult → Channel response finalize path
    → CompletionChecker.check()
    → Max 5 questions as follow-up message
```

> **Note**: Expressed as "channel response finalize path" rather than a specific method (`deliver_result()`).
> The path may change during structural decomposition; do not fix method names as contracts.

---

## Affected Files

### New

| File | Description |
|------|-------------|
| `src/orchestration/skill-index.ts` | FTS5-based 4-dimensional skill matcher |
| `src/orchestration/completion-checker.ts` | Post-completion check question generator |
| `src/orchestration/intent-patterns.ts` | Intent regex + file/code extraction utilities |
| `src/skills/_shared/project-docs-protocol.md` | Project document protocol |
| `src/skills/_shared/report-format-protocol.md` | Structured report format |
| `src/skills/_shared/team-presets.md` | Team preset definitions |
| `src/skills/roles/*/references/*-template.md` | Role-specific document templates |

### Modified

| File | Change |
|------|--------|
| `src/agent/skills.types.ts` | Add intents, file_patterns, code_patterns, checks, project_docs (shared_protocols already exists) |
| `src/agent/skills.service.ts` | Parse new frontmatter fields |
| `src/agent/index.ts` (`AgentDomain.recommend_skills()`) | Replace `suggest_skills_for_text()` call with `SkillIndex.select()` |
| Channel response finalize path | Integrate CompletionChecker (exact path TBD after structural decomposition) |
| `src/skills/roles/*/SKILL.md` | Add project_docs (shared_protocols already exists) |

### tools_used Ownership (Source of Truth)

`tools_used` already exists in multiple locations:
- `memory.types.ts:42` — `MemoryEntry.tools_used`
- `session/types.ts:8` — `SessionMessage.tools_used`

**Decision**: Use `SessionMessage.tools_used` as source of truth.
- CompletionChecker references session-level tools_used
- Do NOT add duplicate field to OrchestrationResult; add only `matched_skills`
- MemoryService reads session data to reflect in memory (maintain existing flow)

**Warning: tools_used write path does not currently exist.**
- `session/service.ts:225` `append_message()` stores `SessionMessage`, but
  current callers do not populate the `tools_used` field
- **Phase 1 must add capture path:**
  - `post_tool_use` hook records tool names into per-task/session accumulator
  - When saving assistant message, include accumulator contents in `SessionMessage.tools_used`

---

## Architectural Constraints

- **SkillIndex injected at AgentDomain/RuntimeService level** — No global singletons. Replace `AgentDomain.recommend_skills()` implementation so OrchestrationService stays unchanged
- **CompletionChecker is also injected** — Used in channel response finalize path, but does not depend on specific method names
- **Mid-task self-check has two tracks** — Current `PostToolHook` returns void, cannot inject into loop. Track A (out-of-band recording) first, Track B (signature extension) after validation
- **tools_used write path must be added** — `SessionMessage.tools_used` type exists but has no actual write path. Phase 1 adds `post_tool_use` → accumulator → `append_message` path
- **No tools_used duplication** — `SessionMessage.tools_used` is source of truth. Only add `matched_skills` to OrchestrationResult
- **shared_protocols already exists** — Defined at `skills.types.ts:24`. When modifying role skills, "set values" not "add field"
- **Structural decomposition in progress** — Avoid touching orchestration/service.ts and channels/manager.ts simultaneously; minimize change surface after decomposition completes

---

## Implementation Order

### Phase 1: Types + Parsing + tools_used Capture Path
1. `skills.types.ts` — Add intents, file_patterns, code_patterns, checks, project_docs
2. `skills.service.ts` — Extend frontmatter parsing
3. `orchestration/types.ts` — Add matched_skills (tools_used uses existing session-level field)
4. tools_used capture path:
   - `post_tool_use` hook records tool names into per-scope accumulator
   - `append_message` includes accumulator → `SessionMessage.tools_used`

### Phase 2: SkillIndex
1. `intent-patterns.ts` — Intent regex, file/code pattern extractors
2. `skill-index.ts` — FTS5 build + 4-dimensional select
3. `tests/orchestration/skill-index.test.ts`
4. Replace `AgentDomain.recommend_skills()` implementation with SkillIndex (OrchestrationService unchanged)

### Phase 3: CompletionChecker (Track A — out-of-band)
1. `completion-checker.ts` — Skill check collection + dynamic rules (references SessionMessage.tools_used)
2. `tests/orchestration/completion-checker.test.ts`
3. Connect follow-up to channel response finalize path (exact path TBD after structural decomposition)

### Phase 3b: In-loop Self-check (Track B — deferred)
1. Evaluate `PostToolHook` signature extension to `string | void`
2. Backend modifications (claude-sdk, codex-appserver, tool-loop-helpers) for return value handling
3. A/B test self-check effectiveness before committing

### Phase 4: SKILL.md Frontmatter Enrichment
1. Add intents, file_patterns, code_patterns, checks to priority skills

### Phase 5: Project Document Protocol
1. Write shared protocols + role templates
2. Kanban board integration guide

---

## Verification

1. **SkillIndex**: "PDF 보고서 만들어줘" → matches `file-maker`, "파이썬으로 분석해줘" → matches `sandbox`
2. **CompletionChecker**: file-maker + write_file → generates "Is the file correct?" check question
3. **Integration**: message → skill matching → agent execution → check question follow-up
4. **Project docs**: workflow + PM role → kanban board auto-creation
