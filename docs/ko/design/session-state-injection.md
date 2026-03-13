# 설계: Session CD Collaborator 주입 (Phase 4.3)

> **상태**: 구현 완료 · `session_cd`를 필수 collaborator 주입으로 전환

## 개요

서비스 분해 완성: 마지막 인라인 상태 생성 (`session_cd`)을 `OrchestrationService`에서 제거하고 의존성 주입을 통해 collaborator로 분리.

유지 사항:
- 의미 보존 (CD 점수 계산 규칙 변경 없음)
- 공개 API 계약 (`get_cd_score()`, `reset_cd_score()` 유지)
- bootstrap이 collaborator 생명주기를 명시적으로 소유

## 문제 정의

`OrchestrationService`의 유일한 인라인 상태 생성:
```typescript
private readonly session_cd = create_cd_observer();  // 인라인 생성
```

제약 사항:
- 테스트에서 custom/mock CD observer 주입 불가
- 세션 상태의 외부 생명주기 관리 불가
- 완전한 의존성 주입 패턴 미달성

다른 모든 의존성은 이미 `OrchestrationServiceDeps`로 주입됨.

## 솔루션 아키텍처

### 모듈 구조

**수정 파일**: `src/orchestration/service.ts`

`CDObserver` 인터페이스가 이미 필요한 계약을 정의:
```typescript
export type CDObserver = {
  observe: (event: AgentEvent) => CDEvent | null;
  get_score: () => { total: number; events: CDEvent[] };
  reset: () => void;
};
```

### 의존성 주입 패턴

**수정**: `src/orchestration/service.ts`

```typescript
// 1. CDObserver 타입 import
import { type CDObserver } from "../agent/cd-scoring.js";

// 2. OrchestrationServiceDeps에 required session_cd 추가
export type OrchestrationServiceDeps = {
  // ... 기존 필드
  /** 세션 CD 관찰자. bootstrap에서 반드시 주입한다. */
  session_cd: CDObserver;
  // ...
};

// 3. 클래스 필드 타입 명시
private readonly session_cd: CDObserver;

// 4. 생성자 주입
constructor(deps: OrchestrationServiceDeps) {
  // ...
  this.session_cd = deps.session_cd;
  // ...
}
```

### 주요 특징

- **필수 주입**: `session_cd: CDObserver` → service 내부 인라인 생성 제거
- **명시적 생명주기**: bootstrap이 observer 생성/소유 책임을 가짐
- **모든 내부 접근 불변**: 내부 경로는 `this.session_cd`로 동일

## 테스트 커버리지

**신규 파일**: `tests/orchestration/session-state.test.ts` (6개 테스트)

계약 검증:
- `CDObserver` 타입 정의됨 ✓
- `OrchestrationServiceDeps.session_cd` required 필드 포함 ✓
- 공개 메서드 (`get_cd_score()`, `reset_cd_score()`) 유지 ✓
- Collaborator 주입 패턴 작동 ✓

**회귀 테스트**: 309 tests 통과 (신규 6 + 기존 303)

## 의미 보존 체크리스트

✅ CD 점수 규칙 변경 없음:
- `observe()` 동작 불변
- `get_score()` 계산 불변
- `reset()` 기능 불변

✅ 공개 API 불변:
- `get_cd_score()` 반환 구조 동일
- `reset_cd_score()` 상태 초기화 동일

✅ 통합 불변:
- `hooks_deps.session_cd` → `build_agent_hooks` 전달 동일
- `runner_deps.session_cd` → 모든 runner 전달 동일
- Tool 이벤트 관찰 경로 불변

✅ 조립 책임 명시:
- `session_cd` 생성 책임은 service가 아니라 bootstrap이 소유
- `new OrchestrationService(deps)`는 항상 완전한 collaborator 세트를 받음
- 인라인 `create_cd_observer()` 경로 제거

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/orchestration/service.ts` | +import CDObserver, +OrchestrationServiceDeps 필수 필드 추가, ~생성자 주입 패턴 |
| `tests/orchestration/session-state.test.ts` | **NEW** (6개 테스트: 타입 계약 + 주입 검증) |
| `docs/LARGE_FILE_SPLIT_DESIGN.md` | Phase 4.3 완료 상태 업데이트 |

## 검증

✅ TypeScript 컴파일: `npx tsc -p tsconfig.json --noEmit`
✅ 테스트 스위트: 309 tests 통과 (22개 테스트 파일)
✅ bootstrap 명시 주입 경로 검증 완료

## OrchestrationService의 상태

Phase 4.1, 4.2, 4.3 후:
- **인라인 상태**: 0 (모두 주입 또는 lazy init으로 이동)
- **주입된 상태**: hitl_store, session_cd (collaborators)
- **Lazy 초기화 상태**: _renderer (캐싱만)
- **추출된 로직**: run_once, run_agent_loop, run_task_loop, continue_task_loop, run_phase_loop
- **남은 메서드**: execute(), 보안 helper, 시스템 프롬프트 빌더, renderer 관리, 결과 변환

서비스는 이제 주로 다음을 수행하는 조정자/facade:
1. `execute()`를 통해 요청 수신
2. Stateful collaborators 관리 (hitl_store, session_cd)
3. 추출된 모듈 레벨 함수로 실행 위임
4. 요청 전처리 및 응답 최종화

## 후속 작업

- `session_cd`를 service 내부 상태가 아니라 injected collaborator로 유지
- bootstrap 외 경로에서 observer를 임의 생성하지 않도록 방지
- 관련 테스트에서 fallback 생성에 의존하는 가정이 다시 생기지 않도록 회귀 고정
