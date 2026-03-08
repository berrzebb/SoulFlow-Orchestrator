# 설계: Execute Dispatcher 추출 (Phase 4.5)

> **상태**: 구현 완료 · Execute dispatcher를 단일 모듈로 수렴

## 개요

`OrchestrationService.execute()` 중반부의 dispatcher 로직을 `execute-dispatcher.ts` 모듈로 분리.
gateway 라우팅 → identity/builtin/inquiry short-circuit → phase/once/agent/task 분기 → finalize를 한 코드 경로로 수렴.

유지:
- Semantic 보존 (gateway → short-circuit → mode 분기 → finalize)
- Public API contract (`execute()` 시그니처 변경 없음)
- 의존성 주입 패턴으로 테스트 용이성

## 문제 정의

`OrchestrationService.execute()`가 ~180줄의 dispatcher 로직을 포함:
- L374–401: Gateway 라우팅 결정
- L403–417: Short-circuit 분기 (identity/builtin/inquiry 조기 반환)
- L422–436: finalize 클로저 (이벤트 로깅 + process tracker)
- L438–459: Mode 분기 (phase / once / agent / task)
- L480–526: 에스컬레이션 + executor fallback

이 inline 로직이 방지하는 것:
- Dispatcher를 독립적으로 테스트
- 다른 맥락에서 dispatcher 계산 재사용
- "데이터 수집"과 "실행 분기" 분리

## 솔루션 아키텍처

### 모듈 구조

**파일**: `src/orchestration/execution/execute-dispatcher.ts`

```typescript
// 의존성 주입 타입
export type ExecuteDispatcherDeps = {
  providers: ProviderRegistry;
  runtime: AgentRuntimeLike;
  logger: Logger;
  config: {
    executor_provider: ExecutorProvider;
    provider_caps?: ProviderCapabilities;
  };
  process_tracker: ProcessTrackerLike | null;
  guard: ConfirmationGuard | null;
  tool_index: ToolIndex | null;
  log_event: (input: AppendWorkflowEventInput) => void;
  build_identity_reply: () => string;
  build_system_prompt: (names: string[], provider: string, chat_id: string, cats?: ReadonlySet<string>, alias?: string) => Promise<string>;
  generate_guard_summary: (task_text: string) => Promise<string>;
  run_once: (args: RunExecutionArgs) => Promise<OrchestrationResult>;
  run_agent_loop: (args: RunExecutionArgs & { media: string[]; history_lines: string[] }) => Promise<OrchestrationResult>;
  run_task_loop: (args: RunExecutionArgs & { media: string[] }) => Promise<OrchestrationResult>;
  run_phase_loop: (req: OrchestrationRequest, task_with_media: string, workflow_hint?: string, node_categories?: string[]) => Promise<OrchestrationResult>;
  caps: () => ProviderCapabilities;
};

// 메인 함수
export async function execute_dispatch(
  deps: ExecuteDispatcherDeps,
  req: OrchestrationRequest,
  preflight: ReadyPreflight,
): Promise<OrchestrationResult>
```

### 주요 특징

- **의존성 주입**: 모든 외부 호출이 deps의 함수 참조로 제공됨
- **Semantic 보존**: gateway 라우팅 → short-circuit → mode 분기 → finalize 순서 유지
- **타입 안전성**: ReadyPreflight discriminated union으로 ready 상태 필드만 접근 가능
- **Lazy evaluation**: 도구 선택과 시스템 프롬프트 빌드는 필요할 때만 실행
- **finalize 클로저**: 이벤트 로깅과 process tracker 업데이트를 최종 단계로 포장

### 통합

**수정**: `src/orchestration/service.ts`

```typescript
// 1. _dispatch_deps() 메서드 추가
private _dispatch_deps(): ExecuteDispatcherDeps {
  return {
    providers: this.providers,
    runtime: this.runtime,
    logger: this.logger,
    config: { executor_provider: this.config.executor_provider, provider_caps: this.config.provider_caps },
    process_tracker: this.process_tracker,
    guard: this.guard,
    tool_index: this.tool_index,
    log_event: (e) => this.log_event(e),
    build_identity_reply: () => this._build_identity_reply(),
    build_system_prompt: (names, prov, chat, cats, alias) => this._build_system_prompt(names, prov, chat, cats, alias),
    generate_guard_summary: (text) => this._generate_guard_summary(text),
    run_once: (args) => _run_once(this._runner_deps(), args),
    run_agent_loop: (args) => _run_agent_loop(this._runner_deps(), args),
    run_task_loop: (args) => _run_task_loop(this._runner_deps(), args),
    run_phase_loop: (req, task, hint, cats) => _run_phase_loop(this._phase_deps(), req, task, hint, cats),
    caps: () => this._caps(),
  };
}

// 2. execute() 단순화
async execute(req: OrchestrationRequest): Promise<OrchestrationResult> {
  const preflight = await run_request_preflight(this._preflight_deps(), req);

  if (preflight.kind === "resume") {
    return this.continue_task_loop(req, preflight.resumed_task, preflight.task_with_media, preflight.media);
  }

  if (!preflight.secret_guard.ok) {
    return { reply: format_secret_notice(preflight.secret_guard), mode: "once", tool_calls_count: 0, streamed: false };
  }

  return execute_dispatch(this._dispatch_deps(), req, preflight);
}

// 3. 제거 메서드
// - run_once
// - run_agent_loop
// - run_task_loop
// - run_phase_loop
```

## 테스트 커버리지

**파일**: `tests/orchestration/execute-dispatcher.test.ts` (7개 structural 테스트)

계약 검증:
- dispatcher가 ExecuteDispatcherDeps를 수신 ✓
- dispatcher가 모든 필드를 가진 ReadyPreflight를 수신 ✓
- 의존성 주입 패턴 동작 (build_identity_reply callable) ✓
- run_once를 RunExecutionArgs로 호출 가능 ✓
- log_event를 이벤트 기록으로 호출 가능 ✓
- finalize 클로저가 done/blocked 이벤트 기록 ✓
- ReadyPreflight discriminated union 타입 사용 가능 ✓

**회귀 테스트**: 316+ 테스트 통과 (7개 신규 + 309개 기존)

## Semantic 보존 체크리스트

✅ **Gateway 라우팅 먼저**: active_tasks_in_chat → resolve_gateway 결정
✅ **Short-circuit 조기 반환**: identity/builtin/inquiry 분기가 도구 선택 전 종료
✅ **finalize로 결과 포장**: done/blocked 이벤트 로깅 + process_tracker 정리
✅ **Mode 분기 분리**: phase는 도구 선택 전에 분기, once/agent/task는 후에
✅ **에스컬레이션 보존**: once → task, agent → task 에스컬레이션 로직 유지
✅ **Executor fallback**: claude_code → chatgpt fallback (사용 가능할 때)
✅ **Public API**: `execute()` 시그니처 변경 없음, 반환 타입 변경 없음

## 수정 파일 요약

| 파일 | 변경 |
|------|------|
| `src/orchestration/execution/execute-dispatcher.ts` | **NEW** (300+ LOC: 타입 + 메인 함수) |
| `src/orchestration/service.ts` | 4개 메서드 제거 (run_once, run_agent_loop, run_task_loop, run_phase_loop), dead code 4개 함수 제거, execute() 단순화, _dispatch_deps() 추가 |
| `tests/orchestration/execute-dispatcher.test.ts` | **NEW** (7개 structural 테스트) |
| `docs/en/design/execute-dispatcher.md` | **NEW** |
| `docs/ko/design/execute-dispatcher.md` | **NEW** |
| `docs/LARGE_FILE_SPLIT_DESIGN.md` | Phase 4.5 완료 상태 |

## 검증

✅ TypeScript: `npx tsc -p tsconfig.json --noEmit`
✅ 테스트: `npx vitest run tests/orchestration/execute-dispatcher.test.ts` (7/7 통과)
✅ 전체 테스트: 316+ 테스트 통과 (회귀 없음)

## OrchestrationService의 상태

Phase 4.1–4.5 완료 후:
- **Inline 상태**: 0 (모두 주입됨: hitl_store, session_cd, dispatcher 로직)
- **Preprocessing**: request-preflight 모듈로 이동
- **Dispatching**: execute-dispatcher 모듈로 이동
- **추출된 로직**: run_once, run_agent_loop, run_task_loop, continue_task_loop, run_phase_loop
- **남은 메서드**: execute() dispatcher 진입점, security/prompt/renderer 헬퍼, 상태 관리

현재 서비스는:
1. 의존성 컨테이너 (_preflight_deps, _runner_deps, _continue_deps, _phase_deps, _dispatch_deps)
2. 오케스트레이션 파사드 (execute 라우팅 + 최종화)
3. Stateful collaborator 홀더 (hitl_store, session_cd)

## 다음 단계

**Phase 4.6** (필요 시): execute() dispatcher 분기 로직 추출
- resolve_gateway 결과 분기를 finalize에서 분리
- gateway 결정 결과 처리를 dedicated collaborator로 이동

## 설계 결정

1. **Wrapper 메서드 대신 함수 참조**: _dispatch_deps()가 함수 참조를 반환하여 cleaner 의존성 그래프
2. **Deps 패러미터 패턴**: RunnerDeps 패턴을 따라 executor 모듈 간 일관성
3. **Optional process_tracker/guard**: null collaborator를 gracefully 처리 (composable 설계)
4. **최적화 대신 semantic 보존**: Heavy context를 finalize 클로저에서도 계산 (명확성 > 마이크로 최적화)
5. **ReadyPreflight만**: Dispatcher는 ReadyPreflight만 수신 (resume/secret_guard는 dispatch 전에 처리)
