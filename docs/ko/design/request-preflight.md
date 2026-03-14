# Request Preflight 설계

## 목적

`request preflight`는 오케스트레이션 실행 전에 필요한 입력 정규화와 실행 준비를 한 곳에서 수행하는 계층이다.
이 단계의 목표는 사용자의 입력을 바로 실행기에 넘기지 않고, 이후 단계가 같은 전제 위에서 판단할 수 있는 준비된 요청 형태로 바꾸는 것이다.

핵심 의도는 다음과 같다.

- 민감 정보가 포함된 원문을 바로 실행 경로에 흘리지 않는다
- 재개 가능한 작업은 무거운 계산 전에 빠르게 감지한다
- skill, runtime policy, tool context 같은 실행 전제는 한 번만 계산한다
- dispatcher가 “무엇을 실행할지”에 집중하도록, 입력 정리와 실행 분기를 분리한다

## 위치

`OrchestrationService.execute()`의 첫 단계에 배치된다.

```text
Inbound Request
  -> Request Preflight
  -> Execute Dispatcher
  -> once / agent / task / phase runner
```

`request preflight`는 dispatcher보다 앞에 있고, runner보다 훨씬 앞에 있다.
즉 이 계층은 실행 전략을 결정하지 않고, 실행 전략 결정에 필요한 공통 입력만 만든다.

## 책임

### 1. 입력 seal

사용자 메시지와 media 입력은 가장 먼저 seal 처리한다.

- 텍스트는 `seal_inbound_sensitive_text()`를 통해 민감 정보를 치환한다
- seal 실패 시에도 원문을 그대로 넘기지 않고 `redact_sensitive_text()`로 축소한다
- local reference는 파일 경로 의미를 보존해야 하므로 media seal에서 예외 처리한다

이 규칙은 이후 skill 추천, secret 검사, dispatcher 분기 모두가 같은 sealed 입력을 보도록 하기 위한 것이다.

### 2. 재개 경로 조기 판단

`resumed_task_id`가 들어온 경우, 현재 런타임에 같은 작업이 `running` 상태인지 먼저 확인한다.

- 재개 가능한 작업이면 `kind: "resume"` 결과를 반환한다
- 이 경로에서는 heavy context를 만들지 않는다
- 재개 판단은 seal 이후, 나머지 전처리 이전에 끝나야 한다

이 설계는 재시도와 long-running task 복원을 빠르게 처리하기 위한 것이다.

### 3. secret 참조 점검

sealed 입력과 media를 기준으로 secret reference를 검사한다.

- 누락된 key
- 잘못된 ciphertext

를 모아서 `secret_guard`로 반환한다.

preflight는 secret을 직접 복호화하거나 실행 정책을 바꾸지 않는다.
여기서는 “실행을 계속해도 되는지 판단할 근거”만 만든다.

### 4. skill / policy / context 조립

재개 경로가 아니면 실행 준비 데이터를 계산한다.

- always skill + 추천 skill을 합쳐 `skill_names`를 결정한다
- `RuntimePolicyResolver`로 `runtime_policy`를 계산한다
- tool definition과 category map을 정리한다
- request scope, request task id, event base metadata를 만든다
- context block과 tool execution context를 만든다
- skill별 preferred provider를 수집한다
- 현재 chat 안의 active task를 모은다

이 결과는 dispatcher가 다시 계산하지 않고 그대로 사용한다.

### 5. tool index 준비

preflight는 tool definition과 category map을 바탕으로 tool index를 재구성할 수 있다.

이 책임은 “검색”이 아니라 “이 요청이 사용할 수 있는 도구 공간을 현재 런타임과 맞춘다”는 의미다.
실제 도구 선택은 dispatcher 이후 단계에서 일어난다.

## 입력과 출력

### 입력

- 원본 `OrchestrationRequest`
- secret vault
- agent runtime
- runtime policy resolver
- workspace 경로
- optional tool index

### 출력

`request preflight`의 출력은 둘 중 하나다.

- `ResumedPreflight`
  - 이미 실행 중인 task를 이어갈 수 있는 경우
- `ReadyPreflight`
  - dispatcher가 그대로 받아 실행 경로를 결정할 수 있는 준비된 요청

이 구조는 `kind` 기반 분기를 강제해, resume 경로와 ready 경로를 섞지 않도록 한다.

## 경계

`request preflight`가 해야 하지 않는 일도 명확하다.

- once / agent / task / phase 중 어떤 경로를 탈지 결정하지 않는다
- gateway routing을 수행하지 않는다
- 사용자-facing 답변을 만들지 않는다
- tool selection을 수행하지 않는다
- prompt profile이나 persona 문장을 합성하지 않는다

즉 preflight는 실행기가 아니라 준비기다.

## 현재 구조에서의 의미

현재 프로젝트는 `execute()`를 거대한 단일 함수로 두지 않고, `preflight -> dispatcher -> runner`로 분리한다.
이때 preflight는 다음 원칙을 지킨다.

- 입력 정규화는 여기서 끝낸다
- 이후 계층은 sealed 입력만 본다
- resume 여부와 ready 여부를 여기서 확정한다
- runtime skill / tool / policy 기반의 공통 문맥은 여기서 고정한다

이 설계가 있어야 dispatcher는 “어떤 실행 방식이 적절한가”에 집중할 수 있다.

## 비목표

- 회귀 추적, 감사 상태, 완료 여부 관리
- product workflow의 진행 상태 판단
- 세션 재사용 정책 그 자체의 결정
- role / protocol 기반 prompt 합성

이 문서는 현재 채택된 설계 개념을 설명한다.
세부 구현 순서와 남은 작업은 `docs/*/design/improved/*`에서 관리한다.
