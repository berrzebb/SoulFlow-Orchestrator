# 대시보드

`http://127.0.0.1:4200`에서 접근 가능한 웹 기반 관리 UI입니다.

**React + Vite**로 구축. **한국어/영어 i18n** 지원 (브라우저 로케일 자동 감지). CSS 디자인 토큰 시스템(`var(--sp-*)`, `var(--fs-*)`, `var(--line)`, `var(--radius-*)`)으로 일관된 테마 제공.

전역 상태 관리는 Zustand (`store.ts`) — SSE 연결 상태, 사이드바, 테마, 웹 스트리밍.

사이드바에서 9개 섹션으로 이동합니다. 하단 버튼으로 다크/라이트 테마를 전환할 수 있습니다.

## Setup Wizard

첫 실행 시 프로바이더가 설정되지 않으면 자동으로 `/setup`으로 리디렉트됩니다.

| 단계 | 내용 |
|------|------|
| 1 | AI 프로바이더 선택 + API 키 입력 |
| 2 | 기본 executor/orchestrator 선택 |
| 3 | 에이전트 alias 입력 |
| 4 | 완료 → 1.5초 후 Overview로 이동 |

## 페이지 구성

| 페이지 | 경로 | 기능 |
|--------|------|------|
| Overview | `/` | 런타임 상태 요약, 시스템 메트릭, SSE 실시간 피드 |
| Workspace | `/workspace` | 메모리·세션·스킬·크론·도구·에이전트·템플릿·OAuth 관리 (8탭) |
| Chat | `/chat` | 웹 기반 에이전트 대화 (마크다운 렌더링 + 코드 하이라이팅) |
| Channels | `/channels` | 채널 연결 상태 · 글로벌 설정 |
| Providers | `/providers` | 에이전트 프로바이더 CRUD |
| Secrets | `/secrets` | AES-256-GCM 시크릿 관리 |
| Models | `/models` | 오케스트레이터 LLM 런타임 · 모델 pull/delete/switch |
| Workflows | `/workflows` | Phase Loop 워크플로우 관리 · 에이전트 채팅 |
| Settings | `/settings` | 글로벌 런타임 설정 (섹션 탭, 인라인 편집, ToggleSwitch) |

## Overview

런타임 전체 상태를 한눈에 확인합니다.

| 섹션 | 내용 |
|------|------|
| **통계 카드** | 활성 에이전트 수 · 실행 중 프로세스 · 연결된 채널 |
| **Performance** | CPU · 메모리 · Swap 사용률 (프로그레스 바) |
| **Network** | 네트워크 수신/송신 속도 (KB/s) — Linux 환경에서만 표시 |
| **에이전트** | 역할별 상태 배지 · 마지막 메시지 시간 |
| **실행 중인 프로세스** | run_id · 모드 · 도구 호출 수 · 에러 여부 |
| **크론** | 활성 크론 잡 (잡 있을 때만 표시) |
| **결정사항** | 주요 결정 키-값 (결정 있을 때만 표시) |
| **최근 이벤트** | 워크플로우 이벤트 스트림 |

## Workspace 탭 상세

Workspace는 8개 탭으로 구성됩니다.

### Memory
에이전트의 메모리와 DB 기반 기록을 조회/편집합니다.

| 항목 | 내용 |
|------|------|
| **Long-term** | 장기 메모리 (편집 가능) |
| **Daily** | 날짜별 일일 노트 (편집 가능) |
| **Decisions** | DB에 저장된 결정사항 목록 |
| **Promises** | DB에 저장된 약속 목록 (추가/삭제 가능) |
| **Events** | DB에 저장된 워크플로우 이벤트 스트림 |

### Sessions
대화 세션 목록과 히스토리를 조회합니다.
- **채널 필터 칩**: 전체 / Slack / Telegram / Discord / Web 탭으로 프로바이더별 필터링
- 세션 클릭 → 프로바이더 배지 + 타임스탬프 포함 전체 메시지 히스토리

### Skills
에이전트 스킬 목록과 파일을 확인/편집합니다.
- **builtin 스킬**: 읽기 전용 (내장 역할 스킬)
- **workspace 스킬**: `SKILL.md` 및 `references/` 파일 직접 편집 가능
- 파일 탭 전환, 편집 후 Save 버튼으로 저장
- 저장 즉시 에이전트에 반영 (재시작 불필요)
- **도구 피커** (`SKILL.md` 편집 시 자동 표시)
  - `도구:` — SoulFlow 레지스트리 도구 칩 클릭 → `tools:` frontmatter 토글
  - `SDK:` — Bash · Read · Write · Edit 등 네이티브 도구
  - `OAuth:` — 등록된 OAuth 서비스 → `oauth:` frontmatter 토글
  - `역할 프리셋:` — 역할 버튼 클릭 → 해당 역할 도구 세트 일괄 병합

### Cron
크론 잡을 관리합니다.
- 잡 목록 · 활성/비활성 상태 · 다음 실행 시간
- 잡 추가/수정/삭제 · Run Now(즉시 실행)

### Tools
에이전트가 사용 가능한 도구 목록을 조회합니다.
- 도구명 · 소스 · 파라미터 수
- **행 클릭** → 파라미터 테이블 펼치기 (이름 · 타입 · 필수 여부 · 설명)

### Agents
에이전트 설정을 관리합니다.
- 에이전트 목록 · 역할 · 백엔드
- 추가/수정/삭제

### Templates
시스템 프롬프트 템플릿을 편집합니다.
- 편집 가능 파일: `AGENTS` · `SOUL` · `HEART` · `USER` · `TOOLS` · `HEARTBEAT`
- 저장 후 다음 에이전트 실행 시 즉시 반영

### OAuth
OAuth 2.0 외부 서비스 연동 관리 → [OAuth 가이드](./oauth.md) 참고

## Chat 페이지

Slack/Telegram 없이 웹에서 에이전트와 직접 대화합니다.

- **마크다운 렌더링**: GFM 완전 지원 (헤딩, 볼드, 리스트, 테이블, 인용)
- **코드 하이라이팅**: 펜스드 코드블록 언어별 구문 강조 (`highlight.js`)
- **보안**: `rehype-sanitize`로 `<script>`, `<iframe>`, `javascript:` URL 등 XSS 차단
- **스트리밍**: 에이전트 스트리밍 중 부분 마크다운 점진적 렌더링
- **승인 배너**: 도구 승인 요청 시 인라인 승인/거부 UI
- **미디어 프리뷰**: 첨부파일 인라인 렌더링
- **에이전트 선택**: 설정된 에이전트 간 전환

## Providers 페이지 주요 기능

에이전트 백엔드를 추가/수정/삭제하고 연결을 테스트합니다.

1. **Add** — 새 프로바이더 추가 (타입, 토큰, 우선순위, 지원 모드 설정)
2. **Edit** — 기존 프로바이더 설정 수정
3. **Test** — 실제 API 호출로 연결 확인
4. **Remove** — 프로바이더 삭제

서킷 브레이커 상태(`closed` / `half_open` / `open`)는 카드 배지로 표시됩니다.

## Models 페이지

오케스트레이터 LLM 런타임과 모델을 관리합니다. 오케스트레이터는 사용자 메시지를 분류하여 실행 모드(`once`/`agent`/`task`/`phase`)를 결정하는 경량 분류기입니다. 이 분류기에 사용되는 로컬 LLM(Phi-4, Qwen, DeepSeek, Gemma 등)을 대시보드에서 코드 변경 없이 핫스왑할 수 있습니다.

### 런타임 상태 카드

| 항목 | 내용 |
|------|------|
| **상태** | running / stopped |
| **엔진** | `native` (호스트 Ollama) / `docker` / `podman` |
| **GPU** | GPU 사용률 (%) |
| **활성 모델** | 현재 분류에 사용 중인 모델명 |
| **API Base** | Ollama API 엔드포인트 (기본: `http://localhost:11434`) |

### 모델 관리

| 기능 | 설명 |
|------|------|
| **모델 목록** | 로컬 설치된 전체 모델 — 이름, 크기, 파라미터 수(예: 3.8B), 양자화 수준(예: Q4_K_M) |
| **Pull** | Ollama 레지스트리에서 모델 다운로드 — 스트리밍 진행률 표시 |
| **Delete** | 디스크에서 모델 제거 (확인 후) |
| **Switch** | 활성 분류기 모델 변경 — 설정 업데이트 + warmup 자동 수행 |
| **VRAM 모니터** | 현재 VRAM에 로드된 모델 목록 + 메모리 사용량 |

### 모델 관리 API

| 엔드포인트 | 기능 |
|-----------|------|
| `GET /api/models` | 설치된 전체 모델 목록 |
| `POST /api/models` | 모델 다운로드 (`{ name }`) |
| `DELETE /api/models` | 모델 삭제 (`{ name }`) |
| `GET /api/models/active` | VRAM에 로드된 모델 목록 |
| `GET /api/models/runtime` | 런타임 상태 조회 |
| `PATCH /api/models/runtime` | 활성 모델 변경 (`{ name }`) |

### 엔진 설정

런타임 엔진은 `auto` 모드에서 자동 감지됩니다:

| 엔진 | 조건 | 특징 |
|------|------|------|
| `native` | 호스트에 Ollama 설치됨 | 가장 빠른 시작, GPU 직접 접근 |
| `docker` | Docker 사용 가능 | `ollama/ollama:latest` 이미지 자동 관리 |
| `podman` | Podman 사용 가능 | Docker와 동일한 인터페이스 |

## Workflows 페이지

Phase Loop 워크플로우를 관리하고 에이전트와 대화합니다. Phase Loop는 Agent Loop(1:1 단일 에이전트)·Task Loop(순차 N:1)와 달리, **페이즈 내 병렬 에이전트 + critic 검토 → 다음 페이즈**의 2차원 실행 모델입니다.

### 기존 루프와의 비교

| | Agent Loop | Task Loop | Phase Loop |
|---|---|---|---|
| 실행 단위 | 단일 프롬프트 | 순차 노드 | 페이즈 × 병렬 에이전트 |
| 에이전트 수 | 1 | 1/스텝 | N/페이즈 + critic |
| 실행 방식 | 동기 | 순차 | 페이즈 내 병렬, 페이즈 간 순차 |
| 대화 | 단일 세션 | 단일 세션 | 에이전트별 독립 세션 |
| 품질 게이트 | 없음 | 없음 | critic 검토 |

### 워크플로우 목록

워크플로우 카드에 표시되는 정보:
- **제목** · **상태** (`running` / `completed` / `failed` / `cancelled` / `waiting_user_input`)
- **진행률**: 현재 페이즈 / 전체 페이즈, 완료 에이전트 수
- **에이전트 수** · **critic 수**

### 워크플로우 상세 뷰

워크플로우를 클릭하면 상세 페이지로 이동합니다:

- **페이즈 타임라인**: 각 페이즈의 상태를 시각적으로 표시 (`pending` → `running` → `reviewing` → `completed`)
- **에이전트 카드 그리드**: 페이즈 내 에이전트별 상태 카드
  - 역할 · 모델 · 상태 배지
  - `[결과]` — 에이전트의 최종 산출물 확인
  - `[💬 채팅]` — 에이전트와 추가 대화
- **Critic 카드**: 모든 에이전트 완료 후 critic의 검토 결과
  - 승인 여부 · 피드백 내용
  - 거절 시 사용자 선택지: Continue / Retry / Abort

### 에이전트 채팅 패널

에이전트 카드의 `[💬]` 클릭 시 우측 슬라이드 패널이 열립니다. 각 에이전트는 독립 세션을 가지며, 사용자가 개별 에이전트와 양방향 대화할 수 있습니다.

- **대화 히스토리**: 시스템 프롬프트 · 에이전트 응답 · 사용자 메시지 전체 표시
- **에이전트 간 통신 표시**: `ask_agent` 호출/응답을 별도 스타일로 구분
- **실시간 업데이트**: SSE `agent_message` 이벤트로 새 메시지 자동 추가
- **재실행**: 에이전트를 초기 프롬프트로 재실행하는 버튼

채팅 예시:
```
사용자: "경쟁사 분석에서 A사 빠졌는데 추가해줘"
시장조사관: "A사 분석을 추가하겠습니다. [분석 결과 업데이트]"
→ agent.result 업데이트, agent.messages에 대화 기록
```

### 에이전트 간 자율 통신

Phase 내 에이전트들은 `ask_agent` 도구를 통해 orchestrator를 경유하지 않고 직접 대화할 수 있습니다:

```
시장조사관 → ask_agent("기술분석가", "3nm 공정 현황 알려줘")
← 기술분석가: "TSMC N3E 양산 중, Samsung 2nm GAA 2025 예정..."
```

안전장치:
- 호출 depth 카운터 (`max_depth=3`) — 무한 루프 방지
- 에이전트당 mutex — 동시 요청 직렬화
- 큐 깊이 제한 (≤3) + 타임아웃 (30초)
- 같은 페이즈 내 에이전트만 통신 가능

### 워크플로우 정의 (YAML)

`workspace/workflows/` 디렉토리에 YAML 파일로 워크플로우 템플릿을 정의합니다:

```yaml
title: 시장 조사
objective: "{{topic}}에 대한 종합 시장 분석"

phases:
  - phase_id: research
    title: 시장 조사
    agents:
      - role: 시장조사관
        backend: openrouter
        model: gpt-5.1-codex-max
        system_prompt: "시장 규모, 성장률, 트렌드를 분석하라."
        tools: [web_search]
      - role: 기술분석가
        backend: openrouter
        system_prompt: "기술 스택, 특허, 기술 트렌드를 분석하라."
    critic:
      backend: openrouter
      system_prompt: "모든 분석의 논리적 일관성, 데이터 근거, 누락 항목을 검토하라."
      gate: true

  - phase_id: strategy
    title: 전략 수립
    context_template: |
      ## 이전 페이즈 결과
      {{#each prev_phase.agents}}
      ### {{this.label}}
      {{this.result}}
      {{/each}}
    agents:
      - role: 전략가
        ...
```

### 페이즈 실패 정책

페이즈 내 에이전트 일부가 실패할 때의 동작을 per-phase로 설정할 수 있습니다:

| 정책 | 동작 | 사용 사례 |
|------|------|----------|
| `fail_fast` | 하나라도 실패 → 페이즈 즉시 실패 | 모든 에이전트 결과가 필수 |
| `best_effort` (기본) | 가능한 에이전트만으로 계속 진행 | 분석/조사 (일부 누락 허용) |
| `quorum` | N개 이상 성공 시 진행 | 투표/합의 기반 결정 |

### Critic 거절 시 동작

Critic이 승인을 거절하면 per-critic 설정에 따라 동작합니다:

| 전략 | 동작 |
|------|------|
| `retry_all` | 전체 에이전트 재실행 (critic 피드백 주입) |
| `retry_targeted` | critic이 지목한 에이전트만 재실행 |
| `escalate` (기본) | 사용자에게 결정 위임 — Continue / Retry / Abort 선택 |

### 동적 워크플로우 생성

매칭되는 YAML 템플릿이 없으면 분류기가 자동으로 워크플로우를 생성합니다:

1. 분류기가 `phase` 모드로 판별
2. `workspace/workflows/` 탐색 → 매칭 없음
3. 워크플로우 플래너가 에이전트 역할/수를 자동 결정
4. 사용자에게 미리보기 제시 → 승인 후 실행 (자동 실행 금지)

### Workflows API

| 엔드포인트 | 기능 |
|-----------|------|
| `GET /api/workflows` | 워크플로우 목록 |
| `GET /api/workflows/:id` | 워크플로우 상세 (전체 `PhaseLoopState`) |
| `POST /api/workflows` | 워크플로우 생성/실행 |
| `POST /api/workflows/:id/cancel` | 워크플로우 취소 |
| `GET /api/workflows/:id/phases/:pid/agents/:aid/messages` | 에이전트 대화 조회 |
| `POST /api/workflows/:id/phases/:pid/agents/:aid/messages` | 에이전트에 메시지 전송 |
| `POST /api/workflows/:id/phases/:pid/agents/:aid/retry` | 에이전트 재실행 |
| `POST /api/workflows/:id/phases/:pid/critic/messages` | critic에 메시지 전송 |

## Secrets 페이지

AES-256-GCM으로 암호화된 민감정보를 관리합니다.
- 시크릿 목록 (값은 가려짐)
- 추가 · 삭제 · Reveal (복호화 확인)
- 에이전트는 참조명으로만 접근 — 실제 값은 도구 실행 경로에서만 복호화

## 실시간 피드

Overview 페이지는 SSE(Server-Sent Events)로 실시간 이벤트를 표시합니다. `SseManager`가 다음 이벤트를 브로드캐스트합니다:

| SSE 이벤트 | 용도 |
|-----------|------|
| `process` | 실행 시작/종료 |
| `message` | 인바운드/아웃바운드 메시지 (최근 40개 유지) |
| `cron` | 크론 잡 이벤트 |
| `progress` | 진행 상황 |
| `task` | 태스크 상태 변경 |
| `web_stream` | 웹 채팅 스트리밍 |
| `agent` | 에이전트 이벤트 (slim 필드만) |

Phase Loop 실행 시 추가 이벤트:

| SSE 이벤트 | 용도 |
|-----------|------|
| `workflow_started` | 워크플로우 실행 시작 |
| `phase_started` / `phase_completed` | 페이즈 시작/완료 |
| `agent_started` / `agent_completed` / `agent_failed` | 에이전트 시작/완료/실패 |
| `agent_message` | 에이전트 대화 메시지 (실시간) |
| `critic_started` / `critic_completed` / `critic_rejected` | critic 검토 시작/완료/거절 |
| `workflow_completed` / `workflow_failed` | 워크플로우 완료/실패 |

## 백엔드 아키텍처

대시보드 백엔드는 다음 서비스로 분리되어 있습니다:

| 서비스 | 역할 |
|--------|------|
| `RouteContext` | 라우트 핸들러 공통 컨텍스트 (req/res + `json()`, `read_body()`, `add_sse_client()` 등 액션 함수) |
| `SseManager` | SSE 클라이언트 관리 + 7종 이벤트 브로드캐스트 |
| `StateBuilder` | 대시보드 상태 순수 조립 함수 (`build_dashboard_state`, `build_merged_tasks`) |
| `StaticServer` | SPA 정적 자산 서빙 + `index.html` fallback (html: no-store, 나머지: immutable) |
| `MediaTokenStore` | 토큰 기반 미디어 서빙 (workspace 외부 경로 차단, 1시간 TTL) |
| `OpsFactory` | 11개 도메인별 ops 객체 팩토리 (template, channel, agent-provider, bootstrap, memory, workspace, oauth, config, skill, tool, cli-auth) |

22개 라우트 핸들러가 `src/dashboard/routes/`에 분리되어 있으며, 각 라우트는 `async (ctx: RouteContext) => boolean` 패턴을 따릅니다.

## 접근 제한

기본적으로 `127.0.0.1`에만 바인딩됩니다. 외부 접근이 필요하면 대시보드 → **Settings** → `dashboard` 섹션에서 호스트와 포트를 변경하세요.

> **주의**: 외부 바인딩은 인증 없이 공개됩니다.

## 트러블슈팅

| 증상 | 확인 |
|------|------|
| 접속 불가 | Settings에서 포트 변경 또는 포트 충돌 프로세스 종료 |
| 실시간 피드 끊김 | 브라우저 새로고침, 방화벽/프록시 SSE 차단 확인 |
| 설정 저장 안 됨 | 파일 권한 확인 (`workspace/templates/` 쓰기 권한) |

## 관련 문서

→ [프로바이더 설정](./providers.md)
→ [OAuth 연동](./oauth.md)
→ [워크플로우 가이드](./workflows.md)
→ [Heartbeat 설정](./heartbeat.md)
