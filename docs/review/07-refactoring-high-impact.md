# 높은 효과 리팩토링 (High Impact Refactoring)

작성일: 2026-03-11
기준 코드베이스: 현재 저장소

## 목적

이 문서는 코드 품질과 유지보수성에 높은 효과를 가져올 수 있는 리팩토링 4건(R1–R4)을 기록한다.
각 항목에 대해 현재 문제, 코드 분리 설계, 구현 계획을 포함한다.

이 문서의 리팩토링은 `docs/LARGE_FILE_SPLIT_DESIGN.md`의 분할 원칙을 따른다.

분할 원칙:
1. 의미 보존 우선 — 정책 변경 금지
2. public surface 먼저 고정 — 외부 표면 변경 금지
3. pure logic과 side effect 먼저 분리
4. 남은 deferred binding은 bundle 내부에만
5. stateful object는 로직보다 나중에 분리

---

## R1: 채널 HTTP 유틸리티 추출

### 현재 문제

Slack, Discord, Telegram 3개 채널에서 HTTP 호출 + JSON 파싱 + 에러 처리 패턴이 중복된다.
약 150 LOC가 3개 파일에 걸쳐 반복된다.

```typescript
// slack.channel.ts, discord.channel.ts, telegram.channel.ts 모두에서 반복:
const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
});
const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
if (!response.ok) return { ok: false, error: String(data.message || `http_${response.status}`) };
```

### 코드 분리 설계

#### 목표 구조

```
src/channels/
├── base.ts                    ← 기존 (수정)
├── http-utils.ts              ← 신규: HTTP 유틸리티
├── slack.channel.ts           ← 수정: http-utils 사용
├── discord.channel.ts         ← 수정: http-utils 사용
└── telegram.channel.ts        ← 수정: http-utils 사용
```

#### 또는 BaseChannel 확장

```typescript
// src/channels/base.ts에 추가
export abstract class BaseChannel {
  // 기존 메서드...

  protected async api_post<T extends Record<string, unknown>>(
    url: string,
    payload: unknown,
    options?: { timeout_ms?: number; headers?: Record<string, string> },
  ): Promise<{ ok: boolean; data?: T; error?: string }> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(options?.timeout_ms ?? 30_000),
      });
      const data = (await response.json().catch(() => ({}))) as T;
      if (!response.ok) {
        return {
          ok: false,
          error: String(
            (data as Record<string, unknown>).message ??
            (data as Record<string, unknown>).description ??
            `http_${response.status}`
          ),
        };
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: error_message(e) };
    }
  }

  protected async api_post_form(
    url: string,
    form: FormData,
    options?: { timeout_ms?: number; headers?: Record<string, string> },
  ): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
    // FormData 전송용 변형
  }
}
```

### 구현 계획

#### 단계 1: BaseChannel에 api_post 메서드 추가

기존 `BaseChannel` 클래스에 `api_post()`를 추가한다.
이 단계에서는 기존 코드를 변경하지 않는다.

#### 단계 2: 각 채널에서 중복 코드를 api_post로 교체

한 채널씩 순차적으로 교체한다.
1. Slack → 테스트 확인
2. Discord → 테스트 확인
3. Telegram → 테스트 확인

#### 단계 3: 중복 코드 정리

교체 완료 후 각 채널에 남아 있는 중복 `fetch` 패턴을 제거한다.

### 금지 사항

- 에러 응답 형태 변경 금지 (기존 `{ ok, error }` 유지)
- 타임아웃 기본값 변경 금지
- FormData 전송 로직의 Content-Type 변경 금지

### 완료 기준

- 3개 채널에서 `fetch` + JSON 파싱 + 에러 처리 중복이 제거됨
- 기존 채널 테스트가 모두 통과함
- 약 150 LOC 절감

### 예상 변경 범위

- `src/channels/base.ts` (메서드 추가)
- `src/channels/slack.channel.ts` (중복 제거)
- `src/channels/discord.channel.ts` (중복 제거)
- `src/channels/telegram.channel.ts` (중복 제거)
- 관련 테스트 파일

---

## R2: 노드 핸들러 캐스팅 헬퍼

### 현재 문제

139개 노드 핸들러의 `execute()`, `runner_execute()`, `test()` 메서드에서 노드 타입 캐스팅이 290회 반복된다.

```typescript
// 모든 핸들러에서 반복
const n = node as HttpNodeDefinition;
const n = node as LlmNodeDefinition;
const n = node as DatabaseNodeDefinition;
// ... 290회
```

### 코드 분리 설계

#### 목표 구조

```
src/agent/nodes/
├── _helpers.ts                ← 신규: 캐스팅 + 템플릿 헬퍼
├── http.ts                    ← 수정: 헬퍼 사용
├── llm.ts                     ← 수정: 헬퍼 사용
└── ... (139개)
```

#### 헬퍼 설계

```typescript
// src/agent/nodes/_helpers.ts

import type { OrcheNodeDefinition, OrcheNodeExecutorContext } from "./types.js";

/**
 * 노드 타입 캐스팅 + 런타임 검증
 */
export function as_node<T extends OrcheNodeDefinition>(
  node: OrcheNodeDefinition,
  expected_type: string,
): T {
  if (node.node_type !== expected_type) {
    throw new Error(`Expected node_type '${expected_type}', got '${node.node_type}'`);
  }
  return node as T;
}

/**
 * 템플릿 컨텍스트 생성 (123개 핸들러에서 반복되는 보일러플레이트)
 */
export function create_tpl_ctx(ctx: OrcheNodeExecutorContext): { memory: Record<string, unknown> } {
  return { memory: ctx.memory };
}
```

#### 사용 예시

```typescript
// 변경 전
const n = node as HttpNodeDefinition;
const tpl_ctx = { memory: ctx.memory };
const url = resolve_templates(n.url || "", tpl_ctx);

// 변경 후
const n = as_node<HttpNodeDefinition>(node, "http");
const tpl_ctx = create_tpl_ctx(ctx);
const url = resolve_templates(n.url || "", tpl_ctx);
```

### 구현 계획

#### 단계 1: 헬퍼 파일 생성

`src/agent/nodes/_helpers.ts`를 생성하고 `as_node()`, `create_tpl_ctx()`를 구현한다.

#### 단계 2: 점진적 교체

한 번에 모든 139개를 바꾸지 않는다.
다음 순서로 진행한다.
1. 가장 자주 수정되는 핸들러부터 (http, llm, shell, file, database)
2. 나머지 핸들러는 변경이 생길 때 함께 교체

#### 단계 3: 템플릿 컨텍스트도 교체

`create_tpl_ctx()` 사용으로 123건의 보일러플레이트를 제거한다.

### 금지 사항

- 노드 핸들러 인터페이스(`NodeHandler`) 변경 금지
- `execute()`, `runner_execute()`, `test()` 시그니처 변경 금지
- 기존 런타임 동작 변경 금지

### 완료 기준

- `as_node()` 사용으로 런타임 타입 검증 추가
- 290건 캐스팅 + 123건 보일러플레이트 제거
- 기존 노드 테스트 모두 통과

### 예상 변경 범위

- `src/agent/nodes/_helpers.ts` (신규)
- `src/agent/nodes/*.ts` (점진적 교체)

---

## R3: 템플릿 컨텍스트 보일러플레이트 제거

### 현재 문제

R2에 포함. `create_tpl_ctx(ctx)` 헬퍼로 해결.
R2와 동시 진행한다.

---

## R4: DashboardService 분할

### 현재 문제

724 LOC의 `DashboardService`가 라우팅, SSE, 채팅 세션, 미디어, 메트릭을 모두 처리한다.
이것은 God Object 패턴이다.

현재 담당:
- HTTP 서버 생성 및 요청 라우팅 (21개 라우트)
- SSE 브로드캐스트 관리
- 채팅 세션 (인메모리 Map)
- 미디어 토큰 스토어
- 시스템 메트릭 수집
- 상태 빌더

### 코드 분리 설계

#### 목표 구조

```
src/dashboard/
├── service.ts                 ← 축소: 조합 facade만 남김
├── route-registry.ts          ← 신규: 라우트 등록 및 매핑
├── broadcast-service.ts       ← 기존 broadcaster.ts 확장 또는 별도
├── chat-session-store.ts      ← 신규: 채팅 세션 관리
├── sse-manager.ts             ← 기존 유지
├── media-store.ts             ← 기존 유지
├── system-metrics.ts          ← 기존 유지
├── state-builder.ts           ← 기존 유지
├── ops-factory.ts             ← 기존 유지 (re-export facade)
├── ops/                       ← 기존 유지
└── routes/                    ← 기존 유지
```

#### 분리 축

##### 축 1: RouteRegistry 추출

```typescript
// src/dashboard/route-registry.ts
export class RouteRegistry {
  private routes = new Map<string, RouteHandler>();

  register(path: string, handler: RouteHandler): void {
    this.routes.set(path, handler);
  }

  resolve(path: string): RouteHandler | undefined {
    return this.routes.get(path);
  }

  list(): string[] {
    return [...this.routes.keys()];
  }
}
```

`DashboardService._init_routes()`의 21개 라우트 등록을 RouteRegistry로 이동한다.

##### 축 2: ChatSessionStore 추출

```typescript
// src/dashboard/chat-session-store.ts
export class ChatSessionStore {
  private sessions = new Map<string, ChatSession>();

  get(id: string): ChatSession | undefined;
  create(id: string): ChatSession;
  delete(id: string): boolean;
  list(): ChatSession[];
}
```

`DashboardService` 내부의 채팅 세션 Map과 관련 메서드를 이동한다.

##### 축 3: DashboardService를 facade로 축소

```typescript
// src/dashboard/service.ts (축소 후)
export class DashboardService implements ServiceLike {
  readonly name = "dashboard";

  constructor(
    private route_registry: RouteRegistry,
    private chat_sessions: ChatSessionStore,
    private broadcaster: BroadcastService,
    private sse_manager: SseManager,
    // ...
  ) {}

  async start(): Promise<void> { /* HTTP 서버 시작 */ }
  async stop(): Promise<void> { /* HTTP 서버 중지 */ }
  health_check(): HealthResult { /* 하위 서비스 상태 집계 */ }
}
```

### 구현 계획

#### 단계 1: RouteRegistry 추출 (가장 안전)

1. `src/dashboard/route-registry.ts` 생성
2. `_init_routes()`의 라우트 등록을 RouteRegistry로 이동
3. `DashboardService`에서 RouteRegistry를 사용
4. 기존 라우트 동작 검증

#### 단계 2: ChatSessionStore 추출

1. `src/dashboard/chat-session-store.ts` 생성
2. 채팅 세션 관련 메서드 이동
3. DashboardService에서 ChatSessionStore 사용
4. 채팅 기능 검증

#### 단계 3: facade 축소

DashboardService가 조합만 담당하도록 축소한다.

### 금지 사항

- 대시보드 API 엔드포인트 경로 변경 금지
- SSE 이벤트 형식 변경 금지
- ops factory export 이름 변경 금지
- 라우트 핸들러 시그니처 변경 금지

### 완료 기준

- DashboardService가 400 LOC 이하로 축소됨
- 라우트 등록/매핑이 RouteRegistry로 분리됨
- 채팅 세션이 ChatSessionStore로 분리됨
- 기존 대시보드 테스트 모두 통과
- API 엔드포인트 동작 변경 없음

### 예상 변경 범위

- `src/dashboard/service.ts` (축소)
- `src/dashboard/route-registry.ts` (신규)
- `src/dashboard/chat-session-store.ts` (신규)
- `src/bootstrap/dashboard.ts` (의존성 주입 수정)
- 관련 테스트 파일

---

## 진행 상태

| 항목 | 효과 | 노력 | 상태 |
|------|------|------|------|
| R1: 채널 HTTP 유틸 | ~150 LOC 절감 | 중 | 미착수 |
| R2: 캐스팅 헬퍼 | 290건 중복 제거 | 중 | 미착수 |
| R3: 템플릿 보일러플레이트 | 123건 중복 제거 | 저 (R2에 포함) | 미착수 |
| R4: DashboardService 분할 | God Object 해소 | 중 | 미착수 |
