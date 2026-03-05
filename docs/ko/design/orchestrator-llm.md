# 설계: 오케스트레이터 LLM — 모델 무관 분류기 런타임

> **상태**: 구현 완료

## 개요

오케스트레이터의 분류기가 현재 phi4-mini에 하드코딩되어 있다. 이 설계는 모든 phi4 전용 네이밍과 인프라를 모델 무관(model-agnostic) **오케스트레이터 LLM** 추상화로 교체하여, 대시보드 설정만으로 OpenAI 호환 로컬 모델(Qwen, DeepSeek, Phi-4, Gemma 등)을 핫스왑할 수 있게 한다.

### 목표

1. **리네이밍**: phi4 → orchestrator-llm (파일명, 클래스명, 설정 키, i18n)
2. **백엔드 추상화**: ollama / vLLM / LM Studio 교체 가능
3. **대시보드 모델 관리**: 설치된 모델 목록, pull, 삭제, 활성 모델 변경
4. **모델 교체 시 코드 변경 0**: 설정만으로 완료

### 왜 지금인가

Phase Loop는 `phase` 모드를 감지하고 워크플로우 구조를 생성할 수 있는 분류기가 필요하다. phi4-mini로는 불가능하다. Qwen3-4B나 DeepSeek-3B(비슷한 VRAM, 훨씬 나은 JSON 생성 능력)로의 교체가 사소해야 한다. 현재 하드코딩은 이름 변경만으로도 고통스럽다(19+ 파일, 48+ 참조).

---

## 현재 아키텍처

```
사용자 메시지
  ↓
ProviderRegistry.run_orchestrator()
  ↓ orchestrator_provider_id = "phi4_local"
Phi4LocalProvider.chat()     ← OpenAI 호환 /v1/chat/completions
  ↓
Phi4RuntimeManager           ← ollama serve / docker 컨테이너 라이프사이클
  ├─ start/stop
  ├─ pull_model (내부)
  ├─ warmup
  └─ health_check
```

**하드코딩된 참조**: `Phi4LocalProvider`, `Phi4RuntimeManager`, `Phi4RuntimeEngine`, `Phi4RuntimeOptions`, `Phi4RuntimeStatus`, `Phi4ServiceAdapter`, `"phi4_local"` provider ID, `app_config.phi4.*` 설정 키, `cfg.phi4.*` i18n 키.

---

## 목표 아키텍처

```
사용자 메시지
  ↓
ProviderRegistry.run_orchestrator()
  ↓ orchestrator_provider_id = "orchestrator_llm"
OrchestratorLlmProvider.chat()    ← 동일한 OpenAI 호환 API
  ↓
OrchestratorLlmRuntime            ← 엔진 무관 런타임 매니저
  ├─ start/stop
  ├─ list_models()        ← 신규: GET /api/tags
  ├─ pull_model(name)     ← 신규: POST /api/pull (public)
  ├─ delete_model(name)   ← 신규: DELETE /api/delete
  ├─ list_running()       ← 신규: GET /api/ps (public)
  ├─ switch_model(name)   ← 신규: 설정 변경 + warmup
  └─ health_check()
```

---

## 타입 설계

### 런타임 타입

```typescript
/** 엔진 백엔드 — 모두 OpenAI 호환 API 노출 */
export type OrchestratorLlmEngine = "native" | "docker" | "podman";

export type OrchestratorLlmOptions = {
  enabled?: boolean;
  engine?: "auto" | OrchestratorLlmEngine;
  image?: string;          // 기본: "ollama/ollama:latest"
  container?: string;      // 기본: "orchestrator-llm"
  port?: number;           // 기본: 11434
  model?: string;          // 기본: "phi4-mini" (대시보드에서 변경)
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

### 모델 관리 타입

```typescript
export type ModelInfo = {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
  parameter_size?: string;    // 예: "3.8B"
  quantization_level?: string; // 예: "Q4_K_M"
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

## 리네이밍 맵

### 파일

| 현재 | 변경 후 |
|------|---------|
| `src/providers/phi4.provider.ts` | `src/providers/orchestrator-llm.provider.ts` |
| `src/providers/phi4.runtime.ts` | `src/providers/orchestrator-llm.runtime.ts` |
| `src/providers/phi4-service.adapter.ts` | `src/providers/orchestrator-llm-service.adapter.ts` |
| `src/phi4-health.ts` | `src/orchestrator-llm-health.ts` |

### 클래스 및 타입

| 현재 | 변경 후 |
|------|---------|
| `Phi4LocalProvider` | `OrchestratorLlmProvider` |
| `Phi4RuntimeManager` | `OrchestratorLlmRuntime` |
| `Phi4RuntimeEngine` | `OrchestratorLlmEngine` |
| `Phi4RuntimeOptions` | `OrchestratorLlmOptions` |
| `Phi4RuntimeStatus` | `OrchestratorLlmStatus` |
| `Phi4ServiceAdapter` | `OrchestratorLlmServiceAdapter` |

### Provider ID

`"phi4_local"` → `"orchestrator_llm"` (ProviderId 참조 전체)

### Config 키

`app_config.phi4` → `app_config.orchestratorLlm`

### i18n

`cfg.section.phi4` / `cfg.phi4.*` → `cfg.section.orchestratorLlm` / `cfg.orchestratorLlm.*`

---

## 모델 관리 API

`OrchestratorLlmRuntime`의 public 메서드로 노출, Ollama HTTP API 기반:

| 메서드 | Ollama API | 설명 |
|--------|-----------|------|
| `list_models()` | `GET /api/tags` | 로컬 설치된 전체 모델 |
| `pull_model(name)` | `POST /api/pull` | 모델 다운로드 (스트리밍 진행률) |
| `delete_model(name)` | `DELETE /api/delete` | 디스크에서 모델 제거 |
| `list_running()` | `GET /api/ps` | 현재 VRAM에 로드된 모델 |
| `switch_model(name)` | config + warmup | 활성 분류기 모델 변경 |

### 대시보드 API 라우트

`models`를 최상위 리소스로 정규화. 런타임 상태는 models의 하위 리소스.

```
GET    /api/models                  → ModelInfo[]          설치된 전체 모델
POST   /api/models                  → PullProgress         모델 다운로드 (body: { name })
DELETE /api/models                  → { ok: boolean }      모델 삭제 (body: { name })
GET    /api/models/active           → RunningModelInfo[]   VRAM 로드 모델
GET    /api/models/runtime          → OrchestratorLlmStatus 런타임 상태
PATCH  /api/models/runtime          → OrchestratorLlmStatus 활성 모델 변경 (body: { name })
```

---

## 대시보드 UI

기존 "Phi-4 Runtime" 설정 섹션이 "오케스트레이터 LLM"으로 변경:

- **상태 카드**: running/stopped, 엔진 유형, GPU %, 활성 모델
- **모델 선택기**: `list_models()`로 채워진 드롭다운, 현재 모델 하이라이트
- **모델 액션**: Pull (텍스트 입력 + 버튼), Delete (모델별 버튼 + 확인)
- **실행 중 모델**: VRAM 사용량 테이블

---

## 마이그레이션

자동 설정 마이그레이션 불필요. 기존 SQLite config store의 `phi4` 키를 가진 사용자는 새 `orchestratorLlm` 키의 기본값을 받게 됨. 기존 phi4 키는 고아 상태(무해).

---

## 영향 파일

### 파일 리네이밍 (4)
`phi4.provider.ts`, `phi4.runtime.ts`, `phi4-service.adapter.ts`, `phi4-health.ts`

### 소스 수정 (~19)
`providers/types.ts`, `providers/service.ts`, `providers/executor.ts`, `providers/index.ts`, `config/schema.ts`, `config/config-meta.ts`, `main.ts`, `orchestration/classifier.ts`, `orchestration/service.ts`, `orchestration/types.ts`, `orchestration/gateway.ts`, `orchestration/tool-selector.ts`, `channels/output-sanitizer.ts`, `agent/subagents.ts`, `agent/backends/openai-compatible.agent.ts`, `dashboard/ops-factory.ts`

### 웹 (~3)
`web/src/i18n/en.ts`, `web/src/i18n/ko.ts`, `web/src/pages/setup.tsx`

### 테스트 (~10)
`config-defaults.test.ts`, `e2e/runner.ts`, `e2e/harness.ts`, `feedback-analyzer.test.ts`, `executor-provider.test.ts`, `health-scorer.test.ts`, `status-handler.test.ts`, `classifier-golden.test.ts`, `persona-spawn-injection.test.ts`, `channel-pipeline-integration.test.ts`

---

## 검증

1. `npx tsc --noEmit` — 타입 에러 0
2. `npx vitest run` — 기존 테스트 전체 통과
3. `grep -r "phi4\|Phi4\|phi-4" src/ --include="*.ts"` — 잔여 참조 0건
4. 대시보드에서 "오케스트레이터 LLM" 섹션 + 모델 목록 표시 확인

---

## 관련 문서

→ [Phase Loop](./phase-loop.md) — Phase Loop는 분류기 업그레이드 필요; 이 설계가 모델 교체를 가능하게 함
→ [PTY 에이전트 백엔드](./pty-agent-backend.md) — PTY 에이전트는 오케스트레이터가 스폰; 분류기가 실행 모드 결정
