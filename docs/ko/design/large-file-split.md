# 대형 파일 구조 분해 설계

> 상태: 구현 완료 · 유지보수용 한국어 미러  
> 기준본: `docs/LARGE_FILE_SPLIT_DESIGN.md`

## 목적

이 문서는 거대 파일을 단순히 보기 좋게 나누는 것이 아니라,
변경 취약점을 줄이면서 구조를 안전하게 분해하기 위한 설계 요약이다.

핵심 목표는 두 가지다.

- 실제 런타임 의미를 깨지 않고 조립 경계를 명확히 만든다.
- 자동화된 개발 파이프라인이라는 제품 목표를 훼손하지 않는 방식으로 분해한다.

## 핵심 판단

`bootstrap` 분리는 유효하다.
단, `bootstrap`은 새 거대 폴더가 아니라 조립 계층이어야 한다.

허용 범위:

- 객체 생성 순서 고정
- runtime bundle 조립
- startup/shutdown lifecycle 제어

비허용 범위:

- business rule
- workflow execution logic
- channel/provider/domain 정책
- dashboard route logic
- tool/node registry semantics

## 전제

이 프로젝트는 다음 성격을 가진다.

- 채널/대시보드를 통한 대화형 AI 운영
- 일반 업무 처리와 워크플로우 자동 생성/실행
- Kanban 기반 진행 관리
- 에이전트 간 협업
- 결정적/반복 작업의 도구화
- tool/node 자동 생성 스크립트 기반 확장

따라서 큰 파일의 문제는 줄 수가 아니라 다음과 같은 변경 취약점이다.

- 초기화 순서 의존성
- 종료 순서 의존성
- 조립 단계에 남아 있는 deferred binding
- 상태 저장과 부작용이 같은 파일에 섞인 구조
- 생성기/레지스트리/실행기의 정합성 붕괴 위험

## 구조 분해 결과 요약

### Phase 2. 저위험 분할

완료.

- `src/dashboard/ops-factory.ts`는 facade로 축소
- 구현은 `src/dashboard/ops/` 아래로 이동

### Phase 3. 조립 분할

완료.

`main.ts`의 주요 bootstrap bundle은 `src/bootstrap/` 아래로 이동했다.

- `config.ts`
- `runtime-paths.ts`
- `providers.ts`
- `runtime-data.ts`
- `agent-core.ts`
- `channels.ts`
- `channel-wiring.ts`
- `orchestration.ts`
- `workflow-ops.ts`
- `dashboard.ts`
- `runtime-tools.ts`
- `trigger-sync.ts`
- `services.ts`
- `lifecycle.ts`

현재 `main.ts`에 남아 있는 것은 composition root가 직접 보유해도 되는 최종 단계다.

- `RuntimeApp` 반환 조립
- main entry boot / lock / shutdown wiring

### Phase 4. 실행 분할

완료.

- `Phase 4.1`: execution runners 분리
- `Phase 4.2`: phase workflow 경로 분리
- `Phase 4.3`: `session_cd` state holder 분리
- `Phase 4.4`: request preflight 분리
- `Phase 4.5`: execute dispatcher 분리

주요 결과:

- `src/orchestration/execution/run-once.ts`
- `src/orchestration/execution/run-agent-loop.ts`
- `src/orchestration/execution/run-task-loop.ts`
- `src/orchestration/execution/continue-task-loop.ts`
- `src/orchestration/execution/phase-workflow.ts`
- `src/orchestration/execution/execute-dispatcher.ts`
- `src/orchestration/request-preflight.ts`

## 현재 상태

구조 분해 phase는 완료 상태다.

현재 기준 주요 파일 규모:

- `src/main.ts`: composition root 수준으로 축소
- `src/dashboard/ops-factory.ts`: re-export facade 수준
- `src/orchestration/service.ts`: facade 역할 중심으로 축소

이제 남은 작업은 구조 분해가 아니라 안정화 단계다.

- 회귀 테스트 보강
- import/cleanup 정리
- 새 경계에 대한 문서 동기화

## 유지 원칙

구조 분해 후에도 다음 원칙을 유지해야 한다.

- facade 유지
- public contract 고정
- side effect ordering 보존
- stateful object는 마지막에 분리
- 구조 변경과 기능 변경 분리

## 권장 후속 작업

1. bootstrap / execution 경계에 대한 characterization test 보강
2. `OrchestrationService.execute()` 대표 시나리오 회귀 테스트 보강
3. 새로 생긴 bootstrap/execution 모듈의 import cycle 감시
4. 후속 기능 작업은 새 경계 위에서만 진행
