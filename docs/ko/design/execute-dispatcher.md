# Execute Dispatcher 설계

## 목적

`execute dispatcher`는 preflight가 준비한 요청을 실제 실행 경로로 연결하는 오케스트레이션 분기 계층이다.
이 계층의 역할은 “이 요청을 어떤 방식으로 처리할 것인가”를 한 곳에서 결정하고, 그 결정을 runner와 gateway binding으로 일관되게 전달하는 것이다.

현재 프로젝트는 모든 요청을 동일한 agent loop로 처리하지 않는다.
대신 dispatcher가 요청 성격과 현재 런타임 상태를 보고 다음 경로를 선택한다.

- short-circuit 응답
- direct tool 실행
- once 실행
- agent loop
- task loop
- phase workflow

## 위치

```text
Inbound Request
  -> Request Preflight
  -> Execute Dispatcher
  -> once / agent / task / phase runner
```

dispatcher는 preflight 이후, 실제 runner 이전에 존재한다.
입력 조립은 preflight에서 끝나고, 실행 분기와 fallback은 dispatcher가 담당한다.

## 핵심 책임

### 1. gateway 판단 수용

dispatcher는 `resolve_gateway()`의 결정을 받아 현재 요청의 1차 실행 전략을 얻는다.

이 판단에는 다음 요소가 반영된다.

- 현재 사용자 요청
- 최근 세션 히스토리
- 활성 task 존재 여부
- 사용 가능한 skill / tool category
- executor capability

dispatcher는 이 결과를 실행 가능한 분기로 바꾼다.

### 2. short-circuit 처리

모든 요청이 runner까지 갈 필요는 없다.
dispatcher는 다음 경우를 조기 종료한다.

- `identity`
- `builtin`
- `inquiry`

또한 direct tool 실행이 안전하고 결정적일 때는 LLM loop 대신 직접 실행할 수 있다.

이 구조의 목적은 비싼 실행 루프를 최소화하고, 결정론적 처리를 앞당기는 데 있다.

### 3. session reuse / freshness gate 적용

phase 실행이 아닌 경우, dispatcher는 최근 세션 증거를 보고 재사용이 적절한지 먼저 판단할 수 있다.

- 이미 같은 질의가 최근에 처리되었는지
- 같은 주제인지
- freshness window 안인지

이 계층은 “지금 당장 새 도구 호출이 필요한가”를 판단하는 첫 번째 경제성 게이트다.

### 4. executor / mode 확정

short-circuit를 통과한 요청은 실제 mode와 executor를 확정한다.

- `phase`
- `once`
- `agent`
- `task`

동시에 사용자 선호 provider, configured executor, capability fallback도 반영한다.

### 5. tool selection 및 system prompt 진입

phase가 아닌 경로에 대해서는 dispatcher가 tool selection과 system prompt 진입점을 연다.

다만 이 계층은 prompt 내용을 직접 정의하지 않는다.
prompt baseline은 runtime / role / protocol 계층이 제공하고, dispatcher는 그것을 어느 실행 경로에 넣을지만 결정한다.

### 6. confirmation / escalation / fallback 관리

dispatcher는 단순 분기기만이 아니라 bounded control layer이기도 하다.

- confirmation guard로 위험 작업을 보류
- once 결과가 부족하면 task loop로 escalation
- agent 결과가 approval 성격이면 task loop로 escalation
- executor 실패 시 fallback chain 재시도

즉 dispatcher는 요청을 “한 번 어디로 보낼지”만 고르는 것이 아니라, 실행 경계 내에서 허용된 승격과 fallback도 책임진다.

### 7. finalize와 공통 종료 처리

모든 실행 결과는 dispatcher의 finalize 경로를 지나며 정리된다.

- workflow event 기록
- process tracker 정리
- usage / tool count 반영
- validator / reviewer 역할의 follow-up checklist 부착

이 설계 덕분에 runner마다 결과 마감 정책을 따로 중복 구현하지 않는다.

## 경계

dispatcher가 하지 않아야 할 일도 중요하다.

- 입력 seal, secret 점검, skill 추천을 다시 하지 않는다
- role policy나 protocol 문서를 직접 해석하지 않는다
- persona 문장을 직접 생성하지 않는다
- tool body 실행 자체를 소유하지 않는다
- workflow definition을 생성하거나 저장하지 않는다

즉 dispatcher는 “준비된 요청을 실행기 쪽으로 연결하는 계층”이지, preflight나 runner의 대체물이 아니다.

## 현재 구조의 라우팅 순서

현재 채택된 흐름은 대략 다음 순서를 따른다.

```text
gateway decision
  -> identity / builtin / inquiry short-circuit
  -> optional direct tool
  -> session reuse gate
  -> mode / executor resolution
  -> phase branch or tool selection
  -> confirmation guard
  -> once / agent / task runner
  -> escalation / fallback
  -> finalize
```

이 순서의 의도는 다음과 같다.

- 가장 싼 판단을 먼저 한다
- 가장 비싼 loop는 가장 늦게 연다
- deterministic 처리와 reuse 가능성을 먼저 소진한다
- 결과 마감은 항상 동일한 정책으로 묶는다

## gateway 및 direct execution과의 관계

dispatcher는 gateway와 direct execution을 포함하지만, 둘과 동일한 계층은 아니다.

- gateway는 “무슨 종류의 요청인가”를 판단한다
- direct executor는 LLM 없이 실행 가능한 결정론적 도구를 수행한다
- dispatcher는 이 둘을 받아 전체 실행 경로에 배치한다

따라서 gateway나 direct executor가 확장되더라도 dispatcher의 책임은
“경로 선택과 bounded escalation/finalize”
로 유지되어야 한다.

## 세션 재사용 정책과의 관계

dispatcher는 세션 재사용의 첫 적용 지점이다.
하지만 재사용 정책의 source of truth 자체는 별도 guardrail 계층에 있다.

즉 dispatcher는 다음만 한다.

- evidence를 받아 reuse를 평가한다
- reuse가 유효하면 short-circuit한다
- 그렇지 않으면 정상 실행으로 넘긴다

재사용 판정 규칙, freshness, retry bypass 같은 정책 세부는 guardrail 설계 문서가 담당한다.

## 비목표

- 작업 완료 여부나 감사 상태 관리
- 세션 메모리 영속화 전략 정의
- tool ranking 알고리즘 설계
- role / protocol / persona 자체의 source of truth 역할

이 문서는 현재 프로젝트가 dispatcher를 어떤 책임 경계로 채택했는지 설명한다.
세부 작업 분해와 후속 구현은 `docs/*/design/improved/*`에서 관리한다.
