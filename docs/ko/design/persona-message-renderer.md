# 페르소나 메시지 렌더러 설계

## 목적

이 문서는 모든 사용자-facing 발화가
같은 페르소나 규칙과 같은 톤/매너 정책을 따르도록 만드는 설계 요약이다.

핵심 요구:

- 출력은 페르소나 기준으로 정규화되어야 한다
- 최종 문장은 사용자가 요청한 톤/매너에 맞게 동적으로 생성되어야 한다

즉, 정체성은 결정적이고 표현은 동적이어야 한다.

## 핵심 판단

현재 시스템에는 두 종류의 사용자-facing 문장이 있다.

1. LLM이 생성한 자유 응답
2. 채널/오케스트레이션/워크플로우가 직접 만든 결정적 문장

이 둘이 분리되어 있으면 다음 문제가 반복된다.

- 어떤 응답은 페르소나/톤이 잘 적용됨
- 어떤 응답은 시스템 메시지처럼 딱딱함
- 어떤 응답은 내부 용어 또는 모델 자기소개가 노출됨

따라서 방향은 하나다.

`모든 사용자-facing 발화를 PersonaMessageRenderer로 수렴한다.`

## 목표 상태

### 1. 의미와 표현 분리

시스템은 먼저 “무슨 말을 해야 하는가”를 intent로 정규화하고,
그 다음 renderer가 현재 persona/tone state를 반영해 최종 문장을 만든다.

예시 intent:

- `identity`
- `safe_fallback`
- `error`
- `status_started`
- `status_progress`
- `status_completed`
- `workflow_resume_notice`
- `approval_processed`
- `expired_task_notice`
- `inquiry_summary`

### 2. tone / manner는 동적으로 결정

최종 문장은 다음 입력에 따라 달라질 수 있어야 한다.

- `SOUL.md`의 identity
- `HEART.md`의 기본 어투
- role skill의 `heart`
- `USER.md` 또는 memory에 저장된 사용자 선호
- 현재 턴에서 사용자가 명시한 요구

예:

- `반말로 말해`
- `조금 더 친근하게`
- `짧고 사무적으로 답해`

### 3. 이상한 컨셉도 수용

tone 축만으로는 부족하다.
다음 같은 surface concept도 수용 대상이다.

- 느와르 탐정
- 중세 집사
- 사이버펑크 안내원
- 판타지 세계의 주인공
- 크툴루풍 화자
- 우주의 관찰자
- 중2병 캐릭터

중요한 제약:

- identity는 바뀌지 않는다
- 사실성, 보안, 정책, 도구 계약도 바뀌지 않는다
- 바뀌는 것은 표면적 말투/어휘/리듬/비유뿐이다

### 4. 하드코딩 문자열도 renderer를 거친다

아래도 예외 없이 renderer를 타야 한다.

- identity short-circuit 응답
- 채널 status 메시지
- 에러 메시지
- task/workflow resume 안내
- command reply wrapper
- approval 처리 안내
- expired task 안내

### 5. sanitizer는 마지막 guard

`output-sanitizer`는 계속 필요하다.
하지만 역할은 leak guard에 한정한다.

- 모델명/내부 메타/도구 프로토콜 누수 제거
- HTML/노이즈 제거

tone/manner 생성은 renderer가 담당한다.

## 아키텍처 요약

### 의미 정규화 계층

오케스트레이터/채널/워크플로우는 먼저 intent를 구조화한다.

### PersonaMessageRenderer

Renderer는 다음 입력을 받아 최종 문장을 만든다.

- intent
- persona identity
- tone state
- role heart
- current-turn override
- persistent preference
- optional concept pack / ad-hoc concept

### 정책 우선순위

권장 우선순위:

1. safety / policy constraint
2. identity constraint
3. current-turn override
4. persistent user preference
5. role heart / default heart
6. fallback default tone

## 현재 정책

현재 기준으로 유지하는 제품 정책:

- deterministic/system message는 등록된 concept pack만 직접 적용
- ad-hoc concept는 parse/preserve는 가능하지만 deterministic message 재작성에는 바로 쓰지 않음
- `command_reply`는 renderer를 거치되 command body 자체는 재작성하지 않음

이 정책은 버그가 아니라 의도된 보수 정책이다.

## role / protocol 계층과의 관계

이 설계는 실행 baseline을 다루는 `role / protocol architecture`와 분리된다.

- role / protocol
  - system prompt와 실행 기준을 정한다
- persona renderer
  - deterministic user-facing 문장의 표현 계층을 정한다

즉 같은 persona 시스템 안에 있지만, 실행자 prompt와 사용자-facing 문장을 같은 계층으로 취급하지 않는다.

## 유지보수 원칙

- 페르소나의 source of truth는 문서/템플릿에 두고, sanitizer에 두지 않는다
- renderer는 표현 계층이고, 의미 결정은 classifier/gateway/orchestrator가 담당한다
- 새 deterministic message가 생기면 renderer intent부터 추가한다
- ad-hoc concept 지원은 safety/policy 경계를 먼저 고정한 뒤 넓힌다

이 문서는 현재 채택된 설계 개념을 설명한다.
세부 개선 작업과 분해는 `docs/*/design/improved/*`에서 관리한다.
