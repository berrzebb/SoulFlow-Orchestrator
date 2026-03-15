# Role / Protocol Architecture 설계

## 목적

`role / protocol architecture`는 시스템 프롬프트를 단순 문자열 조립이 아니라 정책 기반 구조로 다루기 위한 설계다.
이 구조의 목적은 역할별 행동 기준, 공유 프로토콜, 실행 체크리스트를 문서 자산에서 읽어 공통 형식으로 정규화하고, 오케스트레이션과 워크플로우 생성기가 같은 기준을 사용하게 만드는 것이다.

핵심 의도는 다음과 같다.

- 역할 기준을 skill 자산에 두고 코드에 하드코딩하지 않는다
- 공유 프로토콜을 이름이 아니라 실제 정책 본문으로 해석한다
- system prompt 조립 전에 역할 정책을 구조화된 profile로 컴파일한다
- 런타임 실행과 워크플로우 UI가 같은 역할 정의를 공유한다

## source of truth

현재 역할 정책의 source of truth는 역할 skill 자산이다.

- `src/skills/roles/*/SKILL.md`
- 역할별 `resources/*`
- shared protocol 자산

이 설계에서 코드는 역할 정책을 “창조”하지 않는다.
코드는 문서 자산을 읽고 정규화하고 합성할 뿐이다.

## 핵심 모델

### RolePolicyResolver

`RolePolicyResolver`는 role skill의 메타데이터를 정규화된 `RolePolicy`로 바꾼다.

여기서 정리되는 항목은 예를 들면 다음과 같다.

- `role_id`
- `soul`
- `heart`
- `tools`
- `shared_protocols`
- `preferred_model`
- `use_when`
- `not_use_for`
- `execution_protocol`
- `checklist`
- `error_playbook`

이 계층의 원칙은 명확하다.

- resolver는 role asset을 읽는다
- resolver는 정책 값을 새로 상상하지 않는다
- asset에 없는 값은 null 또는 빈 값으로 남긴다

### ProtocolResolver

`ProtocolResolver`는 `shared_protocols` 이름 목록을 실제 프로토콜 본문으로 해석한다.

즉 역할 문서 안에 `"approval-safety"` 같은 이름만 적혀 있어도, 실행 시점에는 그 이름이 실제 텍스트 정책 섹션으로 변환된다.

이 구조는 역할 문서가 반복적으로 긴 지침을 복붙하지 않게 하고, 여러 역할이 같은 프로토콜 자산을 공유하도록 만든다.

### PromptProfileCompiler

`PromptProfileCompiler`는 `RolePolicy`와 해석된 protocol 본문을 묶어 `PromptProfile`을 만든다.

이 단계는 역할 정책을 실행 가능한 baseline prompt profile로 바꾸는 계층이다.

profile에는 다음이 포함된다.

- role identity
- soul / heart
- shared protocol sections
- execution protocol
- checklist
- error playbook
- preferred model

compiler는 역할 자산을 직접 읽지 않는다.
반드시 resolver가 만든 정책을 입력으로 받는다.

## 현재 시스템에서의 사용처

### 1. 오케스트레이션 실행

`OrchestrationService`는 alias와 role id를 연결해, 현재 요청에 맞는 `PromptProfile`을 시스템 프롬프트 뒤에 붙일 수 있다.

이 구조의 의미는 다음과 같다.

- raw system prompt는 runtime context가 만든다
- role / protocol baseline은 compiler가 붙인다
- alias가 role과 연결되지 않으면 기본 concierge baseline으로 폴백한다

즉 역할 정책은 실행 경로의 부가 힌트가 아니라 system prompt baseline의 일부다.

### 2. 워크플로우 생성기 / 대시보드

dashboard workflow ops는 같은 compiler를 사용해 role 목록과 rendered prompt preview를 노출할 수 있다.

이 덕분에 UI와 런타임이 서로 다른 role 정의를 갖지 않는다.
사용자는 role 설명, heart, tools, shared protocol, rendered prompt를 한 기준으로 본다.

## PersonaMessageRenderer와의 관계

`role / protocol architecture`와 `PersonaMessageRenderer`는 서로 다른 문제를 푼다.

- role / protocol
  - 실행 baseline, system prompt, 행동 기준
- persona renderer
  - 사용자-facing deterministic 메시지의 표현 계층

둘은 연결될 수 있지만 동일 계층은 아니다.
role policy가 실행자의 기준을 정하면, persona renderer는 사용자에게 어떻게 말할지를 정리한다.

즉 “무엇을 하도록 유도할 것인가”와 “어떻게 들리게 할 것인가”를 분리하는 구조다.

## 현재 구조에서의 경계

이 설계는 다음 경계를 전제로 한다.

- role 자산은 skill 시스템이 관리한다
- role / protocol 해석은 orchestration 계층이 담당한다
- runtime prompt baseline은 context builder가 만든다
- user-facing deterministic 문장 톤은 renderer가 담당한다

따라서 role / protocol 계층은 다음을 하지 않는다.

- 사용자-facing status 문장을 직접 렌더링하지 않는다
- skill 추천이나 gateway routing을 결정하지 않는다
- workflow execution 상태를 보관하지 않는다
- ad-hoc prompt string을 source of truth로 삼지 않는다

## 현재 프로젝트에서의 의미

현재 프로젝트는 로컬 실행기, workflow, dashboard를 함께 다루기 때문에 역할 정의가 한 곳에 모여 있어야 한다.
이 설계는 그 요구를 위해 다음 원칙을 채택한다.

- 역할 기준은 문서 자산에 둔다
- 코드에서는 resolver와 compiler로 구조화한다
- 런타임과 UI가 같은 profile을 소비한다
- raw prompt 편집이 있더라도 baseline policy는 role profile에서 온다

## 비목표

- 현재 라운드의 작업 상태 관리
- 감사 판정이나 합의 이력 기록
- user preference memory 자체의 설계
- deterministic message renderer의 tone policy 대체

이 문서는 현재 채택된 설계 개념을 설명한다.
구체적인 migration, breakdown, 후속 작업은 `docs/*/design/improved/*`에서 관리한다.
