# LARGE FILE SPLIT DESIGN

작성일: 2026-03-08
기준 코드베이스: 현재 저장소

## 목적

이 문서는 거대 파일을 단순히 보기 좋게 나누기 위한 문서가 아니다.

목표는 다음 두 가지다.

- 현재 코드에서 실제로 존재하는 변경 취약점을 더 키우지 않고 분할하는 것
- 자동화된 개발 파이프라인이라는 제품 목표를 훼손하지 않는 방식으로 분할하는 것

즉, 분할의 기준은 미학이 아니라 안정성이다.

## Bootstrap 분리에 대한 판단

`bootstrap` 분리는 현재 구조에서 유효한 방향이다.
다만 전제가 있다.

`bootstrap`은 "초기화 관련 코드를 몰아넣는 새 거대 파일/폴더"가 되면 안 된다.
`bootstrap`은 반드시 다음 역할로 제한해야 한다.

- 객체 생성 순서를 고정하는 composition layer
- runtime bundle을 조립하는 wiring layer
- startup/shutdown lifecycle을 통제하는 orchestration layer

반대로 `bootstrap`으로 가면 안 되는 것은 다음이다.

- business rule
- workflow execution logic
- channel/provider/domain 정책
- dashboard route logic
- tool/node registry semantics

즉, `bootstrap`은 실행 정책 계층이 아니라 조립 계층이어야 한다.

## 전제

이 프로젝트는 다음 성격을 가진다.

- 채널과 대시보드를 통한 대화형 AI 운영
- 일반 업무 처리와 워크플로우 자동 생성/실행
- Kanban 기반 진행 관리
- 에이전트 간 협업
- 결정적/반복 작업의 도구화
- tool/node의 자동 생성 스크립트 기반 확장

따라서 이 코드베이스에서 큰 파일은 단순히 "길다"는 이유만으로 문제가 되지 않는다.
문제는 다음과 같은 변경 취약점이다.

- 초기화 순서 의존성
- 종료 순서 의존성
- 조립 단계에 남아 있는 deferred binding
- 상태 저장과 부작용이 같은 파일에 섞여 있는 구조
- 생성기/레지스트리/실행기의 정합성 붕괴 위험

## 현재 상태

현재 코드는 구조 분해를 시작할 수 있는 상태다.

이전 pre-split blocker였던 다음 항목은 해소됐다.

- `channel_manager_ref` 제거
- `broadcaster.current` 제거
- `kanban_*` mutable holder 제거
- `ToolIndex` global singleton 제거
- shared dependency fallback 제거

현재 남아 있는 것은 분해 중 함께 정리할 수 있는 **국소적인 조립 단계**다.

- `channel_manager.set_workflow_hitl(...)`
- `active_run_controller.set_tracker(...)`
- `dashboard.current`의 optional service 반환/등록

즉, 지금은 blocker 해소 단계가 아니라 의미 보존형 분해 단계로 넘어가면 된다.

## 진행 상태

현재 구조 분해 진행 상태는 다음과 같다.

- `src/dashboard/ops-factory.ts`: 완료
- `src/main.ts`: 완료
- `src/orchestration/service.ts`: 부분 완료

현재 확인 기준:

- `ops-factory.ts`는 re-export facade로 축소되었고, 실제 구현은 `src/dashboard/ops/`로 이동했다.
- `main.ts`는 helper 추출 단계를 넘어서 주요 bootstrap bundle 상당수를 `src/bootstrap/`으로 추출했다.
  - `src/bootstrap/runtime-paths.ts`
  - `src/bootstrap/config.ts`
  - `src/bootstrap/providers.ts`
  - `src/bootstrap/runtime-data.ts`
  - `src/bootstrap/agent-core.ts`
  - `src/bootstrap/channels.ts`
  - `src/bootstrap/channel-wiring.ts`
  - `src/bootstrap/orchestration.ts`
  - `src/bootstrap/workflow-ops.ts`
  - `src/bootstrap/dashboard.ts`
  - `src/bootstrap/runtime-tools.ts`
  - `src/bootstrap/trigger-sync.ts`
  - `src/bootstrap/services.ts`
  - `src/bootstrap/lifecycle.ts`
- 현재 `main.ts`에 남아 있는 것은 composition root가 직접 가져도 되는 최종 단계다.
  - `RuntimeApp` 반환 조립
  - main entry boot / lock / shutdown wiring
- `src/orchestration/execution/` 아래로 runner 초안이 추출되었다.
  - `run-once.ts`
  - `run-agent-loop.ts`
  - `run-task-loop.ts`
  - `continue-task-loop.ts`
  - `helpers.ts`
  - `runner-deps.ts`
- `src/orchestration/service.ts`는 이제 추출된 runner 모듈을 실제 호출한다.
- runner 직접 테스트와 service 위임 테스트도 추가됐다.

따라서 다음 실제 작업의 중심은 `src/orchestration/service.ts`를 facade 유지형으로 분해하는 것이다.

## 실제로 거대 파일에서 보이는 취약점

### 1. `src/main.ts`는 조립, wiring, lifecycle, shutdown이 한 파일에 섞여 있다

이 파일은 단순한 composition root를 넘어선다.

현재 이 파일은 다음을 동시에 담당한다.

- workspace/app root 해석
- 기본 workflow 시드
- config/vault/provider store 초기화
- provider/backend 구성
- agent domain 생성
- channel/dispatch/session/media/approval/process tracker 구성
- orchestration 구성
- workflow ops와 dashboard 결합
- SSE relay
- shutdown signal 처리

이 구조에서 생기는 실제 취약점은 다음과 같다.

- 초기화 순서가 여전히 길고 암묵적이다.
- path/config/provider/channel/workflow/dashboard/startup이 한 함수 안에 밀집돼 있다.
- 일부 binding이 constructor 밖에서 후속 단계로 이어진다.
- startup logic과 shutdown logic이 같은 파일에서 강하게 결합돼 있어, 분해 시 lifecycle regression 위험이 높다.

이 파일의 취약점은 "너무 길다"가 아니라 "순서 의존성과 side effect 경계가 불명확하다"이다.

### 2. `src/orchestration/service.ts`는 coordinator이면서 executor이면서 state holder다

이 파일은 다음을 동시에 가진다.

- 요청 sealing 및 secret inspection
- context/tool selection/gateway 결정
- once/agent/task 실행
- phase loop 실행
- dynamic workflow 생성
- HITL bridge 및 pending response state
- event logging과 process tracker 연결

이 구조에서 생기는 실제 취약점은 다음과 같다.

- 실행 모드별 정책이 한 클래스 안에서 서로 영향을 준다.
- 상태(`session_cd`)와 실행 로직이 섞여 있다.
- phase workflow와 일반 once/agent/task 경로가 같은 변경 표면을 공유한다.
- 보안 전처리와 실행 전환 로직이 같은 진입점에서 얽혀 있어, 분할 시 semantic drift가 생기기 쉽다.

이 파일의 핵심 취약점은 "책임이 많다"가 아니라 "서로 다른 실패 모드가 같은 조정자에 붙어 있다"이다.

### 3. `src/dashboard/ops-factory.ts`는 도메인별로 분리 가능한데, 한 파일에 모여 있다

이 파일은 이미 exported factory 단위로 어느 정도 분리되어 있다.

현재 포함하는 영역:

- template ops
- channel ops
- agent provider ops
- bootstrap ops
- memory/workspace ops
- oauth/config/skill/tool/cli-auth/model/workflow ops

여기서의 취약점은 `main.ts`나 `orchestration/service.ts`보다 단순하다.

- 파일 하나가 너무 많은 dashboard entrypoint를 보유한다.
- 공유 helper와 도메인별 factory가 혼합돼 있다.
- 변경 충돌이 쉽게 난다.

다만 이 파일은 이미 export 경계가 명확하므로, 가장 먼저 안전하게 분할할 수 있는 파일이다.

## 분할 원칙

### 1. 의미 보존 우선

한 번에 구조와 동작을 동시에 바꾸지 않는다.

분할 단계에서는 다음을 금지한다.

- 정책 변경
- 예외 처리 방식 변경
- 설정 키 변경
- 이벤트 발행 타이밍 변경
- tool/node registry 동작 변경

### 2. public surface를 먼저 고정

분할 전에 기존 export와 호출 경로를 facade로 고정해야 한다.

예시:

- `createRuntime()`는 유지
- `OrchestrationService.execute()`는 유지
- `create_template_ops()` 같은 exported factory 이름은 유지

즉, 외부가 보는 표면은 먼저 고정하고 내부만 옮긴다.

### 3. pure logic와 side effect를 먼저 분리

이 프로젝트의 진짜 리스크는 side effect ordering이다.

따라서 분할 우선순위는 다음과 같다.

- path/option/DTO 계산
- object bundle 조립
- side effect start/stop

이 순서가 뒤집히면 회귀 가능성이 급격히 올라간다.

### 4. 남은 deferred binding은 bundle 내부 단계로 가둔다

이전의 큰 late holder 문제는 이미 정리됐다.
지금 남은 것은 작은 범위의 후속 binding이다.

분해 단계에서는 새 deferred binding을 추가하지 않는 것이 중요하다.
남아 있는 binding은 bundle 내부 단계로 가두고, 외부 surface에 퍼뜨리지 않는다.

예시:

- `MutableBroadcaster` 같은 stable sink는 유지하되 bootstrap 내부에서만 attach/detach 한다
- `KanbanAutomationRuntime` 같은 facade는 유지하되 runtime port로만 노출한다
- `set_workflow_hitl()`와 `set_tracker()`는 channel bundle 내부 binding 단계로 한정한다

### 5. stateful object는 로직보다 나중에 분리

state holder를 섣불리 옮기면 race와 lifecycle regression이 생긴다.

예시:

- `session_cd`
- `HitlPendingStore` 같은 공유 pending state
- channel manager 내부 Map/Set

먼저 이 상태를 사용하는 로직을 module화하고, 상태 객체 분리는 마지막에 한다.

## Bootstrap 계층 설계

## A. Bootstrap은 "폴더"가 아니라 "계층"이어야 한다

권장 구조:

- `src/bootstrap/runtime-paths.ts`
- `src/bootstrap/config.ts`
- `src/bootstrap/providers.ts`
- `src/bootstrap/runtime-data.ts`
- `src/bootstrap/agent-backends.ts`
- `src/bootstrap/agent-core.ts`
- `src/bootstrap/channels.ts`
- `src/bootstrap/channel-wiring.ts`
- `src/bootstrap/orchestration.ts`
- `src/bootstrap/workflow-ops.ts`
- `src/bootstrap/dashboard.ts`
- `src/bootstrap/runtime-tools.ts`
- `src/bootstrap/trigger-sync.ts`
- `src/bootstrap/services.ts`
- `src/bootstrap/lifecycle.ts`
- `src/bootstrap/runtime-bundles.ts`

핵심은 이름이 아니라 규칙이다.
각 모듈은 "무엇을 생성하는가"가 분명해야 하고, business semantics를 가져가면 안 된다.

현재 상태:

- 생성 완료
  - `src/bootstrap/runtime-paths.ts`
  - `src/bootstrap/config.ts`
  - `src/bootstrap/providers.ts`
  - `src/bootstrap/runtime-data.ts`
  - `src/bootstrap/agent-core.ts`
  - `src/bootstrap/channels.ts`
  - `src/bootstrap/channel-wiring.ts`
  - `src/bootstrap/orchestration.ts`
  - `src/bootstrap/workflow-ops.ts`
  - `src/bootstrap/dashboard.ts`
  - `src/bootstrap/runtime-tools.ts`
  - `src/bootstrap/trigger-sync.ts`
  - `src/bootstrap/services.ts`
  - `src/bootstrap/lifecycle.ts`
- 아직 남음
  - `src/bootstrap/runtime-bundles.ts`
  - 필요 시 `src/bootstrap/agent-backends.ts`는 `providers.ts` 분해 후 별도 승격 검토

## B. Bootstrap에서 허용되는 단위

### 1. path/config bundle

담당:

- workspace/app root 해석
- seed_default_workflows
- config store와 app config 생성

성격:

- low risk
- pure에 가깝다
- 가장 먼저 추출 가능하다

### 2. provider/backend bundle

담당:

- provider store
- ProviderRegistry
- cli auth
- mcp
- backend registry
- provider capability 계산

성격:

- 생성과 wiring은 허용
- provider 실행 정책은 금지

### 3. runtime core bundle

담당:

- bus
- decisions
- events
- sessions
- kanban/reference/workflow store
- cron/heartbeat/ops

성격:

- domain singleton과 infra singleton 조립
- 아직 채널과 대시보드 연결은 하지 않는다

### 4. channel bundle

담당:

- instance store
- channels
- dispatch
- session recorder
- media collector
- approval
- task resume
- channel manager

성격:

- transport 관련 조립만 수행
- orchestration 정책은 포함하지 않는다

### 5. orchestration bundle

담당:

- OrchestrationService 생성
- create_task binding
- workflow ops binding
- HITL bridge 결합

성격:

- 남은 deferred binding을 외부가 아니라 bundle 내부 단계로 가둔다

### 6. dashboard bundle

담당:

- DashboardService 생성
- ops injection
- SSE relay wiring

성격:

- dashboard 비활성 시에도 전체 runtime이 깨지지 않아야 한다

### 7. lifecycle bundle

담당:

- signal registration
- graceful shutdown ordering
- lock release

성격:

- 종료 순서를 한 군데에 고정한다

## 파일별 분할 설계

## A. `src/dashboard/ops-factory.ts`

### 분할 목표

이 파일은 가장 먼저 분할하는 대상이었고, 현재 기준으로 1차 분할이 완료됐다.

현재 상태:

- `src/dashboard/ops-factory.ts`는 re-export facade만 담당한다
- 실제 구현은 `src/dashboard/ops/` 하위 모듈로 분리됐다
- `main.ts`와 테스트는 기존 facade import를 그대로 유지한다

### 목표 구조

`src/dashboard/ops/` 디렉터리로 분리한다.

- `src/dashboard/ops/shared.ts`
- `src/dashboard/ops/template.ts`
- `src/dashboard/ops/channel.ts`
- `src/dashboard/ops/agent-provider.ts`
- `src/dashboard/ops/bootstrap.ts`
- `src/dashboard/ops/memory.ts`
- `src/dashboard/ops/workspace.ts`
- `src/dashboard/ops/oauth.ts`
- `src/dashboard/ops/config.ts`
- `src/dashboard/ops/skill.ts`
- `src/dashboard/ops/tool.ts`
- `src/dashboard/ops/cli-auth.ts`
- `src/dashboard/ops/model.ts`
- `src/dashboard/ops/workflow.ts`
- `src/dashboard/ops/index.ts`

### 분할 방식

1. helper만 먼저 `shared.ts`로 이동
2. export 하나당 파일 하나로 이동
3. 원래 `ops-factory.ts`는 re-export facade로 축소
4. 마지막에 import 정리

### 완료 기준

- `create_*_ops` export 이름이 모두 유지된다
- `main.ts` 호출부 변경이 import 수준에 그친다
- dashboard route 동작 차이가 없다

현재 판정:

- 완료

## B. `src/main.ts`

### 분할 목표

이 파일은 "서비스 생성"과 "서비스 연결"과 "서비스 시작/종료"를 분리해야 한다.

### 분할 방식

1. pure helper 추출
2. bundle builder 추출
3. `createRuntime()` 내부를 builder 호출 orchestration으로 축소
4. shutdown 로직 분리
5. 마지막에 `createRuntime()`은 facade로 남긴다

### 현재 상태

현재까지 완료된 항목:

- path/bootstrap helper 일부 추출
  - `src/bootstrap/runtime-paths.ts`
- config/vault bootstrap 추출
  - `src/bootstrap/config.ts`
- provider/backend bootstrap 추출
  - `src/bootstrap/providers.ts`
- runtime data/service bootstrap 추출
  - `src/bootstrap/runtime-data.ts`
- agent core bootstrap 추출
  - `src/bootstrap/agent-core.ts`
- channel bootstrap 추출
  - `src/bootstrap/channels.ts`
- channel wiring bootstrap 추출
  - `src/bootstrap/channel-wiring.ts`
- orchestration bootstrap 추출
  - `src/bootstrap/orchestration.ts`
- workflow ops bootstrap 추출
  - `src/bootstrap/workflow-ops.ts`
- dashboard bootstrap 추출
  - `src/bootstrap/dashboard.ts`
- runtime tool bootstrap 추출
  - `src/bootstrap/runtime-tools.ts`
- workflow trigger sync 추출
  - `src/bootstrap/trigger-sync.ts`
- service registration / late command / post-boot 추출
  - `src/bootstrap/services.ts`
- shutdown lifecycle 추출
  - `src/bootstrap/lifecycle.ts`

현재 `main.ts`에 남아 있는 것은 구조 분리 미완료 항목이 아니라, composition root가 보유해도 되는 최종 단계다.

- `RuntimeApp` 반환 조립
- main entry boot / lock / shutdown wiring

즉, `main.ts`는 주요 bundle builder와 wiring 단계를 분리했고, 현재는 facade + entry 역할만 남아 있다.

### 금지 사항

- startup order 변경 금지
- async boundary 변경 금지
- 새 mutable ref holder 도입 금지

### 완료 기준

- `createRuntime()`은 동일한 `RuntimeApp` shape를 반환한다
- startup/shutdown 순서가 이전과 동일하다
- `main.ts`는 builder orchestration facade가 된다

현재 판정:

- 완료

## C. `src/orchestration/service.ts`

### 분할 목표

이 파일은 클래스 자체를 바로 부수면 안 된다.
먼저 facade class를 유지한 채 실행 경로를 collaborator로 떼야 한다.

### 목표 구조

- `src/orchestration/service/execute-request.ts`
- `src/orchestration/service/request-context.ts`
- `src/orchestration/service/security.ts`
- `src/orchestration/service/system-prompt.ts`
- `src/orchestration/service/result-mapper.ts`
- `src/orchestration/execution/run-once.ts`
- `src/orchestration/execution/run-agent-loop.ts`
- `src/orchestration/execution/run-task-loop.ts`
- `src/orchestration/phase/run-phase-loop.ts`
- `src/orchestration/phase/channel-callbacks.ts`
- `src/orchestration/workflow/dynamic-generator.ts`
- `src/orchestration/workflow/preview.ts`

### 실제 분해 축

#### 1. request preflight

범위:

- `seal_text`
- `seal_list`
- `inspect_secrets`
- `resolve_context_skills`
- `collect_skill_tool_names`
- request context 조립

#### 2. mode dispatch coordinator

범위:

- `execute()` 내부 gateway 결정
- `once/agent/task/phase` 분기
- finalize/event/process tracking

#### 3. execution runners

범위:

- `run_once`
- `run_agent_loop`
- `run_task_loop`
- `_try_native_task_execute`
- `continue_task_loop`

권장 순서:

1. `run_once`
2. `run_agent_loop`
3. `run_task_loop`
4. `continue_task_loop`

현재 상태:

- `src/orchestration/execution/`에 runner 파일이 생성됐다.
- `OrchestrationService`는 이제 새 runner 모듈을 실제 호출한다.
- `Phase 4.1`은 완료로 본다.

#### 4. phase workflow path

범위:

- `run_phase_loop`
- `generate_dynamic_workflow`
- `format_workflow_preview`
- `build_phase_channel_callbacks`
- `format_phase_summary`

현재 상태:

- `src/orchestration/execution/phase-workflow.ts`로 추출됐다.
- `OrchestrationService.run_phase_loop()`는 이제 추출 모듈로 실제 위임한다.
- `Phase 4.2`는 완료로 본다.
- 권장 사항:
  - `tests/orchestration/phase-workflow.test.ts`는 현재 export/contract 중심이므로
  - `run_phase_loop()` 위임을 직접 잠그는 service delegation 테스트를 추가하는 편이 더 안전하다.

#### 5. state holders

범위:

- `session_cd`

이미 분리된 항목:

- `phase_pending_responses`는 `HitlPendingStore`로 이동됐다.

`Phase 4.3`의 실제 범위는 `session_cd` 분리다.
즉, 실행 흐름을 더 쪼개는 단계가 아니라 세션 누적 관찰 상태를 dedicated collaborator로 이동하는 단계다.

권장 범위:

1. `session_cd`를 `OrchestrationService`에서 직접 보유하지 않도록 한다.
2. `observe / get_score / reset`만 노출하는 작은 stateful collaborator로 감싼다.
3. `build_agent_hooks`, tool-call 경로, runner deps는 이 collaborator 포트를 통해 접근하게 한다.
4. `OrchestrationService`의 public API (`get_cd_score()`, `reset_cd_score()`)는 유지한다.

제외 범위:

- `hitl_pending_store` 재분해
- renderer lazy cache (`_renderer`) 정리
- process tracker / workflow event state 이동

완료 기준:

- `OrchestrationService`가 `create_cd_observer()`를 직접 호출하지 않는다.
- `session_cd` 관련 접근은 collaborator 한 곳으로 수렴한다.
- `get_cd_score()` / `reset_cd_score()` public contract는 그대로 유지된다.
- 구조 이동만 수행하고, CD 점수 규칙 자체는 변경하지 않는다.

이건 마지막에 분리한다.
먼저 관련 로직을 떼고, 나중에 dedicated bridge/state object로 이동한다.

#### 6. request preflight (`Phase 4.4`)

범위:

- `seal_text`
- `seal_list`
- `inspect_secrets`
- `resolve_context_skills`
- `collect_skill_tool_names`
- request-scoped context 조립

목표:

1. `execute()` 초반부의 request preprocessing을 별도 collaborator 또는 helper module로 이동한다.
2. skill/tool/runtime-policy 계산에 필요한 입력을 단일 preflight result로 수렴한다.
3. `execute()`는 preflight 결과를 받아 dispatch 단계로 넘기는 facade 역할만 유지한다.

완료 기준:

- `execute()`가 request preflight 세부 로직을 직접 갖지 않는다.
- preflight 결과가 명시적 shape로 반환된다.
- secrets / skills / policy / request context 계산이 한 경로로 모인다.

#### 7. execute dispatcher (`Phase 4.5`)

범위:

- `resolve_gateway(...)`
- `identity / builtin / inquiry` short-circuit
- `phase / once / agent / task` 분기
- finalize / event / process tracking orchestration

목표:

1. `execute()`의 분기/종결 로직을 dispatcher collaborator로 이동한다.
2. mode별 실행 진입과 finalize를 명시적 단계로 분리한다.
3. `OrchestrationService`는 dependency 보관 + high-level orchestration facade로만 남긴다.

완료 기준:

- `execute()` 내부 분기 로직이 dispatcher collaborator로 수렴한다.
- short-circuit / phase / runner 진입 경계가 명시적 함수 또는 객체로 분리된다.
- finalize / event / process tracking 흐름이 테스트로 고정된다.

### facade 유지 전략

첫 단계에서는 `OrchestrationService`를 유지한다.

이 클래스는 다음 역할만 남겨야 한다.

- dependency 보관
- execute 진입점 제공
- stateful collaborator 보유
- extracted module orchestration

## 분할 순서의 우선순위

### 1순위: `ops-factory.ts`

이유:

- export 경계가 이미 존재한다
- lifecycle coupling이 낮다
- 분할 이득 대비 리스크가 가장 낮다

현재 상태:

- 완료

### 2순위: `main.ts`

이유:

- 현재 변경 취약점의 중심이지만, pre-split blocker가 해소되어 바로 분해 가능하다
- `ActiveRunController`, `RenderProfileStore`, `MutableBroadcaster`, `KanbanAutomationRuntime`가 이미 경계를 만들어 두었다

현재 상태:

- 완료

### 3순위: `orchestration/service.ts`

이유:

- 가장 복잡하고 위험하다
- 실행 semantics와 state를 함께 다루기 때문에 가장 나중에 해야 한다

현재 상태:

- 완료 (Phase 4.1–4.5)
- `Phase 4.1` 실행 runner 분리는 완료됐다
- `Phase 4.2` phase workflow 경로 분리도 완료됐다
- `Phase 4.3` state holder 분리도 완료됐다
- `Phase 4.4` request preflight 분리도 완료됐다
- `Phase 4.5` execute dispatcher 분리도 완료됐다
- 현재 남은 작업은 없음 (execution runner 분리 완전 완료)

## 회귀 방지 장치

### 1. characterization tests

필수 대상:

- `createRuntime()` bootstrap smoke
- shutdown ordering
- `OrchestrationService.execute()` mode별 대표 시나리오
- phase loop HITL roundtrip
- dashboard ops factory export contract

### 2. shape contract 고정

필수 대상:

- `RuntimeApp`
- dashboard ops object shapes
- orchestration result object

### 3. import cycle 감시

특히 주의할 축:

- bootstrap <-> dashboard
- bootstrap <-> orchestration
- orchestration <-> channels
- workflow ops <-> orchestration

### 4. no-mixed-change rule

한 PR에서 다음 두 가지를 동시에 하지 않는다.

- 구조 이동
- 기능 수정

## 추천 진행 방식

### Phase 1. 구조 계측

- 분할 대상 파일의 공개 export와 반환 타입 고정
- characterization test 추가
- 남은 deferred binding 지점 문서화

### Phase 2. 저위험 분할

- `ops-factory.ts` 분할
- `main.ts`의 pure helper와 path/config 추출

현재 상태:

- 완료

### Phase 3. 조립 분할

- `main.ts` bundle builder 분리
- shutdown/lifecycle 분리

현재 상태:

- 완료
- lifecycle 분리는 완료됐다
- provider / runtime-data / agent-core / channels / channel-wiring / orchestration / workflow-ops / dashboard / runtime-tools / trigger-sync / services 분리는 완료됐다
- `RuntimeApp` 반환 조립과 main entry boot는 composition root가 직접 보유하는 허용 범위로 간주한다

### Phase 4. 실행 분할

- `OrchestrationService` 내부 runners 분리
- phase workflow 경로 분리
- 마지막에 state object 분리 검토

현재 상태:

- `Phase 4.1` 완료
  - `src/orchestration/execution/run-once.ts`
  - `src/orchestration/execution/run-agent-loop.ts`
  - `src/orchestration/execution/run-task-loop.ts`
  - `src/orchestration/execution/continue-task-loop.ts`
  - `src/orchestration/execution/helpers.ts`
  - `src/orchestration/execution/runner-deps.ts`
- `Phase 4.2` 완료
  - `src/orchestration/execution/phase-workflow.ts` (run_phase_loop + 4개 helper 메서드)
  - `OrchestrationService`의 5개 메서드 추출 완료
  - `tests/orchestration/phase-workflow.test.ts` 추가됨 (5개 테스트: export/contract/위임 검증)
- `Phase 4.3` 완료
  - `session_cd` (CDObserver) collaborator 필수 주입 패턴 적용
  - `OrchestrationServiceDeps`에 `session_cd: CDObserver` (필수 필드)
  - `src/orchestration/service.ts`: `create_cd_observer()` 제거, 생성자에서 `deps.session_cd` 직접 할당
  - `src/bootstrap/orchestration.ts`: `create_cd_observer()` 호출 추가, OrchestrationService 생성 시 제공
  - `tests/orchestration/session-state.test.ts` (6개 테스트: 타입 계약 + 의존성 주입 검증)
  - 완료 기준: ✅ OrchestrationService가 create_cd_observer() 직접 호출하지 않음 (bootstrap에서만 호출)
  - 완료 기준: ✅ session_cd 접근이 collaborator-only 경로로 수렴
- `Phase 4.4` 완료
  - `src/orchestration/request-preflight.ts` (새 파일, 350 LOC)
    - 타입: `RequestPreflightDeps`, `ResumedPreflight`, `ReadyPreflight`, `RequestPreflightResult` (discriminated union)
    - 메인 함수: `run_request_preflight(deps, req)` — seal → resumed 분기 → context 조립
    - 내보낸 헬퍼: `collect_skill_provider_prefs()` (continue_task_loop 재사용)
    - 모듈 내부: `seal_text`, `seal_list`, `inspect_secrets`, `collect_skill_tool_names`, `resolve_context_skills`
  - `src/orchestration/service.ts` 수정
    - 메서드 제거: `seal_text`, `seal_list`, `inspect_secrets`, `collect_skill_tool_names`, `resolve_context_skills`, `_collect_skill_provider_preferences` (6개)
    - 메서드 추가: `_preflight_deps()` → RequestPreflightDeps 반환
    - `execute()` 단순화: `const preflight = await run_request_preflight(...)` → kind 분기
    - `_continue_deps()` 업데이트: `collect_skill_provider_prefs` 호출로 변경
  - `tests/orchestration/request-preflight.test.ts` (새 파일, 7개 테스트)
    - normal path 검증 (kind='ready')
    - ReadyPreflight shape 검증 (모든 context 필드)
    - `collect_skill_provider_prefs` 중복 제거 검증
  - 설계 문서: `docs/en/design/request-preflight.md`, `docs/ko/design/request-preflight.md` (새 파일)
  - 완료 기준: ✅ execute()가 seal/inspect/skill 세부 로직 미보유
  - 완료 기준: ✅ preflight 결과가 명시적 discriminated union shape
  - 완료 기준: ✅ secret/skill/policy/request context 계산이 한 경로로 수렴
- `Phase 4.5` 완료
  - `src/orchestration/execution/execute-dispatcher.ts` (새 파일, 300+ LOC)
    - 타입: `ExecuteDispatcherDeps` — gateway, short-circuit, mode dispatch, finalize 의존성 주입
    - 메인 함수: `execute_dispatch(deps, req, preflight)` — dispatcher 로직 오케스트레이션
  - `src/orchestration/service.ts` 수정
    - 메서드 제거: `run_once`, `run_agent_loop`, `run_task_loop`, `run_phase_loop` (4개)
    - Dead code 제거: `build_tool_context`, `compose_task_with_media`, `build_context_message`, `inbound_scope_id` (4개)
    - 메서드 추가: `_dispatch_deps()` — ExecuteDispatcherDeps 반환
    - `execute()` 단순화: preflight → finalize(dispatcher()) 한 줄로 축소
  - `tests/orchestration/execute-dispatcher.test.ts` (새 파일, 7개 structural 테스트)
  - 설계 문서: `docs/en/design/execute-dispatcher.md`, `docs/ko/design/execute-dispatcher.md` (새 파일)
  - 완료 기준: ✅ execute()가 gateway/dispatch 세부 로직 미보유
  - 완료 기준: ✅ 의존성 주입으로 dispatcher 독립 테스트 가능
  - 완료 기준: ✅ gateway→short-circuit→mode→finalize semantic 보존

## 하지 말아야 할 분할

### 1. 줄 수 기준 기계적 분할

의미 없는 분할이다.
변경 취약점을 줄이지 못한다.

### 2. 파일명만 도메인처럼 보이게 나누는 분할

실제 side effect 경계가 그대로면 가치가 없다.

### 3. 남은 deferred binding을 새 전역 상태로 되돌리는 분할

현재는 blocker가 닫혔기 때문에, 분해 과정에서 새 mutable holder를 만들면 오히려 역행이다.

### 4. generator와 runtime 분할을 동시에 하는 작업

지금은 거대 파일 분할과 generator hardening을 별개 트랙으로 가야 한다.

## 최종 결론

`bootstrap` 분리는 현재 구조에서 적절하다.
다만 `bootstrap`은 새 쓰레기통 폴더가 아니라, composition 전용 계층으로 설계되어야 한다.

현재 코드는 구조 분해를 시작해도 되는 상태다.
이전 blocker는 정리됐고, 지금의 핵심은 의미 보존과 조립 경계 명시화다.

현재 기준으로 큰 파일 구조 분해 phase는 `Phase 4.5`까지 완료됐다.
다음 실제 작업은 새 경계에 대한 stabilization, 회귀 테스트 보강, 후속 cleanup이다.

그리고 각 단계에서 반드시 지켜야 할 원칙은 이것이다.

- facade 유지
- public contract 고정
- side effect ordering 보존
- stateful object는 마지막에 분리
- 구조 변경과 기능 변경 분리
- 새 mutable ref holder를 만들지 않기

이 원칙을 지키면, 현재 취약점 분석 기준을 훼손하지 않으면서 `bootstrap` 중심 분할을 수행할 수 있다.
