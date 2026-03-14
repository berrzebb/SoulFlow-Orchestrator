# 에이전트 정의 설계

## 목적

`agent definitions`는 시스템이 사용하는 역할형 에이전트를 파일 자산과 데이터 저장소 양쪽에서 다룰 수 있게 만드는 정의 계층이다.
이 설계의 목적은 built-in 역할 자산, 사용자 정의 에이전트, 팀/개인 스코프를 한 모델로 정리하여 **실행기와 대시보드가 같은 정의 체계를 공유하게 하는 것**이다.

핵심 의도는 다음과 같다.

- 역할 에이전트를 구조화된 정의로 저장한다
- built-in 역할과 사용자 정의 역할을 같은 읽기 모델로 본다
- `global | team | personal` 스코프에 따라 가시성과 쓰기 권한을 나눈다
- runtime 실행, dashboard 편집, workflow 생성이 같은 정의를 소비하도록 만든다

## source of truth

에이전트 정의는 두 source를 가진다.

- built-in 정의
  - 역할 skill 자산에서 유래한 시스템 제공 정의
- custom 정의
  - SQLite 저장소에 영속화된 사용자/팀 정의

상위 설계 관점에서 중요한 점은, 둘의 출처는 다르지만 **읽기 모델은 하나**라는 것이다.
즉 실행기나 UI는 “이게 파일에서 왔는지 DB에서 왔는지”보다, 공통 `AgentDefinition` 계약을 더 중요하게 본다.

## 핵심 모델

에이전트 정의는 대략 다음 요소를 가진다.

- 이름과 설명
- icon
- role skill 참조
- `soul`
- `heart`
- 허용 도구 목록
- shared protocol 목록
- 추가 skill 목록
- `use_when`
- `not_use_for`
- extra instructions
- preferred providers
- model preference
- scope (`global | team | personal`)

이 모델의 의미는 단순 prompt 저장이 아니라, **역할 경계와 행동 기준을 구조화된 필드로 유지하는 것**이다.

## Built-in과 Custom

이 설계는 built-in과 custom을 같은 목록에서 다루되, mutation 규칙은 다르게 본다.

- built-in
  - 시스템이 제공
  - 수정/삭제 불가
  - fork를 통해 새 custom 정의 생성 가능
- custom
  - 사용자가 소유
  - scope 권한에 따라 수정/삭제 가능

이 구분은 단순 UI 상태가 아니라, “시스템 자산”과 “사용자 자산”의 경계를 유지하기 위한 것이다.

## Scope 모델

에이전트 정의는 멀티테넌트 설계와 같은 3-tier scope 모델을 따른다.

- `global`
  - 시스템 전역 정의
- `team`
  - 한 팀에서 공유되는 정의
- `personal`
  - 한 사용자의 개인 정의

이 모델은 읽기와 쓰기에서 다르게 적용된다.

### 읽기

현재 요청자의 컨텍스트에 따라 보이는 정의는 보통 다음 합집합이다.

```text
visible definitions
  = global
  + current team
  + current personal
```

### 쓰기

쓰기 권한은 더 좁다.

- `global`은 관리자 영역
- `team`은 팀 관리 권한 필요
- `personal`은 본인만 수정 가능

즉 agent definition 설계는 “목록을 보여준다”보다, **scope-aware visibility와 mutation을 같이 정의하는 저장소 설계**다.

## Role / Protocol Architecture와의 관계

`agent definitions`는 `role-protocol-architecture`와 직접 연결된다.

차이는 다음과 같다.

- role / protocol architecture
  - 역할 자산과 shared protocol을 어떻게 해석하고 컴파일할지 설명
- agent definitions
  - 어떤 역할 정의가 저장되고 노출되며 scope를 가지는지 설명

즉 role/protocol이 해석 계층이라면, agent definitions는 저장과 노출 계층이다.

## Dashboard와의 관계

대시보드는 에이전트 정의를 조회, 생성, 수정, fork할 수 있어야 한다.

상위 설계 관점에서 중요한 점은 다음과 같다.

- dashboard는 정의의 source of truth가 아니다
- dashboard는 저장소와 scope policy를 통해 정의를 편집하는 surface다
- UI가 raw prompt blob을 편집하는 것이 아니라, 구조화된 정의 필드를 다루는 것이 바람직하다

즉 대시보드 편집은 저장소 위의 표현 계층이다.

## 실행기와의 관계

에이전트 정의는 단순 갤러리 자산이 아니라 실행기에 연결될 수 있어야 한다.

예를 들면:

- 특정 역할 에이전트를 선택해 workflow node에 연결
- 특정 alias가 role skill과 연결된 baseline을 사용
- prompt profile compiler가 role/policy를 해석

따라서 정의 저장소는 UI 기능만을 위한 부가 저장소가 아니라, 실행기와 연결될 수 있는 역할 정의 저장소다.

## Fork 모델

fork는 built-in 또는 기존 정의를 복사해 새 custom 정의를 만드는 동작이다.

이 설계에서 fork가 중요한 이유는:

- 시스템 제공 역할을 직접 수정하지 않게 하고
- 팀이나 개인이 자신에게 맞는 변형본을 만들게 하며
- 원본의 scope와 역할 정보를 안전하게 계승할 수 있게 하기 때문이다

즉 fork는 copy convenience가 아니라 시스템 자산 보호 장치다.

## 경계

이 설계가 하지 않는 일은 다음과 같다.

- role skill parsing 규칙 전체를 다시 정의하지 않는다
- prompt compiler 세부 조립 로직을 설명하지 않는다
- dashboard UI의 세부 배치를 고정하지 않는다
- 현재 구현 phase나 완료 상태를 기록하지 않는다

`agent definitions`는 역할 정의의 저장, 노출, 스코프 경계를 설명하는 문서다.

## 현재 프로젝트에서의 의미

현재 프로젝트는 built-in role skill, workflow 역할 선택, dashboard 편집, 팀 스코프를 함께 다룬다.
그래서 에이전트 정의는 단일 파일 자산만으로 설명하기 어렵고, 구조화된 정의 저장소가 필요하다.

이 문서는 그 상위 설계를 다음처럼 고정한다.

- built-in과 custom은 하나의 정의 모델을 공유한다
- 정의는 scope를 가진다
- dashboard는 정의를 편집할 수 있다
- 실행기는 이 정의 계층과 연결될 수 있다

## 비목표

- 현재 라운드의 감사 결과 기록
- 특정 UI 화면의 완료 상태 기록
- migration 순서나 rollout 단계 관리
- improved 문서의 work breakdown을 여기로 끌어오는 것

이 문서는 현재 채택된 에이전트 정의 설계 개념을 설명한다.
세부 작업 분류와 rollout은 `docs/*/design/improved/*`에서 관리한다.
