# Phase Loop 설계

## 목적

`phase loop`는 여러 에이전트와 critic을 페이즈 단위로 묶어 순차 실행하기 위한 워크플로우 실행 설계다.
이 구조의 목적은 단일 에이전트 루프나 단순 task step 체인으로 표현하기 어려운 다단계 작업을 “phase”, “phase mode”, “critic gate”, “workflow state”라는 공통 계약으로 다루는 것이다.

현재 프로젝트에서 phase loop는 다음 문제를 풀기 위해 채택됐다.

- 병렬 조사와 순차 구현을 같은 workflow 안에서 표현한다
- phase마다 다른 에이전트 조합과 역할을 부여한다
- critic 또는 gate를 phase 경계에 둘 수 있게 한다
- 사용자 입력 대기, 재개, 에스컬레이션을 workflow 상태로 추적한다

## 현재 실행 모델

phase loop는 “페이즈 간 순차, 페이즈 내부는 모드별 실행” 모델을 채택한다.

현재 지원하는 phase mode는 다음과 같다.

- `parallel`
- `interactive`
- `sequential_loop`

각 mode는 phase 내부의 실행 규칙만 바꾸고, 전체 workflow는 여전히 phase 순서와 의존관계를 따라 진행된다.

즉 현재 구조는 다음처럼 나뉜다.

- `parallel`
  - 여러 에이전트를 같은 phase 안에서 병렬 실행
- `interactive`
  - 사용자와 왕복하며 phase 결과를 수집
- `sequential_loop`
  - 같은 phase를 fresh context iteration으로 반복 실행

## 핵심 상태

phase loop의 source of truth는 workflow state다.
개별 에이전트 세션, 브라우저 UI, 채널 렌더러는 모두 이 상태를 소비하거나 갱신할 뿐, 그것 자체가 진실 원본은 아니다.

현재 구조에서 핵심 상태는 다음을 포함한다.

- workflow status
- current phase
- phase별 status
- phase memory
- loop iteration / loop results
- critic review / approval
- `waiting_user_input` 같은 대기 상태

이 구조 덕분에 workflow는 대시보드에서 조회될 수 있고, 채널을 통해 재개될 수 있으며, phase 진행도 역시 UI에서 같은 기준으로 그릴 수 있다.

## critic과 게이트

phase loop는 critic을 선택적 보조 텍스트가 아니라 phase 경계의 품질 게이트로 다룬다.
critic은 phase 산출물을 보고 다음 페이즈로 진행할지, 다시 시도할지, goto/escalate 할지를 결정할 수 있다.

현재 구조에서 중요한 점은 다음과 같다.

- critic은 phase 바깥의 별도 실행이 아니라 phase 계약의 일부다
- phase 결과와 critic review는 같은 workflow state에 남는다
- rejection은 단순 로그가 아니라 제어 흐름을 바꿀 수 있다

즉 phase loop는 병렬 실행기이면서 동시에 제어 흐름 엔진이다.

## 사용자 입력과 재개

phase loop는 사용자 입력 대기를 예외 상태가 아니라 정상적인 상태 전이로 취급한다.
에이전트 또는 critic이 사용자 입력을 요구하면 workflow는 `waiting_user_input` 상태로 전환될 수 있고, 이후 채널이나 대시보드에서 재개된다.

이 설계의 핵심은 다음과 같다.

- 재개는 workflow state를 기준으로 한다
- 사용자 입력은 특정 phase/iteration의 문맥에 결합된다
- workflow는 중간 상태에서 멈추더라도 다시 이어질 수 있어야 한다

## 현재 프로젝트에서의 의미

이 프로젝트는 단순한 agent chat 앱이 아니라 workflow authoring, dashboard monitoring, channel delivery를 함께 가진다.
phase loop는 그 세 요소를 하나의 실행 모델로 묶는 핵심 설계다.

현재 구조에서 phase loop가 의미하는 바는 다음과 같다.

- workflow는 YAML/정의 객체에서 선언된다
- 선언된 phase는 공통 runner가 실행한다
- 대시보드는 진행 상태와 phase 상세를 같은 상태 모델로 그린다
- 채널은 `waiting_user_input`과 결과 전달을 workflow 상태와 연결한다

즉 phase loop는 “워크플로우 엔진의 구현 세부사항”이 아니라 현재 프로젝트의 표준 실행 모델이다.

## 다른 루프와의 관계

- `agent loop`
  - 단일 에이전트 중심 실행
- `task loop`
  - step 기반 순차 실행
- `phase loop`
  - phase와 gate를 가진 다중 에이전트 실행

이 셋은 경쟁 관계가 아니라 역할 분담 관계다.
phase loop는 더 복잡한 작업에 쓰이고, agent/task loop는 더 단순한 실행 경로를 담당한다.

## 비목표

- 모든 요청을 phase loop로 강제하는 것
- critic 없는 단순 실행까지 phase loop로 몰아넣는 것
- workflow 상태를 UI 렌더링 결과로 대체하는 것
- 사용자 대화와 승인 절차를 구분 없이 한 상태로 뭉개는 것

이 문서는 현재 채택된 phase loop 설계 개념을 설명한다.
세부 rollout, migration, work breakdown은 `docs/*/design/improved/*`에서 관리한다.
