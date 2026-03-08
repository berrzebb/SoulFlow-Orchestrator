# Persona Message Renderer Design

작성일: 2026-03-07  
기준 코드베이스: 현재 작업 트리

## 목적

이 문서는 모든 사용자-facing 발화가
`같은 페르소나 규칙`과 `같은 톤/매너 정책`을 따르도록 만드는 설계 문서다.

핵심 요구는 두 가지다.

- 출력은 페르소나 기준으로 정규화되어야 한다
- 최종 문장은 사용자가 요청한 톤/매너에 맞게 동적으로 생성되어야 한다

즉, `정체성은 결정적이어야 하고`, `표현은 동적이어야 한다`.

---

## 핵심 판단

현재 구조는 두 종류의 사용자-facing 문장이 섞여 있다.

1. LLM이 생성한 자유 응답
2. 채널/오케스트레이션/워크플로우가 직접 만든 하드코딩 문장

이 두 경로가 분리되어 있으면 아래 문제가 반복된다.

- 어떤 응답은 페르소나/톤이 잘 적용됨
- 어떤 응답은 시스템 메시지처럼 딱딱하거나 내부 용어가 노출됨
- 어떤 응답은 모델 자기소개가 새어 나옴

따라서 해결 방향은 하나다.

`모든 사용자-facing 발화를 PersonaMessageRenderer로 수렴시킨다.`

---

## 목표 상태

### G1. 의미와 표현을 분리

시스템은 먼저 응답의 의미를 정규화한다.

예:

- `identity`
- `error`
- `status_started`
- `status_progress`
- `status_completed`
- `inquiry_summary`
- `workflow_resume_notice`
- `approval_processed`
- `expired_task_notice`

그다음 Renderer가 현재 persona/tone state를 반영해 실제 문장을 만든다.

### G2. tone/manner는 동적으로 결정

최종 문장은 다음 입력에 따라 달라질 수 있어야 한다.

- `SOUL.md`의 identity
- `HEART.md`의 기본 어투
- role skill의 `heart`
- `USER.md` 또는 메모리에 저장된 선호
- 현재 턴에서 사용자가 명시한 요구
  - 예: `반말로 말해`
  - 예: `조금 더 친근하게`
  - 예: `짧고 사무적으로 답해`

### G2-1. 이상한 컨셉의 톤/매너도 수용

축 기반 tone만으로는 부족하다.

예를 들어 아래 같은 요청은 모두 지원 가능해야 한다.

- `느와르 탐정처럼 말해`
- `중세 집사 느낌으로`
- `츤데레 PM처럼 툭툭 말해`
- `사이버펑크 안내원 컨셉으로`
- `쓸데없이 진지한 악당 프레젠터 톤으로`
- `판타지 세상의 주인공처럼`
- `크툴루 신화의 무언가처럼 기괴하게`
- `우주의 관찰자 같은 말투로`
- `중2병 캐릭터처럼 과장되게`

중요한 점은 이것이 `정체성 변경`이 아니라 `표현 컨셉 변경`이어야 한다는 점이다.

즉:

- identity는 그대로 유지
- 사실성, 보안, 정책, 도구 계약도 그대로 유지
- 바뀌는 것은 표면적 말투/어휘/리듬/비유뿐

### G3. 하드코딩 문자열도 renderer를 통과

아래도 예외 없이 renderer를 타야 한다.

- identity short-circuit 응답
- 채널 status 메시지
- 에러 메시지
- task/workflow resume 안내
- command reply wrapper
- approval 처리 안내
- expired task 안내

### G4. sanitizer는 마지막 guard

`output-sanitizer`는 계속 필요하다.
하지만 역할은 아래로 제한한다.

- 모델명/내부 메타/도구 프로토콜 누수 제거
- HTML/노이즈 제거

`tone/manner를 만드는 역할`은 renderer가 맡아야 한다.

---

## 아키텍처 개요

## 1. 의미 정규화 계층

오케스트레이터/채널/워크플로우는 먼저 `무슨 말을 해야 하는가`를 구조화한다.

예:

```ts
type PersonaMessageIntent =
  | { kind: "identity" }
  | { kind: "safe_fallback" }
  | { kind: "error"; reason: string }
  | { kind: "status_started" }
  | { kind: "status_progress"; label: string; tool_count?: number }
  | { kind: "status_completed" }
  | { kind: "workflow_resume" }
  | { kind: "approval_resumed" }
  | { kind: "approval_resume_failed" }
  | { kind: "expired_task"; objective?: string }
  | { kind: "inquiry_summary"; summary: string };
```

이 계층은 문장을 직접 만들지 않는다.
의미만 결정한다.

## 2. 스타일 해석 계층

Renderer는 현재 시점의 style snapshot을 만든다.

```ts
type PersonaStyleSnapshot = {
  persona_name: string;
  role_label: string | null;
  language: "ko" | "en";
  politeness: "formal" | "casual_polite" | "casual";
  warmth: "warm" | "neutral" | "cool";
  brevity: "short" | "normal" | "detailed";
  progress_style: "minimal" | "friendly";
  emoji_level: "none" | "low";
  concept_id: string | null;
  concept_label: string | null;
  concept_mode: "none" | "pack" | "ad_hoc";
  concept_brief: string | null;
  lexical_motifs: string[];
  banned_surface_patterns: string[];
  example_phrases: string[];
};
```

이 snapshot은 runtime마다 다시 계산할 수 있어야 한다.

## 3. surface rendering 계층

`PersonaMessageRenderer.render(intent, style)`가 실제 사용자-facing 문장을 반환한다.

예:

- `identity` + `formal` -> `저는 Sebastian입니다. 무엇을 도와드릴까요?`
- `identity` + `casual_polite` -> `저는 Sebastian이에요. 무엇을 도와드릴까요?`
- `status_started` + `friendly` -> `지금 바로 살펴보겠습니다.`
- `status_started` + `minimal` -> `분석 중입니다.`
- `error` + `formal` -> `처리에 문제가 있습니다. 원인: ... 조치: ...`
- `identity` + `concept: noir_detective` -> `저는 Sebastian입니다. 사건을 들려주시죠.`
- `status_started` + `concept: medieval_butler` -> `지금 바로 살펴보겠습니다, 주인님.`

### 4. 컨셉 레이어

tone axis만으로는 `이상한 컨셉`을 충분히 표현할 수 없다.

따라서 renderer는 두 레이어를 함께 가져야 한다.

1. axis layer  
   - politeness
   - warmth
   - brevity
   - progress_style

2. concept layer  
   - 특정 어휘군
   - 특정 문장 리듬
   - 특정 비유/세계관
   - 금지해야 할 과장 표현

예:

- `formal + warm + noir_detective`
- `casual_polite + cool + cyberpunk_operator`
- `casual + warm + tsundere_pm`
- `formal + warm + fantasy_protagonist`
- `formal + cool + cosmic_entity`
- `casual + dramatic + chunibyo_character`

이렇게 해야 표준 톤과 특수 컨셉을 동시에 다룰 수 있다.

---

## Tone/Manner 결정 규칙

## 1. 우선순위

style은 아래 우선순위로 결정한다.

1. 보안/채널 제약
2. identity invariants
3. 현재 턴 명시 지시
4. 현재 세션의 저장된 tone/concept override
5. `USER.md` / 메모리의 장기 선호
6. role skill의 `heart`
7. `HEART.md` 기본값
8. 시스템 기본값

즉, 사용자가 방금 `반말로`라고 했으면,
기본 집사 어투보다 그 지시가 우선한다.

## 2. 현재 턴 지시 해석

현재 턴에서 아래와 같은 표현을 감지하면 style override를 만든다.

- `반말로`
- `존댓말로`
- `조금 더 공손하게`
- `친근하게`
- `짧게`
- `장황하지 않게`
- `딱딱하게`
- `사무적으로`
- `느와르 탐정처럼`
- `중세 집사처럼`
- `츤데레처럼`
- `사이버펑크 느낌으로`
- `악당 프레젠터처럼`

이건 full LLM 분류까지 갈 필요는 없다.
경량 parser 또는 small classifier signal이면 충분하다.

권장 타입:

```ts
type ToneOverride = Partial<Pick<
  PersonaStyleSnapshot,
  "politeness" | "warmth" | "brevity" | "progress_style" | "emoji_level"
>>;
```

확장 타입:

```ts
type ConceptOverride = {
  concept_id?: string;
  concept_label?: string;
  concept_mode?: "pack" | "ad_hoc";
  concept_brief?: string;
};
```

즉, tone override와 concept override를 분리해야 한다.

## 3. persistence 정책

명시적 현재 턴 지시를 영구 저장할지 여부는 분리해야 한다.

- `이번 대화에서는 반말로` -> session override
- `앞으로 계속 반말로 말해` -> persistent preference

즉, style change도 두 종류가 있어야 한다.

- ephemeral session override
- persisted preference

컨셉도 동일하다.

- `이번 대화만 탐정처럼` -> session concept
- `앞으로는 계속 집사 컨셉으로` -> persistent concept

---

## Concept Pack 지원

## 1. 왜 pack이 필요한가

`formal/casual` 같은 축은 범용성이 높지만,
이상한 컨셉은 다음 정보가 더 필요하다.

- 어휘 모티프
- 문장 길이/리듬
- 호칭 습관
- 진행 보고 패턴
- 에러 시 말투
- 과도한 연기 금지 규칙

이건 단일 축 값으로 표현하기 어렵다.

## 2. 제안 구조

권장 타입:

```ts
type PersonaConceptPack = {
  id: string;
  label: string;
  summary: string;
  language?: "ko" | "en" | "any";
  lexical_motifs: string[];
  preferred_openers: string[];
  preferred_closers: string[];
  example_phrases: string[];
  banned_patterns: string[];
  constraints: string[];
  compatible_axes?: Partial<Pick<
    PersonaStyleSnapshot,
    "politeness" | "warmth" | "brevity" | "progress_style" | "emoji_level"
  >>;
};
```

예:

- `noir_detective`
- `medieval_butler`
- `cyberpunk_operator`
- `tsundere_pm`
- `villain_presenter`
- `fantasy_hero`
- `cthulhu_whisperer`
- `cosmic_observer`
- `chunibyo_protagonist`

## 3. 저장 위치

1차 권장:

- workspace 사용자 정의 팩: `templates/persona-concepts/*.md`
- builtin 팩: `src/persona/concepts/*.md`

이유:

- weird concept는 사용자별 커스터마이즈 수요가 높다
- role skill과 섞으면 책임이 꼬인다
- role skill은 실행 역할, concept pack은 surface style이므로 분리하는 것이 맞다

## 4. ad-hoc concept fallback

사용자가 `빙하 위의 철학자처럼 말해` 같이
미리 등록되지 않은 컨셉을 말할 수 있다.

이 경우 renderer는 두 단계로 동작해야 한다.

1. ad-hoc concept brief 생성  
   - 짧은 설명만 만든다
   - 예: `차갑고 느린 리듬, 비유적 표현, 과장 금지`
   - 예: `우주적 존재처럼 말하되 인간을 위협하지 않고, 관조적 어휘와 장대한 비유 사용`
   - 예: `중2병 캐릭터처럼 말하되 과장된 선언문 스타일과 자기연출을 사용`

2. constrained surface generation  
   - 의미는 바꾸지 않고 표현만 재표면화

즉, 등록된 pack이 없더라도
`ad_hoc concept -> normalized brief` 경로가 필요하다.

---

## Source of Truth

## 1. identity

identity는 [prompts.ts](/d:/claude-tools/.claude/mcp-servers/slack/next/src/orchestration/prompts.ts#L6),
[context.service.ts](/d:/claude-tools/.claude/mcp-servers/slack/next/src/agent/context.service.ts#L66)
기준으로 `SOUL.md`에서 읽는다.

Renderer는 `persona_name`을 직접 하드코딩하지 않는다.

## 2. base tone

base tone은 아래에서 가져온다.

- `HEART.md`
- role skill의 `heart`

특히 [concierge SKILL.md](/d:/claude-tools/.claude/mcp-servers/slack/next/src/skills/roles/concierge/SKILL.md)
같은 role heart는 행동 규약으로 쓰고,
identity source와 섞지 않는다.

## 2-1. concept source

concept는 아래에서 읽을 수 있어야 한다.

- 현재 턴 명시 요청
- session override
- persistent user preference
- concept pack registry

중요:

- concept는 identity를 바꾸지 않는다
- concept는 role을 바꾸지 않는다
- concept는 surface style에만 영향을 준다

## 3. user preference

사용자 선호는 아래 중 하나에서 읽을 수 있다.

- `USER.md`
- session memory
- long-term memory
- render/profile settings

중요:

user preference는 persona를 바꾸는 것이 아니라
persona의 말투/길이/친밀도만 바꾸는 데 사용한다.

---

## Renderer API 제안

```ts
type PersonaRenderContext = {
  provider: string;
  chat_id: string;
  alias: string;
  sender_id?: string;
  current_request?: string;
  session_history?: Array<{ role: string; content: string }>;
};

interface PersonaMessageRenderer {
  resolve_style(ctx: PersonaRenderContext): Promise<PersonaStyleSnapshot>;
  render(intent: PersonaMessageIntent, ctx: PersonaRenderContext): Promise<string>;
  render_freeform(raw: string, ctx: PersonaRenderContext): Promise<string>;
  render_with_concept?(intent: PersonaMessageIntent, ctx: PersonaRenderContext): Promise<string>;
}
```

### `resolve_style()`

- persona name 조회
- heart/role heart 수집
- user tone preference 해석
- current-turn override 적용

### `render()`

- 구조화된 intent를 style에 맞는 문장으로 생성
- deterministic meaning + dynamic surface
- 표준 axis 스타일 우선 사용
- concept pack이 있으면 pack 규칙을 추가 적용

### `render_freeform()`

- LLM이 생성한 자유 응답을 tone 가이드에 맞게 normalize
- 여기서 의미를 다시 만들지는 않는다
- 필요하면 경량 rephrase를 할 수 있지만,
  1차 구현은 후처리 최소화가 낫다

### `render_with_concept()`

선택적 확장이다.

역할:

- weird concept가 있을 때
- deterministic intent를 유지한 채
- concept pack 또는 ad-hoc brief에 맞게 표면 표현만 재구성

권장 동작:

1. semantic slot 생성
2. concept-aware phrasing
3. sanitizer 적용

---

## Surface Generation 전략

## 1. 표준 스타일

표준 스타일은 템플릿 기반 생성으로 충분하다.

예:

- `identity`
- `error`
- `status_started`

## 2. 등록된 concept pack

등록된 pack이 있으면 템플릿 + pack phrase bank 조합으로 생성한다.

예:

- 동일 intent라도 opener/closer/어휘 선택이 pack에 따라 달라짐

## 3. ad-hoc concept

ad-hoc concept는 아래 중 하나를 사용한다.

1. 경량 rule-based paraphrase
2. 아주 작은 surface-only generation pass

단, 이 pass는 다음 제한을 반드시 지켜야 한다.

- identity 변경 금지
- 사실 변경 금지
- 보안 정책 변경 금지
- tool/result 내용 변경 금지
- 의미 슬롯 보존

즉, 이 단계는 `creative rewrite`가 아니라 `surface styling`이어야 한다.

### 현재 정책 확정 (2026-03-07)

- deterministic/system message 경로에서는 **등록된 concept pack만** 직접 적용한다.
- `adhoc:` concept는 현재
  - 사용자 요청을 인식했다는 신호
  - style snapshot에 남는 힌트
  로만 사용한다.
- `adhoc:` concept를 deterministic message에 직접 반영하는 surface-only styling 계층은
  아직 구현 범위에 넣지 않는다.

즉, 현재 구현 기준으로:

- `fantasy_hero`, `cosmic_observer`, `chunibyo` 같은 등록 pack은 deterministic message에 적용 가능
- `해적 선장처럼`, `크툴루 세상의 무언가처럼` 같은 ad-hoc concept는 **파싱/보존만** 하고,
  deterministic message를 재작성하지 않는다

이 결정은 audit 항목이 아니라 제품 정책이다.
안전한 surface-only styling 계층이 추가되기 전까지는 그대로 유지한다.

---

## 안전 경계

이상한 컨셉을 지원하더라도 아래는 절대 바뀌면 안 된다.

- persona identity
- 보안 문구
- 정책 위반 여부
- tool execution 결과
- 실패/승인/경고의 의미

예를 들어 `악당 프레젠터 컨셉`이어도:

- secret 노출 금지
- 사용자를 모욕하는 방향 금지
- 내부 모델명 누출 금지
- 사실을 바꾸는 연기 금지

예를 들어 `크툴루적 존재`나 `우주의 무언가` 컨셉이어도:

- 공포감 조성은 surface level로만 제한
- 위협/저주/위험 유도 금지
- 정신 이상을 강요하는 표현 금지
- 사용자 대상 적대/모욕 금지

예를 들어 `중2병 캐릭터` 컨셉이어도:

- 과장된 선언/세계관 비유는 허용
- 사실과 결과는 왜곡 금지
- 승인/오류/보안 문구는 의미 보존
- 사용자가 불편해하면 즉시 normal tone으로 복귀 가능해야 함

즉, concept는 `surface costume`일 뿐이다.

---

## 어디에 연결해야 하는가

## 1. OrchestrationService

대상:

- [service.ts](/d:/claude-tools/.claude/mcp-servers/slack/next/src/orchestration/service.ts#L343)
- `identity short-circuit`
- `safe fallback`
- `inquiry short-circuit`

변경:

- 문자열 직접 반환 금지
- `PersonaMessageIntent` 생성 후 renderer 사용

예:

```ts
if (decision.action === "identity") {
  const reply = await this.persona_renderer.render({ kind: "identity" }, ctx);
  return { reply, mode: "once", tool_calls_count: 0, streamed: false };
}
```

## 2. ChannelManager

대상:

- [manager.ts](/d:/claude-tools/.claude/mcp-servers/slack/next/src/channels/manager.ts#L600)
- [manager.ts](/d:/claude-tools/.claude/mcp-servers/slack/next/src/channels/manager.ts#L712)
- [manager.ts](/d:/claude-tools/.claude/mcp-servers/slack/next/src/channels/manager.ts#L850)

변경:

- `"🔍 분석 중..."` 하드코딩 제거
- `"✓ 완료"` 하드코딩 제거
- `"작업 실패"` 하드코딩 제거
- workflow/task/approval resume 안내도 renderer 사용

특히 상태 메시지는 문장 길이 제약이 있으므로
renderer가 `status` 전용 짧은 surface를 지원해야 한다.

## 3. command reply wrapper

`send_command_reply()`는 command 내용 자체를 재작성하지 않더라도,
prefix / suffix / 문장 톤은 renderer 정책을 따를 수 있어야 한다.

대상:

- [manager.ts](/d:/claude-tools/.claude/mcp-servers/slack/next/src/channels/manager.ts#L865)

### 현재 정책 확정 (2026-03-07)

- `command_reply`는 **renderer를 반드시 경유**한다.
- 하지만 command body 자체는 tool/command가 만든 semantic payload로 간주하고,
  현재는 renderer가 이를 **재작성하지 않는다**.
- 즉 현재 구현의 목표는:
  - 경로 수렴
  - metadata / parse mode / persona pipeline 일관성 확보
  이지,
  command 본문을 톤/매너에 맞게 다시 쓰는 것이 아니다.

따라서 현재의 `command_reply -> body passthrough`는 미완성 버그가 아니라
의도된 정책으로 본다.

향후 필요하면 아래만 확장할 수 있다.

- prefix / suffix
- 짧은 wrapper phrase
- provider별 formatting policy

그러나 command 본문 의미 자체는 재작성하지 않는다.

## 4. workflow / approval / expire notice

대상:

- approval resume / failure
- workflow resume
- expired task notice

이 경로들은 지금 시스템 메시지 톤이 강하므로 renderer 수렴 효과가 크다.

---

## 구현 전략

## Phase 1. renderer 도입, 특수 응답만 수렴

먼저 아래만 옮긴다.

- identity
- safe fallback
- status_started
- status_progress
- status_completed
- error

이 단계만으로도 체감 품질이 크게 올라간다.

## Phase 2. workflow/task/system notice 수렴

다음 경로를 옮긴다.

- approval resume
- workflow resume
- expired task
- confirmation/guard notice

## Phase 3. tone override 해석 추가

현재 턴의 명시 지시를 반영한다.

- `반말로`
- `짧게`
- `사무적으로`
- `탐정처럼`
- `집사처럼`
- `사이버펑크처럼`

이 단계에서 session override 저장까지 도입한다.

## Phase 4. concept pack registry 연결

- builtin concept pack 로딩
- workspace concept pack 로딩
- session/persistent concept override 연결

## Phase 5. persistent preference 연결

`USER.md`, memory, settings를 style source로 통합한다.

---

## 테스트 계획

## T1. renderer unit

신규 테스트 권장:

- `tests/channels/persona-message-renderer.test.ts`

케이스:

- `identity + formal`
- `identity + casual_polite`
- `error + formal`
- `status_started + minimal`
- `status_started + friendly`
- `identity + noir_detective`
- `error + medieval_butler`
- `status_started + tsundere_pm`
- `identity + fantasy_hero`
- `status_started + cthulhu_whisperer`
- `error + cosmic_observer`
- `safe_fallback + chunibyo_character`

## T2. style resolver unit

케이스:

- 기본 `HEART.md`만 있을 때
- role heart가 있을 때
- `반말로 말해` current override가 있을 때
- persistent user preference가 있을 때
- `느와르 탐정처럼` current concept override가 있을 때
- ad-hoc concept를 brief로 정규화할 때
- `판타지 주인공처럼` current concept override가 있을 때
- `크툴루 세상의 무언가처럼` 요청을 안전한 brief로 정규화할 때
- `중2병 캐릭터처럼` 요청을 과장 surface로 변환하되 의미를 보존할 때

## T3. orchestration integration

케이스:

- identity short-circuit가 renderer를 통해 응답
- safe fallback이 `native_backend_empty`를 사용자-facing 실패로 노출하지 않음

## T4. channel integration

케이스:

- status mode가 같은 tone을 유지
- error message도 같은 tone을 유지
- workflow/approval resume notice도 같은 tone을 유지
- weird concept가 system replies에도 일관되게 반영됨
- `판타지/코스믹/중2병` 같은 고변동 컨셉도 deterministic replies에 반영됨

---

## 완료 판정 기준

- identity, error, status, workflow/task 안내 메시지가 같은 persona tone을 유지한다
- 사용자가 `반말로`, `짧게`, `친근하게`를 요청하면 deterministic/system replies에도 반영된다
- 사용자가 `탐정처럼`, `중세 집사처럼`, `사이버펑크 느낌으로` 같은 컨셉을 요청하면 deterministic/system replies에도 반영된다
- 사용자가 `판타지 주인공`, `크툴루적 존재`, `우주의 관찰자`, `중2병 캐릭터` 같은 컨셉을 요청해도 deterministic/system replies에도 반영된다
- `SOUL.md`의 identity와 `HEART.md`의 기본 어투가 함께 반영된다
- role heart는 행동/어투만 조정하고 identity source를 바꾸지 않는다
- `output-sanitizer`는 여전히 leak guard로만 동작한다
- weird concept가 적용돼도 의미/보안/정책은 변하지 않는다

---

## 비목표

- 모든 자유 생성 응답을 renderer가 재작성하지 않는다
- 첫 단계에서 감정 모델링이나 스타일 LLM 재호출까지 도입하지 않는다
- role skill 구조 전체를 다시 설계하지 않는다
- concept pack이 role system을 대체하지 않는다

---

## 최종 권고

페르소나 품질을 안정화하려면
`좋은 프롬프트`만으로는 부족하고,
`좋은 후처리 정규식`만으로도 부족하다.

필요한 것은 아래 구조다.

1. 의미는 분류/오케스트레이션에서 정규화
2. 표현은 PersonaMessageRenderer가 축 기반 tone과 concept pack을 함께 사용해 동적으로 생성
3. sanitizer는 마지막 누수 방지

한 문장으로 정리하면 이렇다.

`정체성은 결정적으로 유지하되, 최종 문장은 사용자 요구 톤/매너와 심지어 이상한 컨셉까지 반영해 동적으로 생성하도록 사용자-facing 출력 경로 전체를 PersonaMessageRenderer로 수렴시켜야 한다.`
