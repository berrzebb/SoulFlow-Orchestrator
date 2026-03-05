# Design: Orchestrator LLM — Model-Agnostic Classifier Runtime

> **Status**: Implemented

## Overview

The orchestrator's classifier is currently hardcoded to phi4-mini. This design replaces all phi4-specific naming and infrastructure with a model-agnostic **Orchestrator LLM** abstraction, enabling hot-swap of any OpenAI-compatible local model (Qwen, DeepSeek, Phi-4, Gemma, etc.) via dashboard configuration.

### Goals

1. **Rename** phi4 → orchestrator-llm across files, classes, config keys, i18n
2. **Abstract backend** — ollama / vLLM / LM Studio interchangeable
3. **Dashboard model management** — list installed models, pull, delete, switch active model
4. **Zero code change on model swap** — config-only operation

### Why Now

Phase Loop requires a classifier capable of detecting `phase` mode and generating workflow structures. phi4-mini cannot do this. Swapping to Qwen3-4B or DeepSeek-3B (similar VRAM, far better JSON generation) must be trivial. The current hardcoding makes even renaming painful (19+ files, 48+ references).

---

## Current Architecture

```
User message
  ↓
ProviderRegistry.run_orchestrator()
  ↓ orchestrator_provider_id = "phi4_local"
Phi4LocalProvider.chat()     ← OpenAI-compatible /v1/chat/completions
  ↓
Phi4RuntimeManager           ← ollama serve / docker container lifecycle
  ├─ start/stop
  ├─ pull_model (internal)
  ├─ warmup
  └─ health_check
```

**Hardcoded references**: `Phi4LocalProvider`, `Phi4RuntimeManager`, `Phi4RuntimeEngine`, `Phi4RuntimeOptions`, `Phi4RuntimeStatus`, `Phi4ServiceAdapter`, `"phi4_local"` provider ID, `app_config.phi4.*` config keys, `cfg.phi4.*` i18n keys.

---

## Target Architecture

```
User message
  ↓
ProviderRegistry.run_orchestrator()
  ↓ orchestrator_provider_id = "orchestrator_llm"
OrchestratorLlmProvider.chat()    ← same OpenAI-compatible API
  ↓
OrchestratorLlmRuntime            ← engine-agnostic runtime manager
  ├─ start/stop
  ├─ list_models()        ← NEW: GET /api/tags
  ├─ pull_model(name)     ← NEW: POST /api/pull (public)
  ├─ delete_model(name)   ← NEW: DELETE /api/delete
  ├─ list_running()       ← NEW: GET /api/ps (public)
  ├─ switch_model(name)   ← NEW: config update + warmup
  └─ health_check()
```

---

## Type Design

### Runtime Types

```typescript
/** Engine backends — all expose OpenAI-compatible API */
export type OrchestratorLlmEngine = "native" | "docker" | "podman";

export type OrchestratorLlmOptions = {
  enabled?: boolean;
  engine?: "auto" | OrchestratorLlmEngine;
  image?: string;          // default: "ollama/ollama:latest"
  container?: string;      // default: "orchestrator-llm"
  port?: number;           // default: 11434
  model?: string;          // default: "phi4-mini" (user changes via dashboard)
  pull_model?: boolean;
  auto_stop?: boolean;
  api_base?: string;
  gpu_enabled?: boolean;
  gpu_args?: string[];
};

export type OrchestratorLlmStatus = {
  enabled: boolean;
  running: boolean;
  engine?: OrchestratorLlmEngine;
  container: string;
  image: string;
  port: number;
  model: string;
  api_base: string;
  last_error?: string;
  model_loaded?: boolean;
  gpu_percent?: number;
};
```

### Model Management Types

```typescript
export type ModelInfo = {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
  parameter_size?: string;    // e.g., "3.8B"
  quantization_level?: string; // e.g., "Q4_K_M"
};

export type RunningModelInfo = {
  name: string;
  size: number;
  size_vram: number;
  expires_at: string;
};

export type PullProgress = {
  status: string;
  completed?: number;
  total?: number;
};
```

---

## Renaming Map

### Files

| Current | New |
|---------|-----|
| `src/providers/phi4.provider.ts` | `src/providers/orchestrator-llm.provider.ts` |
| `src/providers/phi4.runtime.ts` | `src/providers/orchestrator-llm.runtime.ts` |
| `src/providers/phi4-service.adapter.ts` | `src/providers/orchestrator-llm-service.adapter.ts` |
| `src/phi4-health.ts` | `src/orchestrator-llm-health.ts` |

### Classes & Types

| Current | New |
|---------|-----|
| `Phi4LocalProvider` | `OrchestratorLlmProvider` |
| `Phi4RuntimeManager` | `OrchestratorLlmRuntime` |
| `Phi4RuntimeEngine` | `OrchestratorLlmEngine` |
| `Phi4RuntimeOptions` | `OrchestratorLlmOptions` |
| `Phi4RuntimeStatus` | `OrchestratorLlmStatus` |
| `Phi4ServiceAdapter` | `OrchestratorLlmServiceAdapter` |

### Provider ID

`"phi4_local"` → `"orchestrator_llm"` (all files referencing ProviderId)

### Config Key

`app_config.phi4` → `app_config.orchestratorLlm`

### i18n

`cfg.section.phi4` / `cfg.phi4.*` → `cfg.section.orchestratorLlm` / `cfg.orchestratorLlm.*`

---

## Model Management API

Exposed via `OrchestratorLlmRuntime` public methods, backed by Ollama HTTP API:

| Method | Ollama API | Description |
|--------|-----------|-------------|
| `list_models()` | `GET /api/tags` | All locally installed models |
| `pull_model(name)` | `POST /api/pull` | Download model (streaming progress) |
| `delete_model(name)` | `DELETE /api/delete` | Remove model from disk |
| `list_running()` | `GET /api/ps` | Currently loaded models in VRAM |
| `switch_model(name)` | config + warmup | Change active classifier model |

### Dashboard API Routes

`models` as a top-level resource. Runtime state is a sub-resource of models.

```
GET    /api/models                  → ModelInfo[]            All installed models
POST   /api/models                  → PullProgress           Pull model (body: { name })
DELETE /api/models                  → { ok: boolean }        Delete model (body: { name })
GET    /api/models/active           → RunningModelInfo[]     VRAM-loaded models
GET    /api/models/runtime          → OrchestratorLlmStatus  Runtime status
PATCH  /api/models/runtime          → OrchestratorLlmStatus  Switch active model (body: { name })
```

---

## Dashboard UI

The existing "Phi-4 Runtime" config section becomes "Orchestrator LLM":

- **Status card**: running/stopped, engine type, GPU %, active model
- **Model selector**: dropdown populated from `list_models()`, with current model highlighted
- **Model actions**: Pull (text input + button), Delete (per-model button with confirm)
- **Running models**: table showing VRAM usage per loaded model

---

## Migration

No automatic config migration needed. Users with existing `phi4` config keys in their SQLite config store will get defaults for the new `orchestratorLlm` keys. The old phi4 keys become orphaned (harmless).

---

## Affected Files

### File renames (4)
`phi4.provider.ts`, `phi4.runtime.ts`, `phi4-service.adapter.ts`, `phi4-health.ts`

### Source modifications (~19)
`providers/types.ts`, `providers/service.ts`, `providers/executor.ts`, `providers/index.ts`, `config/schema.ts`, `config/config-meta.ts`, `main.ts`, `orchestration/classifier.ts`, `orchestration/service.ts`, `orchestration/types.ts`, `orchestration/gateway.ts`, `orchestration/tool-selector.ts`, `channels/output-sanitizer.ts`, `agent/subagents.ts`, `agent/backends/openai-compatible.agent.ts`, `dashboard/ops-factory.ts`

### Web (~3)
`web/src/i18n/en.ts`, `web/src/i18n/ko.ts`, `web/src/pages/setup.tsx`

### Tests (~10)
`config-defaults.test.ts`, `e2e/runner.ts`, `e2e/harness.ts`, `feedback-analyzer.test.ts`, `executor-provider.test.ts`, `health-scorer.test.ts`, `status-handler.test.ts`, `classifier-golden.test.ts`, `persona-spawn-injection.test.ts`, `channel-pipeline-integration.test.ts`

---

## Verification

1. `npx tsc --noEmit` — zero type errors
2. `npx vitest run` — all existing tests pass
3. `grep -r "phi4\|Phi4\|phi-4" src/ --include="*.ts"` — zero remaining references
4. Dashboard shows "Orchestrator LLM" section with model list

---

## Related Docs

→ [Phase Loop](./phase-loop.md) — Phase Loop requires classifier upgrade; this design enables model swap
→ [PTY Agent Backend](./pty-agent-backend.md) — PTY agents are spawned by orchestrator; classifier decides execution mode
