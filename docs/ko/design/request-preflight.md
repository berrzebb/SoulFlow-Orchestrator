# 설계: Request Preflight 추출 (Phase 4.4)

> **상태**: 구현 완료 · Request preprocessing을 단일 모듈로 수렴

## 개요

`OrchestrationService.execute()` 초반부의 request preprocessing 로직을 `request-preflight.ts` 모듈로 분리.
`seal_text`, `seal_list`, `inspect_secrets`, `resolve_context_skills`, `collect_skill_tool_names`, context 조립을 한 코드 경로로 수렴.

유지:
- Semantic 보존 (seal → resumed 분기 → heavy context)
- Public API contract (`execute()` 시그니처 변경 없음)
- Discriminated union 반환 타입으로 타입 안전성

## 문제 정의

`OrchestrationService.execute()`가 ~60줄의 preprocessing 로직을 포함:
- L354-356: 입력 seal (텍스트 + 배열)
- L359-364: Resumed task 분기
- L366-369: Skill 해석 + secret 검증
- L374-391: Context 조립

이 inline 로직이 방지하는 것:
- Preflight을 독립적으로 테스트
- 다른 맥락에서 preflight 계산 재사용
- "데이터 수집"과 "실행" 분리

## 솔루션 아키텍처

### 모듈 구조

**파일**: `src/orchestration/request-preflight.ts`

```typescript
// 타입
export type RequestPreflightDeps = {
  vault: SecretVaultService;
  runtime: AgentRuntimeLike;
  policy_resolver: RuntimePolicyResolver;
  workspace: string | undefined;
  tool_index: ToolIndex | null;
};

export type ResumedPreflight = {
  kind: "resume";
  task_with_media: string;
  media: string[];
  resumed_task: TaskState;
};

export type ReadyPreflight = {
  kind: "ready";
  task_with_media: string;
  media: string[];
  skill_names: string[];
  secret_guard: { ok: boolean; missing_keys: string[]; invalid_ciphertexts: string[] };
  runtime_policy: RuntimeExecutionPolicy;
  // ... 나머지 context
};

export type RequestPreflightResult = ResumedPreflight | ReadyPreflight;

// 메인 함수
export async function run_request_preflight(
  deps: RequestPreflightDeps,
  req: OrchestrationRequest,
): Promise<RequestPreflightResult>;

// Export된 헬퍼 (continue_task_loop에서 재사용)
export function collect_skill_provider_prefs(
  runtime: AgentRuntimeLike,
  skill_names: string[],
): string[];
```

### 주요 특징

- **Discriminated union**: `preflight.kind`로 분기 (nested if 대신)
- **Semantic 보존**: `seal → resumed 분기 → heavy context` 순서 유지
- **Module-internal 헬퍼**: `seal_text`, `seal_list` 등 export 안 함
- **Lazy context**: Context 조립은 `kind: "ready"` 경로에서만

### 통합

**수정**: `src/orchestration/service.ts`

```typescript
// 1. 생성자에 _preflight_deps() 추가
private _preflight_deps(): RequestPreflightDeps {
  return {
    vault: this.vault,
    runtime: this.runtime,
    policy_resolver: this.policy_resolver,
    workspace: this.deps.workspace,
    tool_index: this.tool_index,
  };
}

// 2. execute() 한 줄로 단순화
async execute(req: OrchestrationRequest): Promise<OrchestrationResult> {
  const preflight = await run_request_preflight(this._preflight_deps(), req);

  if (preflight.kind === "resume") {
    return this.continue_task_loop(req, preflight.resumed_task, preflight.task_with_media, preflight.media);
  }

  if (!preflight.secret_guard.ok) {
    return { reply: format_secret_notice(preflight.secret_guard), mode: "once", ... };
  }

  const { task_with_media, media, skill_names, ... } = preflight;
  // Gateway 라우팅은 preflight 데이터로 계속
}

// 3. _continue_deps() 업데이트
collect_skill_provider_preferences: (names) => collect_skill_provider_prefs(this.runtime, names),
```

## 테스트 커버리지

**파일**: `tests/orchestration/request-preflight.test.ts` (7개 테스트)

계약 검증:
- 정상 경로에서 `kind: "ready"` 반환 ✓
- ReadyPreflight이 모든 context 필드 포함 ✓
- `collect_skill_provider_prefs`가 중복 제거 ✓

**회귀 테스트**: 309+ 테스트 통과 (7개 신규 + 302개 기존)

## Semantic 보존 체크리스트

✅ **Seal 순서 보존**: 텍스트 seal → 배열 seal (inline 메서드 제거, 로직 통합)
✅ **Resumed 분기**: Seal 후, heavy 계산 전 확인
✅ **Secret 검증**: `ok: false`일 때 조기 반환
✅ **Context 조립**: `kind: "ready"`일 때만 계산
✅ **Public API**: `execute()` 시그니처와 동작 변경 없음

## 수정 파일 요약

| 파일 | 변경 |
|------|------|
| `src/orchestration/request-preflight.ts` | **NEW** (350 LOC: 타입 + 메인 함수 + 5개 헬퍼) |
| `src/orchestration/service.ts` | 6개 메서드 제거, execute() 단순화, _preflight_deps() 추가, _continue_deps() 업데이트 |
| `tests/orchestration/request-preflight.test.ts` | **NEW** (7개 테스트) |
| `docs/LARGE_FILE_SPLIT_DESIGN.md` | Phase 4.4 완료 상태 업데이트 |

## 검증

✅ TypeScript: `npx tsc -p tsconfig.json --noEmit`
✅ 테스트: `npx vitest run tests/orchestration/request-preflight.test.ts` (7/7 통과)
✅ 전체 테스트: 309+ 테스트 통과 (회귀 없음)

## OrchestrationService의 상태

Phase 4.1–4.4 완료 후:
- **Inline 상태**: 0 (모두 주입됨: hitl_store, session_cd)
- **Preprocessing**: request-preflight 모듈로 이동
- **추출된 로직**: run_once, run_agent_loop, run_task_loop, continue_task_loop, run_phase_loop
- **남은 메서드**: execute() 디스패처, security 헬퍼, 시스템 프롬프트 빌더, renderer 관리

현재 서비스는:
1. 의존성 컨테이너 (`_preflight_deps()`, `_runner_deps()`, `_continue_deps()`, `_phase_deps()`)
2. 오케스트레이션 파사드 (`execute()` 라우팅 + 결과 최종화)
3. Stateful collaborator 홀더 (hitl_store, session_cd)

## 다음 단계

**Phase 4.5**: execute() 디스패처 로직 추출
- `resolve_gateway()` 결과 분기
- Mode 라우팅 (phase/once/agent/task)
- 최종화 + 이벤트 로깅

## 설계 결정

1. **Discriminated Union vs 조건**: `kind: "resume" | "ready"`로 타입 불안전 분기 방지
2. **Module-Level 헬퍼**: seal_text, build_context_message는 export 안 함 (내부 계약)
3. **Optional tool_index**: ToolIndex는 null 가능 (우아한 기능 저하)
4. **Semantic vs 최적화**: Heavy context는 조기 분기에서도 계산 (미시 최적화보다 명확성)
