# 세션 상태 주입 설계

## 목적

`session state injection`은 오케스트레이션 서비스가 필요한 세션성 collaborator를 직접 생성하지 않고 외부에서 주입받도록 만드는 설계다.
이 구조의 목적은 서비스 내부에 숨어 있는 상태를 줄이고, **세션 점수, HITL 대기 상태, compaction 관련 상태 같은 실행 중 collaborator를 명시적으로 조립하는 것**이다.

핵심 의도는 다음과 같다.

- `OrchestrationService`를 숨겨진 상태 생성기보다 조정자에 가깝게 만든다
- 세션성 state의 lifecycle을 bootstrap이 소유하게 한다
- 테스트에서 mock collaborator를 쉽게 주입할 수 있게 한다
- runner와 hooks가 같은 세션 상태를 공유하게 만든다

## 주입 대상 상태

현재 설계에서 세션 상태로 보는 대표 collaborator는 다음과 같다.

- `session_cd`
  - 실행 이벤트를 관찰하고 CD score를 계산하는 observer
- `hitl_pending_store`
  - 사용자 응답을 기다리는 pending state 저장소
- compaction flush 관련 collaborator
  - 메모리 flush나 context reserve 계산에 쓰이는 주입형 구성

상위 설계의 핵심은 이것들을 “service 내부 인라인 상태”가 아니라 **외부에서 조립되는 collaborator**로 다루는 것이다.

## 조립 위치

세션 상태는 bootstrap 계층에서 조립한다.

```text
bootstrap
  -> create session collaborators
  -> inject into OrchestrationService
  -> pass through to hooks / runners / dashboard accessors
```

즉 orchestration service는 세션 상태의 source가 아니라, 이미 만들어진 상태를 소비하는 계층이다.

## 왜 주입형이어야 하는가

이 설계의 이유는 명확하다.

### 1. 테스트 가능성

세션 상태를 서비스 내부에서 직접 만들면:

- mock observer 주입이 어렵고
- lifecycle 제어가 어렵고
- 특정 state transition만 검증하는 테스트가 복잡해진다

주입형 구조에서는 테스트가 필요한 collaborator만 교체하면 된다.

### 2. 실행 경로 일관성

세션 상태는 한 곳에서만 쓰이지 않는다.

- hooks
- once / agent / task runner
- workflow continuation
- dashboard stats
- HITL bridge

이 경로들이 서로 다른 인스턴스를 보지 않게 하려면, 생성 위치를 bootstrap에 고정하는 편이 낫다.

### 3. 서비스 책임 축소

`OrchestrationService`는 요청 조정과 실행 분기에 집중해야 한다.
세션성 observer와 pending store를 직접 생성하는 순간, 서비스는 orchestration coordinator이면서 동시에 state owner가 된다.

이 설계는 그 혼합 책임을 피하려는 것이다.

## session_cd의 의미

`session_cd`는 세션 이벤트를 관찰하는 collaborator다.

상위 설계 관점에서 중요한 점은:

- 점수 규칙 그 자체보다
- **관찰 대상 상태가 외부에서 주입된다는 점**

이다.

즉 이 문서의 목적은 CD scoring 알고리즘을 설명하는 것이 아니라, 그 observer가 orchestration 내부에서 어떻게 위치해야 하는지를 정의하는 것이다.

## HITL pending state의 의미

`hitl_pending_store`는 사람 응답이 도착하기 전의 대기 상태를 유지하는 세션성 저장소다.

이 저장소를 주입형으로 두는 이유는 다음과 같다.

- dashboard와 channel bridge가 같은 pending state를 봐야 한다
- workflow continuation이 이전 대기 상태를 이어받아야 한다
- 서비스 내부 hidden map으로 두면 외부 시스템과 일관성이 깨진다

따라서 pending state는 route layer와 orchestration layer 사이의 공유 collaborator다.

## Compaction과 세션 상태

세션 상태 주입 설계는 memory compaction과도 연결된다.

이유는 다음과 같다.

- compaction flush는 세션 토큰 사용량과 현재 실행 상태를 반영해야 한다
- 이 판단은 pure function만으로 끝나지 않고, 실행기 collaborator와 연결된다
- 따라서 compaction 관련 구성 역시 주입 가능한 collaborator 또는 config로 두는 편이 맞다

상위 설계 관점에서는 “flush를 언제 호출하는가”보다 “service가 혼자 상태를 만들지 않는다”는 원칙이 더 중요하다.

## 공개 계약

세션 상태는 내부에만 존재하면 안 되고, 필요한 경우 외부 읽기 API를 통해 노출될 수 있어야 한다.

예를 들면:

- 현재 CD score 조회
- CD score reset
- pending HITL 응답 해소

이 공개 계약은 내부 자료구조를 노출하기 위한 것이 아니라, orchestration 외부 계층이 동일한 세션 상태를 참조할 수 있게 하기 위한 것이다.

## 경계

이 설계가 하지 않는 일은 다음과 같다.

- session memory retrieval 정책 전체를 정의하지 않는다
- CD scoring 세부 알고리즘을 설명하지 않는다
- workflow 상태 머신 전체를 설명하지 않는다
- dashboard stats UI의 최종 표현 방식을 정의하지 않는다

즉 `session state injection`은 세션성 collaborator의 소유권과 주입 경계를 설명하는 문서다.

## 현재 프로젝트에서의 의미

현재 프로젝트는 단일 오케스트레이션 서비스가 channels, dashboard, workflows와 함께 동작한다.
이 환경에서는 세션 상태를 한 클래스 안에 감춰 두는 것보다, bootstrap에서 명시적으로 조립해 여러 경로가 공유하는 것이 더 적절하다.

이 문서는 그 상위 설계를 다음처럼 고정한다.

- 세션 상태는 collaborator다
- collaborator는 bootstrap이 생성한다
- orchestration service는 소비자이자 조정자다
- hooks, runners, dashboard는 같은 세션 상태를 공유한다

## 비목표

- 현재 구현 phase나 완료 상태 기록
- 테스트 통과 수치 기록
- 세션 점수 규칙의 상세 수학
- HITL UX 전체 설계

이 문서는 현재 채택된 세션 상태 주입 설계를 설명한다.
세부 분해와 후속 작업은 `docs/*/design/improved/*`에서 관리한다.
