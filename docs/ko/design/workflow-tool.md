# Workflow Tool 설계

## 목적

`workflow tool`은 에이전트가 구조화된 workflow 정의를 생성, 조회, 수정, 실행할 수 있게 하는 도구 계층이다.
이 설계의 목적은 자연어 요청에서 workflow를 만들 수 있게 하되, 실제 저장과 실행은 구조화된 계약으로만 처리하게 만드는 것이다.

즉 이 도구는 “에이전트가 YAML 파일을 직접 쓰게 하는 것”이 아니라 “에이전트가 workflow contract를 통해 dashboard workflow ops를 호출하게 하는 것”을 목표로 한다.

## 현재 구조에서의 역할

workflow tool은 자연어를 DAG로 바꾸는 모델 계층과, 저장/실행을 담당하는 dashboard 계층 사이의 경계다.

현재 구조는 다음처럼 분리된다.

- 모델 또는 workflow writer
  - 어떤 phase와 node가 필요한지 추론
- workflow tool
  - 구조화된 action 계약으로 생성/조회/수정/실행 요청
- dashboard workflow ops
  - 템플릿 저장, 조회, 삭제, 실행 생성

즉 workflow tool은 workflow 자체의 source of truth가 아니라, source of truth에 접근하는 공용 제어 인터페이스다.

## action 기반 계약

현재 workflow tool은 단일 도구 + action 파라미터 패턴을 사용한다.
이 패턴은 CRUD와 실행을 하나의 도구 이름 아래에서 구조화된 action으로 분리한다.

현재 핵심 action은 다음과 같다.

- `create`
- `list`
- `get`
- `run`
- `update`
- `delete`
- `export`
- `flowchart`
- `sequence`
- `node_types`
- `models`

이 구조의 의도는 도구 이름을 늘리는 것이 아니라, workflow 관련 작업을 하나의 명시적 계약 아래에 두는 것이다.

## node catalog와의 관계

workflow tool은 “빈 저장 도구”가 아니다.
현재 구조에서는 node catalog와 backend/model 목록을 함께 노출해, 에이전트가 사용할 수 있는 workflow surface를 먼저 이해한 뒤 정의를 만들 수 있게 한다.

이 설계가 의미하는 바는 다음과 같다.

- node type는 registry 기반으로 노출된다
- workflow 정의는 catalog를 기준으로 작성된다
- backend/model 선택 역시 실제 runtime에서 사용할 수 있는 값으로 제한된다

즉 workflow tool은 생성기이면서 동시에 schema discovery 도구다.

## 저장 경계

workflow tool은 workflow 파일을 직접 다루지 않는다.
현재 구조에서는 workflow 저장과 불러오기가 `DashboardWorkflowOps`를 통해 수행된다.

이 경계는 다음 원칙을 따른다.

- workflow tool은 ops를 호출한다
- ops가 템플릿 저장소와 실행 생성 책임을 가진다
- 에이전트는 raw file write로 workflow를 만들지 않는다

이렇게 함으로써 dashboard, tool, runtime이 서로 다른 저장 규칙을 갖는 문제를 줄인다.

## 실행 경계

`run` action은 이름 기반 실행과 인라인 정의 실행을 모두 다룰 수 있지만, 두 경우 모두 실행 생성은 동일한 workflow ops 경계를 통과한다.

즉 workflow tool은 직접 phase loop를 돌리지 않는다.
실행 엔진을 직접 소유하지 않고, 선언된 workflow를 런타임 실행으로 연결하는 진입점 역할만 한다.

## 현재 프로젝트에서의 의미

이 프로젝트는 대시보드 기반 workflow authoring과 에이전트 기반 자연어 자동화를 함께 제공한다.
workflow tool은 이 둘을 연결하는 핵심 계층이다.

현재 구조에서 이 설계가 의미하는 바는 다음과 같다.

- 사용자는 자연어로 workflow 생성을 요청할 수 있다
- 에이전트는 구조화된 contract를 통해 workflow를 만든다
- 저장소와 실행기는 같은 workflow definition을 소비한다
- 시각화와 node discovery도 같은 tool surface에서 제공된다

## 비목표

- 자연어에서 workflow graph를 완전히 deterministic하게 추론하는 것
- workflow YAML을 임의 파일 쓰기로 직접 관리하는 것
- 실행 엔진을 workflow tool 안에 중복 구현하는 것
- dashboard workflow ops를 우회하는 별도 저장 경로를 만드는 것

이 문서는 현재 채택된 workflow tool 설계 개념을 설명한다.
세부 rollout과 작업 분해는 `docs/*/design/improved/*`에서 관리한다.
