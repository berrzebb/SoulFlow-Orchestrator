# Interactive Loop 설계

## 목적

`interactive loop`는 페이즈 실행 중 에이전트가 사용자와 왕복 대화를 하며 명세를 수집하거나 진행 중 질문을 해결하도록 만드는 설계다.
이 구조의 목적은 “한 번 실행하고 끝나는 에이전트 호출”과 “사용자 응답을 기다리며 계속 이어지는 작업”을 분리하는 것이다.

현재 프로젝트에서 interactive loop는 다음 상황을 다루기 위해 존재한다.

- 명세를 사용자와 함께 채워 나가야 하는 phase
- 구현 도중 막힌 지점을 사용자에게 되물어야 하는 phase
- 자동화만으로 닫을 수 없어서 HITL 전환이 필요한 phase

## 현재 구조에서의 위치

interactive loop는 별도의 독립 실행기가 아니라 `phase loop` 안의 실행 모드다.
현재 phase 정의는 `parallel`, `interactive`, `sequential_loop` 세 가지 모드를 가지며, interactive는 그 중 “사용자와의 왕복을 전제로 하는 모드”를 의미한다.

즉 이 설계의 위치는 다음과 같다.

- `phase loop`가 상위 실행 모델
- `interactive loop`는 그 안의 한 phase mode
- 상태 전환은 workflow store와 phase state 안에서 추적
- 사용자 입력 재개는 채널/HITL 계층이 담당

## 핵심 계약

interactive loop의 핵심 계약은 마커 기반이다.

- `[ASK_USER]`
- `[SPEC_COMPLETE]`

`[ASK_USER]`는 에이전트가 다음 진행에 필요한 질문을 사용자에게 넘겨야 함을 뜻한다.
이 마커가 나오면 현재 workflow 상태는 `waiting_user_input`으로 전환될 수 있고, 응답이 들어오면 같은 phase가 다음 iteration으로 이어진다.

`[SPEC_COMPLETE]`는 interactive phase가 요구하는 산출물이 충분히 정리됐음을 뜻한다.
이 마커가 나오면 interactive phase는 종료되고, 정리된 결과가 다음 phase의 입력으로 넘어간다.

이 구조의 핵심은 질문과 완료를 자연어 추론 결과에 묻어 두지 않고, phase runner가 이해할 수 있는 명시적 계약으로 만든다는 점이다.

## 상태 모델

interactive loop는 다음 상태를 전제로 한다.

- 반복 횟수
- 누적된 iteration 결과
- 사용자 입력 대기 여부
- 현재 phase의 workflow 상태

현재 구조에서 interactive loop는 “같은 에이전트가 무한히 살아 있는 세션”으로만 모델링되지 않는다.
반복마다 fresh context로 다시 실행될 수 있으며, 이전 질문/응답 기록과 누적 결과를 phase state가 보존하는 방식으로 작동한다.

즉 source of truth는 에이전트 세션 내부가 아니라 workflow state다.

## HITL 경계

interactive loop는 HITL을 포함하지만 approval 시스템과 같은 것은 아니다.

- interactive loop
  - 명세 수집, 추가 정보 요청, 대화형 보완
- approval flow
  - 승인/거부가 필요한 정책 게이트

이 둘은 모두 `waiting_user_input` 상태를 만들 수 있지만 의미는 다르다.
interactive loop는 “무엇을 해야 하는지 더 알아야 할 때” 사용되고, approval flow는 “다음 단계로 넘어가도 되는지 승인이 필요할 때” 사용된다.

## 현재 구조에서의 의미

이 프로젝트는 Slack, Telegram, 대시보드, workflow UI를 모두 다룬다.
따라서 사용자 입력 대기를 단순한 콘솔 프롬프트처럼 취급할 수 없다.

interactive loop는 그 문제를 해결하기 위해 다음 원칙을 채택한다.

- 사용자 질문은 phase 실행 계약의 일부다
- 대기/재개는 workflow 상태로 표현한다
- 질문/응답 기록은 반복 결과에 누적된다
- interactive phase 결과는 다음 phase의 입력이 된다

즉 interactive loop는 “채팅 UX 부가 기능”이 아니라 phase 기반 workflow가 사람과 함께 닫히도록 하기 위한 실행 모드다.

## 비목표

- 일반 task loop 전체를 interactive로 바꾸는 것
- approval 정책과 interactive 질문을 같은 계층으로 합치는 것
- 영속 PTY 세션 하나를 source of truth로 삼는 것
- 자유 대화를 무한히 이어 가는 채팅 세션을 만드는 것

이 문서는 현재 채택된 interactive loop 설계 개념을 설명한다.
세부 rollout, 작업 분해, 후속 개선은 `docs/*/design/improved/*`에서 관리한다.
