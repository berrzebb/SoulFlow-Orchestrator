# 설계: Phase Workflow 추출 (Phase 4.2)

> **상태**: 구현 완료 · Phase workflow 경로 OrchestrationService에서 분리

## 개요

**phase workflow 실행 경로**를 `OrchestrationService`에서 독립 모듈 `src/orchestration/execution/phase-workflow.ts`로 추출.
Phase 4.1 실행 runner 추출과 동일한 패턴 적용.

유지 사항:
- 의미 보존 (정책 변경 금지, 예외처리 방식 변경 금지)
- 공개 API 계약 (OrchestrationService.execute() 유지)
- 계약 검증을 통한 테스트 가능성

## 문제 정의

`OrchestrationService`가 5가지 관심사를 혼합:
1. 요청 sealing과 보안 preflight
2. 모드 라우팅 (once/agent/task/phase 분기)
3. Runner 실행 (Phase 4.1 추출)
4. Phase workflow 조직화 (Phase 4.2 대상)
5. 상태 관리 (phase_pending_responses, session_cd)

이 혼합은 변경 취약점을 유발: phase workflow 로직 수정이 다른 실행 모드에 영향을 줄 수 있음.

## 솔루션 아키텍처

### 모듈 구조

**신규 파일**: `src/orchestration/execution/phase-workflow.ts` (~290줄)

```typescript
export type PhaseWorkflowDeps = {
  // 핵심 의존성
  providers: ProviderRegistry;
  runtime: AgentRuntimeLike;
  logger: Logger;

  // 워크스페이스 및 경로 컨텍스트
  workspace: string;
  process_tracker: ProcessTrackerLike | null;

  // Phase workflow 인프라
  subagents: SubagentRegistry | null;
  phase_workflow_store: PhaseWorkflowStoreLike | null;
  bus: MessageBusLike | null;

  // 상태 관리
  hitl_store: HitlPendingStore;

  // SSE 브로드캐스트 및 HITL 렌더링 콜백
  get_sse_broadcaster: (() => { broadcast_workflow_event(...): void } | null) | undefined;
  render_hitl: (body: string, type: HitlType) => string;

  // 선택사항: 결정/약속 서비스
  decision_service: DecisionService | null;
  promise_service: PromiseService | null;

  // 노드 실행 의존성 (노드 핸들러로 전달)
  embed: ((texts, opts) => Promise<...>) | undefined;
  vector_store: ((op, opts) => Promise<...>) | undefined;
  oauth_fetch: ((service_id, opts) => Promise<...>) | undefined;
  get_webhook_data: ((path) => Promise<...>) | undefined;
  wait_kanban_event: ((board_id, filter) => Promise<...>) | undefined;
  create_task: ((opts) => Promise<...>) | undefined;
  query_db: ((datasource, query, params?) => Promise<...>) | undefined;
};

export async function run_phase_loop(
  deps: PhaseWorkflowDeps,
  req: OrchestrationRequest,
  task_with_media: string,
  workflow_hint?: string,
  node_categories?: string[],
): Promise<OrchestrationResult>;
```

### 추출된 함수

| 함수 | 목적 | 범위 |
|------|------|------|
| `run_phase_loop` | **Export됨** 진입점 · 템플릿 로딩 또는 동적 워크플로우 생성 조정 | 공개 API |
| `generate_dynamic_workflow` | LLM 기반 자연어 hint 워크플로우 생성 | 모듈 내부 |
| `format_workflow_preview` | 워크플로우 미리보기 텍스트 포맷팅 | 모듈 내부 |
| `build_phase_channel_callbacks` | phase 노드용 send_message/ask_channel 콜백 빌더 | 모듈 내부 |
| `format_phase_summary` | phase 결과에서 최종 실행 요약 포맷팅 | 모듈 내부 |

### 서비스 통합

**수정**: `src/orchestration/service.ts`

```typescript
// 신규 private 헬퍼 메서드
private _phase_deps(): PhaseWorkflowDeps {
  return {
    providers: this.deps.providers,
    runtime: this.deps.runtime,
    logger: this.logger,
    workspace: this.workspace,
    process_tracker: this.deps.process_tracker,
    subagents: this.subagents,
    phase_workflow_store: this.phase_workflow_store,
    bus: this.bus,
    hitl_store: this.hitl_store,
    get_sse_broadcaster: this.deps.get_sse_broadcaster,
    render_hitl: (body, type) => this._render_hitl(body, type),
    decision_service: this.decision_service,
    promise_service: this.promise_service,
    embed: this.deps.embed,
    vector_store: this.deps.vector_store,
    oauth_fetch: this.deps.oauth_fetch,
    get_webhook_data: this.deps.get_webhook_data,
    wait_kanban_event: this.deps.wait_kanban_event,
    create_task: this.deps.create_task,
    query_db: this.deps.query_db,
  };
}

// 위임 패턴으로 구현 변경
private async run_phase_loop(req, task_with_media, workflow_hint?, node_categories?) {
  return _run_phase_loop(this._phase_deps(), req, task_with_media, workflow_hint, node_categories);
}

// 제거 (이제 모듈 내부):
// - generate_dynamic_workflow (53줄)
// - format_workflow_preview (12줄)
// - build_phase_channel_callbacks (56줄)
// - format_phase_summary (29줄)
```

**수정**: `src/orchestration/execution/index.ts`

```typescript
export { run_phase_loop, type PhaseWorkflowDeps } from "./phase-workflow.js";
```

## 테스트 커버리지

**신규 파일**: `tests/orchestration/phase-workflow.test.ts` (5개 테스트)

계약 검증:
- `run_phase_loop` exported 및 호출 가능 ✓
- 함수 파라미터 개수 (5개) ✓
- `PhaseWorkflowDeps` 타입 정의됨 ✓
- 필수 속성 포함 (providers, runtime, logger, workspace, hitl_store, render_hitl) ✓
- OrchestrationService가 추출 모듈을 import하고 위임 ✓

**회귀 테스트**: 대표 회귀 테스트와 타입 검증 기준 통과

## 의미 보존 체크리스트

✅ 정책 변경 없음:
- 워크플로우 로딩 로직 불변
- 동적 생성 프롬프트 불변
- 요약 포맷팅 불변

✅ 예외처리 방식 변경 없음:
- 에러 전파 불변
- HITL 에러 케이스 불변

✅ 이벤트 타이밍 변경 없음:
- SSE 브로드캐스트 타이밍 불변
- Phase 이벤트 발행 순서 불변

✅ 상태 관리:
- `hitl_store`는 service의 injected collaborator로 유지
- `session_cd`는 service의 injected collaborator로 유지

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/orchestration/execution/phase-workflow.ts` | **NEW** (~290줄) |
| `src/orchestration/execution/index.ts` | +2 exports (run_phase_loop, PhaseWorkflowDeps 타입) |
| `src/orchestration/service.ts` | -150줄 (5개 메서드 추출) + 1줄 위임 + _phase_deps() 빌더 |
| `tests/orchestration/phase-workflow.test.ts` | **NEW** (계약 검증) |
| `docs/LARGE_FILE_SPLIT_DESIGN.md` | Phase 4 상태 업데이트 |

## 검증

✅ TypeScript 컴파일: `npx tsc -p tsconfig.json --noEmit`
✅ 테스트 스위트: 301 tests 통과
✅ service.ts에서 미사용 import 제거 (now_iso, short_id)

## 후속 작업

- `run_phase_loop()` 위임 경로를 직접 잠그는 characterisation test를 계속 강화
- phase workflow 정책이 다시 `service.ts` 안으로 되돌아오지 않도록 경계 유지
- phase workflow와 service collaborator(`hitl_store`, `session_cd`)의 책임 분리를 유지
