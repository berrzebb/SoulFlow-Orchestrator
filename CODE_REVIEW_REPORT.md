# SoulFlow-Orchestrator 코드베이스 리뷰 리포트

> **작성일**: 2026-03-11  
> **대상**: 전체 코드베이스 (src/ 92,341 LOC, tests/ 193,427 LOC, 637 소스 파일, 933 테스트 파일)

---

## 목차

1. [잘된 점 (Strengths)](#1-잘된-점-strengths)
2. [문제점 (Issues)](#2-문제점-issues)
3. [개선점 (Improvements)](#3-개선점-improvements)
4. [리팩토링 기회 (Refactoring Opportunities)](#4-리팩토링-기회-refactoring-opportunities)
5. [종합 평가](#5-종합-평가)

---

## 1. 잘된 점 (Strengths)

### 1.1 아키텍처 설계 ⭐⭐⭐⭐⭐

#### 계층적 부트스트랩 패턴
`src/main.ts`와 `src/bootstrap/` 디렉토리의 부트스트랩 시퀀스는 명확한 의존성 순서를 따르며, 각 단계가 이전 단계 위에 쌓이는 구조입니다:

```
Config → RuntimeData → Providers → AgentCore → Channels → Orchestration → RuntimeSupport → Dashboard
```

- 각 `create_*_bundle()` 함수가 강타입 객체를 반환
- 9단계 순차적 초기화로 의존성 충돌 방지
- `acquire_runtime_instance_lock()`으로 중복 인스턴스 방지

#### 서비스 지향 설계
- 모든 핵심 컴포넌트가 `ServiceLike` 인터페이스 구현 (`start()/stop()`)
- `ServiceManager`가 서비스 생명주기 관리 및 순서 보장
- 명시적 생성자 주입(Constructor Injection)으로 의존성 투명

#### 이벤트 기반 통신
- `InMemoryMessageBus` / `RedisBus`로 컴포넌트 간 느슨한 결합
- `WorkflowEventService`로 감사 추적(audit trail)
- Progress event를 통한 실시간 상태 전달

### 1.2 타입 안전성 ⭐⭐⭐⭐⭐

**ESLint `@typescript-eslint/no-explicit-any: "error"` 규칙**이 프로덕션 소스 코드(`src/`)에 적용되어 있으며, **소스 코드에서 `as any` 사용 0건**입니다. (테스트 코드에서는 목(mock) 객체 생성을 위해 `as any` 사용이 허용됨)

```typescript
// src/contracts.ts — 리터럴 유니온 타입으로 상태 정의
status: "running" | "stopped" | "failed" | "completed" | "max_turns_reached";

// src/bus/types.ts — 명확한 타입 구분
export type Message = {
  id: string;
  provider: MessageProvider;
  channel: string;
  sender_id: string;
  // ...
  metadata?: Record<string, unknown>;  // 확장성을 위한 의도적 unknown
};
```

- TypeScript strict 모드 전면 적용 (`tsconfig.json`)
- `Record<string, unknown>` 사용으로 확장성 확보 (any 대신)
- Zod 스키마로 런타임 타입 검증 병행

### 1.3 설정 관리 ⭐⭐⭐⭐⭐

`src/config/schema.ts`에서 Zod 기반 스키마 검증:

```typescript
export const AppConfigSchema = z.object({
  agentLoopMaxTurns: z.number().min(1),
  taskLoopMaxTurns: z.number().min(1),
  dataDir: z.string().transform((p) => isAbsolute(p) ? p : resolve(p)),
  channel: ChannelSchema,
  orchestration: OrchestrationSchema,
  dashboard: DashboardSchema,
  // ...
});
```

- **3단계 우선순위**: 기본값 → ConfigStore 오버라이드 → SecretVault 민감정보
- `.default()`, `.transform()`, `.min()/.max()` 활용한 강력한 검증
- 경로 자동 정규화 (상대→절대 변환)

### 1.4 테스트 인프라 ⭐⭐⭐⭐⭐

| 지표 | 수치 |
|------|------|
| 테스트 파일 수 | 933개 |
| 테스트 코드 LOC | 193,427줄 |
| 소스 코드 LOC | 92,341줄 |
| 테스트/소스 비율 | **2.1:1** |
| 테스트 어설션 | ~7,730개 |

```typescript
// tests/ops/ops-runtime-service.test.ts — 일관된 패턴
function make_deps(overrides: Partial<OpsRuntimeDeps> = {}): OpsRuntimeDeps {
  return {
    bus: { get_sizes: vi.fn().mockReturnValue({ inbound: 0, outbound: 0 }) } as any,
    cron: { every: vi.fn() } as any,
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });
```

- 서브시스템별 체계적 테스트 조직
- `make_deps()` 등 헬퍼 팩토리 패턴으로 일관된 목 생성
- 한국어 테스트 설명으로 도메인 친화적
- 경계 값, 에러 경로 테스트 포함

### 1.5 보안 설계 ⭐⭐⭐⭐

#### 암호화
- **AES-256-GCM** (NIST 승인 AEAD 알고리즘) 사용
- 96비트 IV (GCM 표준), 128비트 인증 태그
- AAD(Additional Authenticated Data) 지원으로 컨텍스트 바인딩

```typescript
// src/security/secret-vault.ts
const iv = randomBytes(12);    // 96-bit 논스
const cipher = createCipheriv("aes-256-gcm", key, iv);
if (aad) cipher.setAAD(Buffer.from(String(aad), "utf-8"));
```

#### 민감 데이터 탐지 (40+ 패턴)
- OpenAI, Anthropic, GitHub, Slack 토큰
- JWT, AWS 키, Stripe 키, MongoDB/Postgres URI
- 신용카드, 계좌번호 (한국어 포함)
- PEM 프라이빗 키 블록

#### 프롬프트 인젝션 방지
```typescript
// src/security/content-sanitizer.ts
export const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore\s+(all\s+)?previous\s+instructions\b/i,
  /\b무시\s*(하고|해)\b/i,        // 한국어
  /\b前の指示を無視\b/i,           // 일본어
  // ... 다국어 패턴
];
```
- 유니코드 정규화로 제로폭 문자 공격 방지
- 줄 단위 필터링으로 인젝션 라인 격리

### 1.6 복원력 패턴 ⭐⭐⭐⭐

#### 서킷 브레이커 (`src/providers/circuit-breaker.ts`)
```
closed → [N failures] → open → [timeout] → half_open → [success] → closed
```

#### 재시도 로직 (`src/providers/service.ts`)
```typescript
for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
  // ... 지수 백오프: RETRY_BASE_MS * 2 ** (attempt - 1)
  // + abort_signal 지원
  // + 일시적 vs 영구 에러 구분
}
```

#### 데드 레터 큐 (`src/channels/dlq-store.ts`)
- 실패한 메시지를 DLQ에 보관하여 수동 복구 가능
- 비재시도 에러 목록으로 불필요한 재시도 방지

### 1.7 리소스 관리 ⭐⭐⭐⭐⭐

```typescript
// src/utils/sqlite-helper.ts — 171회 사용되는 안전한 패턴
export function with_sqlite<T>(db_path: string, run: (db: DatabaseSync) => T): T | null {
  let db: DatabaseSync | null = null;
  try {
    db = new Database(db_path);
    return run(db);
  } finally {
    try { db?.close(); } catch { /* no-op */ }  // 보장된 정리
  }
}
```

- MessageBus의 `close()`에서 모든 대기 waiter 해제 및 큐 정리
- MCP 클라이언트 순차 종료 (하나의 실패가 다른 것에 영향 없음)
- 그레이스풀 셧다운: SIGINT/SIGTERM 처리, 10초 타임아웃 후 강제 종료

### 1.8 국제화 ⭐⭐⭐⭐

- **3,776개 번역 키** (영어/한국어)
- **99.97% 번역 완료율** (1개 누락: `node.action.compress`)
- 변수 치환 지원, 캐시 기반 로딩

### 1.9 DevOps & 배포 ⭐⭐⭐⭐

- 멀티스테이지 Docker 빌드 (deps → build → production/full/dev)
- 크로스 플랫폼 스크립트 (run.sh, run.cmd, run.ps1)
- 프로필 지원 (dev/test/staging/prod)
- CI 최적화 (`maxWorkers=2`, 메모리 제한 고려)

### 1.10 코드 품질 관리

- `TODO/FIXME/HACK` 주석 **0건** — 규율 있는 개발
- `no-console` 규칙으로 `console.log` 1건 (logger.ts, 의도적)
- 포괄적인 `REFACTOR.md`로 기술 부채 추적 (34건 해결, 단계별 로드맵)

---

## 2. 문제점 (Issues)

### 2.1 🔴 대시보드 인증 부재 (CRITICAL)

`src/dashboard/service.ts`에 **인증/인가 메커니즘이 없습니다**.

```typescript
// 대시보드가 활성화되면 누구나 접근 가능
const http_server = createServer(async (req, res) => {
  // 인증 미들웨어 없음
  // API 키 검증 없음
  // CORS 제한 없음
});
```

**위험**: 공용 네트워크에서 실행 시 태스크 생성, 설정 변경, 비밀 정보 접근이 무방비 상태.
**현재 가정**: 리버스 프록시(Nginx 등) 뒤에서 실행 — 문서화 필요.

### 2.2 🔴 마스터 키 평문 저장 (HIGH)

```typescript
// src/security/secret-vault.ts:229-234
db.prepare(`INSERT OR REPLACE INTO master_key(id, key_b64url, created_at)
  VALUES (1, ?, ?)`).run(b64url_encode(key), now_iso());
```

- 마스터 키가 `keyring.db` 파일에 **평문**으로 저장됨
- 키 로테이션 메커니즘 없음
- HSM(Hardware Security Module) 통합 없음

### 2.3 🟡 채널 매니저의 에러 무시 패턴 (MEDIUM)

`src/channels/manager.ts`에서 여러 `.catch(() => {})` 패턴이 에러를 무시합니다:

```typescript
void this.recorder.record_assistant(...).catch(() => {});  // 조용한 실패
.catch((e) => this.logger.debug("stream_update_failed", ...))  // debug 레벨로 축소
.catch(() => {})  // 완전 무시
```

**위험**: 세션 레코딩 실패, 스트림 업데이트 실패 등 중요한 운영 정보 유실.

### 2.4 🟡 커스텀 에러 클래스 부재 (MEDIUM)

전체 코드베이스에서 커스텀 에러 클래스를 사용하지 않습니다:

```typescript
// 문자열 기반 에러 — instanceof로 구분 불가
throw new Error(`provider_not_found:${provider_id}`);
throw new Error(`circuit_open:${id}`);
throw new Error(`transient_error`);
```

**영향**: 에러 타입별 처리가 불가능하고, 에러 메시지 파싱에 의존해야 함.

### 2.5 🟡 서킷 브레이커 동시성 안전성 (MEDIUM)

`src/providers/circuit-breaker.ts`에 잠금 메커니즘이 없습니다:

```typescript
// 동시 호출 시 경합 조건 발생 가능
try_acquire(): boolean {
  if (this.state === "open") { /* ... */ }
  // 두 호출이 동시에 half_open을 시도할 수 있음
}
```

Node.js 이벤트 루프의 단일 스레드 특성상 대부분 안전하지만, `async` 함수 사이에서 상태 변경이 발생할 수 있음.

### 2.6 🟡 생성자에서 의존성 검증 누락 (MEDIUM)

```typescript
// src/orchestration/service.ts
constructor(deps: OrchestrationServiceDeps) {
  this.providers = deps.providers;
  this.vault = deps.secret_vault;
  this.agent_backends = deps.agent_backends || null;
  // 필수 의존성 null 검사 없음
}
```

TypeScript가 컴파일 타임 검사를 하지만, 런타임에 잘못된 값이 전달될 수 있음.

### 2.7 🟡 시크릿 볼트 키 생성 경합 (MEDIUM)

```typescript
// src/security/secret-vault.ts
async get_or_create_key(): Promise<Buffer> {
  if (this.key_cache) return this.key_cache;
  if (this.key_lock) return this.key_lock;
  this.key_lock = this._load_or_generate_key();
  try { return await this.key_lock; }
  finally { this.key_lock = null; }
}
```

`key_lock` 할당과 `await` 사이의 간극에서 다중 동시 호출이 키 생성을 중복 트리거할 수 있음. 캐시가 설정되기 전에 `key_lock`이 null로 리셋되므로, 이론적으로 2회 이상 키 생성이 가능.

### 2.8 🟢 환경 변수 시크릿 패턴 캐시 (LOW)

```typescript
// src/security/sensitive.ts
let _env_secret_patterns: Array<{ re: RegExp }> | null = null;
function get_env_secret_patterns(): Array<{ re: RegExp }> {
  if (_env_secret_patterns) return _env_secret_patterns;
  // 프로세스 시작 시 한 번만 로드
  // 런타임 중 추가된 환경 변수는 반영되지 않음
}
```

### 2.9 🟢 프롬프트 인젝션 탐지 한계 (LOW)

- 블랙리스트 기반 — 새로운 인젝션 기법 우회 가능
- ROT13, Base64 인코딩된 공격은 통과
- "ignore warnings during import" 같은 정당한 문장도 차단될 수 있음 (오탐)

---

## 3. 개선점 (Improvements)

### 3.1 대시보드 보안 강화

```
권장사항:
1. API 키 또는 토큰 기반 인증 추가
2. CORS 설정 강화
3. Rate limiting 적용
4. RBAC (역할 기반 접근 제어): admin/operator/viewer
5. 배포 가이드에 리버스 프록시 필수 명시
```

### 3.2 에러 처리 체계화

#### 커스텀 에러 클래스 도입
```typescript
// 권장 패턴
export class ProviderNotFoundError extends Error {
  readonly provider_id: string;
  constructor(provider_id: string) {
    super(`provider_not_found:${provider_id}`);
    this.provider_id = provider_id;
  }
}

export class CircuitOpenError extends Error {
  readonly provider_id: string;
  constructor(id: string) { super(`circuit_open:${id}`); this.provider_id = id; }
}
```

#### 에러 코드 상수 정의
```typescript
// src/errors/codes.ts
export const ErrorCodes = {
  PROVIDER_NOT_FOUND: "provider_not_found",
  CIRCUIT_OPEN: "circuit_open",
  TRANSIENT_ERROR: "transient_error",
  // ...
} as const;
```

### 3.3 채널 매니저 에러 로깅

```typescript
// 개선 전
void this.recorder.record_assistant(...).catch(() => {});

// 개선 후
void this.recorder.record_assistant(...).catch((e) =>
  this.logger.warn("session_recording_failed", { error: error_message(e) })
);
```

### 3.4 매직 넘버 중앙화

현재 타임아웃, 재시도 횟수, 큐 크기 등이 각 파일에 산재:

```typescript
// 산재된 상수들
const COMPACT_THRESHOLD = 512;          // bus/service.ts
const MAX_TRANSIENT_RETRIES = 2;        // providers/service.ts
const BOT_IDS_TTL_MS = 60_000;          // channels/manager.ts
const MASK_CACHE_TTL_MS = 60_000;       // security/secret-vault.ts
```

**권장**: `src/constants.ts`에 도메인별 상수 그룹화:
```typescript
export const BUS = {
  COMPACT_THRESHOLD: 512,
  DEFAULT_MAX_QUEUE_SIZE: 10_000,
  DEFAULT_CONSUME_TIMEOUT_MS: 30_000,
} as const;

export const RETRY = {
  MAX_TRANSIENT_RETRIES: 2,
  RETRY_BASE_MS: 1_000,
} as const;
```

### 3.5 i18n 하드코딩 문자열 통합

`src/channels/manager.ts`에 하드코딩된 UI 문자열:

```typescript
// 현재: 하드코딩
const FALLBACK_MESSAGES = {
  identity: "무엇을 도와드릴까요?",
  safe_fallback: "다시 한 번 말씀해주시면 바로 이어가겠습니다.",
  error: "처리 중 문제가 발생했습니다.",
};

const STATUS_LABELS = {
  Read: "파일 읽는 중",
  Glob: "파일 검색 중",
  // ...
};
```

이미 3,776개 키를 가진 i18n 시스템(`src/i18n/`)이 있으므로, 이 문자열들도 i18n 시스템으로 이동해야 합니다.

### 3.6 통합 테스트 보강

현재 테스트의 대부분이 유닛 테스트(목 기반)입니다:
- 스냅샷 테스트 없음
- 성능 벤치마크 없음
- E2E 테스트 제한적 (`tests/e2e/` 디렉토리 존재하나 최소)

**권장**:
- 주요 워크플로우 통합 테스트 추가
- 핵심 경로 성능 회귀 테스트
- 부트스트랩 순서 통합 검증

### 3.7 SSE 브로드캐스터 데이터 필터링

대시보드 SSE 브로드캐스터가 태스크 이벤트와 프로그레스를 전송하는데, `task.memory`에 민감한 데이터가 포함될 수 있습니다. 브로드캐스트 전 필드별 필터링이 필요합니다.

### 3.8 키 로테이션 메커니즘

`secret-vault.ts`에 키 로테이션 정책을 추가:
- 주기적 키 갱신 (예: 90일)
- 이전 키로 암호화된 데이터 자동 재암호화
- 키 버전 관리 (현재 `sv1.` 접두어는 버전 1 표시)

---

## 4. 리팩토링 기회 (Refactoring Opportunities)

### 4.1 인라인 SQLite 패턴 → `with_sqlite()` 통합

`with_sqlite()` 헬퍼가 171회 사용되고 있지만, 약 8곳에서 인라인 패턴이 남아 있습니다:

```typescript
// src/services/reference-store.ts — 인라인 패턴
const db = new Database(this.db_path);
try {
  const rows = db.prepare("SELECT ...").all();
  return rows;
} finally {
  db.close();
}

// ↓ with_sqlite()로 통합 가능
return with_sqlite(this.db_path, (db) =>
  db.prepare("SELECT ...").all()
) ?? [];
```

**대상 파일**: `reference-store.ts`, `skill-ref-store.ts` 등 ~8곳

### 4.2 메시지 버스 퍼블리시 패턴 통합

`src/bus/service.ts`에서 `publish_inbound`, `publish_outbound`, `publish_progress`가 거의 동일한 패턴:

```typescript
// 현재: 3개의 거의 동일한 메서드
async publish_inbound(message: InboundMessage): Promise<void> {
  if (this._closed) return;
  this._publish(message, this.inbound_queue, this.inbound_waiters);
  for (const fn of this.observers) try { fn("inbound", message); } catch { /* noop */ }
}

async publish_outbound(message: OutboundMessage): Promise<void> {
  if (this._closed) return;
  this._publish(message, this.outbound_queue, this.outbound_waiters);
  for (const fn of this.observers) try { fn("outbound", message); } catch { /* noop */ }
}
```

**리팩토링 기회**: 제네릭 퍼블리시 메서드 추출
```typescript
private publish_to<T>(
  direction: "inbound" | "outbound" | "progress",
  message: T,
  queue: BoundedQueue<T>,
  waiters: Array<Waiter<T>>
): void {
  if (this._closed) return;
  this._publish(message, queue, waiters);
  for (const fn of this.observers) try { fn(direction, message); } catch { /* noop */ }
}
```

### 4.3 프로바이더 레지스트리 플러그인화

현재 `ProviderRegistry` 생성자에서 프로바이더가 하드코딩됩니다:

```typescript
// src/providers/service.ts
constructor(options) {
  this.providers.set("chatgpt", new CliHeadlessProvider({...}));
  this.providers.set("openrouter", new OpenRouterProvider({...}));
  // 동적 등록 불가
}
```

**리팩토링 기회**: 플러그인 등록 패턴 도입
```typescript
// 플러그인 인터페이스
interface ProviderPlugin {
  id: string;
  create(config: ProviderConfig): LlmProvider;
}

// 등록 기반
registry.register_plugin(new OpenRouterPlugin());
registry.register_plugin(new OllamaPlugin());
```

### 4.4 부트스트랩 의존성 간소화

`create_agent_core()`에 **6개 이상**, `create_orchestration_bundle()`에 **8개 이상**의 의존성이 전달됩니다:

```typescript
const { agent } = await create_agent_core({
  workspace, data_dir, sessions_dir, app_root, app_config,
  providers, bus, events, agent_backend_registry, provider_caps,
  embed_service, embed_worker_config, image_embed_service,
  oauth_store, oauth_flow, broadcaster, logger,
});
```

**리팩토링 기회**: 컨텍스트 객체 도입
```typescript
interface RuntimeContext {
  workspace: string;
  config: AppConfig;
  logger: Logger;
  services: {
    bus: MessageBusRuntime;
    events: WorkflowEventService;
    providers: ProviderRegistry;
    // ...
  };
}
```

### 4.5 OAuth 서비스 `ServiceLike` 구현

REFACTOR.md(SOK-49)에서 이미 식별된 항목:
- `OAuthFlowService`가 `ServiceLike` 인터페이스를 구현하지 않음
- `start()/stop()` 생명주기 관리가 `ServiceManager`에 통합되지 않음
- 백그라운드 클린업/리프레시 타이머가 별도 관리

### 4.6 에러 메시지 포맷 표준화

현재 에러 메시지가 세 가지 패턴으로 혼재:

```typescript
// 패턴 1: 콜론 구분
throw new Error(`provider_not_found:${id}`);

// 패턴 2: error_message() 헬퍼
logger.error(`failed: ${error_message(e)}`);

// 패턴 3: 직접 문자열
throw new Error("transient_error");
```

**리팩토링 기회**: `Result<T, E>` 패턴 또는 통일된 에러 포맷
```typescript
type AppError = {
  code: string;
  message: string;
  context?: Record<string, unknown>;
};
```

### 4.7 REFACTOR.md 식별 항목 (Phase 1 우선)

REFACTOR.md에서 이미 식별된 긴급 항목:

| ID | 설명 | 심각도 |
|-----|------|--------|
| C1 | DB 연결 누수 가능성 | HIGH |
| C2 | Promise 경합 조건 | HIGH |
| C3 | Worker 에러 처리 | HIGH |
| C4 | SQLite 유효성 검증 | HIGH |
| S3 | Slack 입력 검증 | MEDIUM |
| S5 | 캐싱 전략 개선 | MEDIUM |

---

## 5. 종합 평가

### 점수표

| 영역 | 점수 | 평가 |
|------|------|------|
| **아키텍처** | ⭐⭐⭐⭐⭐ | 계층적 부트스트랩, 서비스 지향, 이벤트 기반 |
| **타입 안전성** | ⭐⭐⭐⭐⭐ | strict 모드, `as any` 0건, Zod 검증 |
| **테스트** | ⭐⭐⭐⭐⭐ | 2.1:1 테스트 비율, 체계적 조직, 헬퍼 팩토리 |
| **설정 관리** | ⭐⭐⭐⭐⭐ | Zod 스키마, 3단계 우선순위, 경로 정규화 |
| **리소스 관리** | ⭐⭐⭐⭐⭐ | with_sqlite 패턴, 그레이스풀 셧다운 |
| **보안 설계** | ⭐⭐⭐⭐ | AES-256-GCM, 프롬프트 인젝션 방지, 40+ 패턴 |
| **에러 처리** | ⭐⭐⭐ | 프로바이더 우수, 채널 불일관 |
| **의존성 관리** | ⭐⭐⭐ | 명시적 DI, 부트스트랩 복잡도 높음 |
| **코드 중복** | ⭐⭐⭐ | 주요 패턴 중앙화, 일부 중복 존재 |
| **국제화** | ⭐⭐⭐⭐ | 99.97% 완료, 일부 하드코딩 문자열 |

### 최종 등급: **A- (우수)**

코드베이스는 **성숙하고 잘 설계된 시스템**입니다. 특히 타입 안전성, 테스트 커버리지, 설정 관리, 리소스 관리에서 높은 수준을 보여주며, 보안과 복원력 패턴도 잘 구현되어 있습니다.

주요 개선 영역은:
1. **대시보드 인증** (보안 필수)
2. **에러 처리 일관성** (채널 매니저 중심)
3. **마스터 키 보호** (암호화 또는 외부 키 관리)
4. **부트스트랩 복잡도 감소** (컨텍스트 객체 도입)

이미 `REFACTOR.md`를 통해 기술 부채를 체계적으로 추적하고 있으며, 10회 이상의 반복 개선이 진행된 점은 매우 긍정적입니다.
