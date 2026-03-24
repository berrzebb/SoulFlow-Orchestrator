# 코드 리뷰 리포트 — SoulFlow Orchestrator

> **리뷰 일시:** 2026-03-24  
> **범위:** 전체 코드베이스 (`src/` 784 파일 · 58,815 LoC, `tests/` 857 파일 · 210,881 LoC, `web/` 326 파일)  
> **참고:** REFACTOR.md / CHECKLIST.md 는 이미 완료된 작업으로, 본 리포트에서 별도 수정 대상이 아닙니다.

---

## 목차

1. [잘된 점 (Strengths)](#1-잘된-점-strengths)
2. [문제점 (Problems)](#2-문제점-problems)
3. [개선점 (Improvements)](#3-개선점-improvements)
4. [리팩토링 기회 (Refactoring Opportunities)](#4-리팩토링-기회-refactoring-opportunities)
5. [종합 평가](#5-종합-평가)

---

## 1. 잘된 점 (Strengths)

### 1.1 아키텍처 설계

#### ✅ 명확한 레이어 경계
`src/bootstrap/layer-boundaries.ts`에서 7개 레이어(ingress → gateway → execution → worker → delivery → state → observability)를 상수로 정의하고, 의존 방향을 단방향으로 강제합니다. 모놀리식 구조임에도 마이크로서비스급의 책임 분리를 유지합니다.

#### ✅ 팩토리 번들 기반 의존성 주입
17개 부트스트랩 모듈(`src/bootstrap/`)이 팩토리 함수로 의존성을 조립합니다. 데코레이터나 프레임워크 없이 순수 함수로 구성하여 테스트가 용이하고 의존 그래프가 `main.ts`에서 명시적으로 드러납니다.

```typescript
// src/bootstrap/config.ts:16-27 — 명확한 의존성 생성
export async function create_config_bundle(workspace: string): Promise<ConfigBundle> {
  const shared_vault = get_shared_secret_vault(workspace);
  const config_store = new ConfigStore(join(global_data_dir, "config.db"), shared_vault);
  return { shared_vault, config_store, app_config };
}
```

#### ✅ 인터페이스 기반 다형성 (Port/Adapter)
- **9개 에이전트 백엔드**: `AgentBackend` 인터페이스 하나로 claude_sdk, codex_appserver, openai_compatible, ollama 등 이질적인 런타임을 통합
- **4개 채널**: `BaseChannel` 추상 클래스로 Slack/Discord/Telegram/Web 통합
- **2개 메시지 버스**: `MessageBusRuntime` 인터페이스로 InMemory ↔ Redis Streams 전환 가능
- **프로바이더 팩토리 레지스트리**: `src/agent/provider-factory.ts`에서 `Map<string, AgentProviderFactoryFn>` 패턴으로 9개 백엔드를 런타임 등록

#### ✅ 우수한 관찰성 (Observability)
`src/observability/` 9개 모듈이 트레이스(span_id, trace_id, parent_span_id), 메트릭(Counter/Gauge/Histogram), 상관관계(correlation_id)를 체계적으로 수집합니다. SpanExportAdapter는 100건 버퍼링 후 플러시, MetricsExportAdapter는 60초 주기 내보내기를 지원하며, OpenTelemetry OTLP/gRPC 내보내기가 가능합니다.

---

### 1.2 보안

#### ✅ Secret Vault (AES-256-GCM)
`src/security/secret-vault.ts` — 539줄의 견고한 암호화 모듈:
- AES-256-GCM + IV + AAD(Additional Authenticated Data) 바인딩
- 토큰 형식: `sv1.{iv}.{tag}.{ciphertext}` (base64url)
- Master key는 별도 `keyring.db`에 격리 저장 (lines 104-116)
- 복호화 전 Ciphertext 형상 검증 (lines 86-100)

#### ✅ 인증 체계
`src/auth/` — scrypt 비밀번호 해싱(N=16384, r=8, p=1) + `timingSafeEqual()` 비교, HS256 JWT + 타이밍-세이프 서명 검증, HttpOnly/Secure/SameSite=Strict 쿠키, 슬라이딩 윈도우 레이트 리미터(5회/15분).

#### ✅ 다층 입출력 보안
- **인바운드**: 웹훅 서명 검증, 민감 정보 자동 Sealing(Luhn 카드 번호 검증 포함), SSRF 사설 IP 차단(10.x, 192.168.x, 172.16-31.x, ::1, fe80::, fc00::, .local)
- **실행**: 파일시스템 심링크 해석 후 경계 검사, Shell 명령어 거부 패턴, 도구별 시크릿 실행 시점 복호화
- **아웃바운드**: Egress 토큰 가드, 3단계 출력 정제(프로토콜 제거 → 노이즈 필터 → 시크릿 마스킹)

#### ✅ SQL 인젝션 방지
전체 코드베이스에서 **파라미터화된 Prepared Statement** 사용. 문자열 연결로 SQL을 구성하는 경우가 없습니다 (EXPLAIN QUERY PLAN 1건 제외 — §2.1 참조).

#### ✅ 프롬프트 인젝션 방어
`src/security/content-sanitizer.ts` — 다국어(영/한/중/일) 프롬프트 인젝션 패턴 14종 이상 탐지, NFKC 유니코드 정규화, ReDoS 방지를 위한 512,000자 입력 제한.

---

### 1.3 코드 품질

#### ✅ TypeScript Strict 모드 + ESLint Strict
`tsconfig.json`에 `"strict": true`, ESLint에서 `@typescript-eslint/no-explicit-any: "error"` 적용. 소스 코드에 `as any`가 **0건**이며, `eval()`/`new Function()` 사용도 **0건**입니다.

#### ✅ 컨벤션 일관성
- 함수/변수: `snake_case` 일관 적용 (`run_phase_agents`, `handle_inbound_message`)
- 클래스: `PascalCase` (`ChannelManager`, `MemoryStore`)
- 상수: `UPPER_SNAKE_CASE` (`MAX_TURNS_UNLIMITED`, `BOT_IDS_TTL_MS`)
- `console.log` 금지 (warn/error만 허용), `===` 강제, `prefer-const` 적용

#### ✅ 최소한의 기술 부채 마커
TODO/FIXME/HACK 주석이 소스 코드에 **0건**. 10회 반복의 체계적 리팩토링(REFACTOR.md 34건 완료)이 이루어졌습니다.

#### ✅ Zod 기반 설정 검증
`src/config/schema.ts`에서 Zod 스키마로 모든 설정을 타입-안전하게 검증합니다. 3계층 설정(코드 기본값 → DB → 환경변수) 병합 패턴이 적용되어 있습니다.

---

### 1.4 테스트

#### ✅ 높은 테스트 비율
소스 코드 58,815줄 대비 테스트 210,881줄 — **3.6배** 테스트 코드. 857개 테스트 파일이 모든 주요 모듈을 커버합니다.

#### ✅ 커버리지 임계값 강제
`vitest.config.ts` — Lines 85%, Statements 85%, Branches 75%, Functions 85% 임계값이 설정되어 있으며, CI에서 강제됩니다.

#### ✅ CI 파이프라인 최적화
8개 병렬 샤드 매트릭스, PR 변경 분량만 증분 테스트(`vitest --changed`), 환경별 테스트 제외(`SKIP_VEC_TESTS`, `SKIP_RECHUNK_TESTS`, `SKIP_PTY_TESTS`), 커버리지 배지 자동 배포.

#### ✅ 테스트 격리
`make_deps()` 팩토리 패턴으로 의존성 모킹, `mkdtemp()` + `afterEach(rm)` 패턴으로 파일시스템 격리, `vi.clearAllMocks()` 상태 초기화.

#### ✅ E2E 테스트 인프라
`tests/e2e/harness.ts` — 실제 서비스를 조합하고 `TestChannel`로 채널 경계만 모킹하는 현실적 E2E 프레임워크 구축.

---

### 1.5 운영 성숙도

#### ✅ 프로바이더 회복력
- **Circuit Breaker**: 3상태(closed → open → half_open) 전환, 5회 실패 시 open, 30초 후 반열림 프로브
- **Health Scorer**: 50건 슬라이딩 윈도우, 성공률(0.7) + 지연시간(0.3) 가중치 점수
- **Fallback Chain**: 우선순위 기반 자동 전환 (claude_sdk → claude_cli, codex_appserver → codex_cli)
- **Transient Retry**: rate_limit/429/5xx/ECONNRESET 등 일시 오류 패턴 감지 후 2회 재시도

#### ✅ 다국어 지원
2개 언어(en/ko), 로케일당 4,491개 키, 백엔드-프론트엔드 공유 프로토콜(`create_t()` + 변수 치환), React Context 기반 실시간 전환.

#### ✅ 컨테이너 배포
5단계 멀티스테이지 Dockerfile, Docker Compose(orchestrator + chunker + redis + docker-proxy 4서비스), tini PID 1 관리, 리소스 제한(1GB/2CPU), 헬스체크 설정 완비.

#### ✅ 문서화
98개 설계 문서(영/한 49쌍), 10개 SVG 아키텍처 다이어그램, 코어 컨셉/가이드/시작하기 문서 체계 완비.

---

## 2. 문제점 (Problems)

### 2.1 보안 문제

#### 🔴 P1: EXPLAIN QUERY PLAN SQL 인젝션
**위치:** `src/agent/tools/database.ts:91-96`

```typescript
case "explain": {
  const sql = String(params.sql || "").trim();
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
  // ↑ 사용자 SQL이 Prepared Statement 없이 직접 연결됨
}
```

SQLite의 EXPLAIN은 파라미터화를 지원하지 않아 사용자 입력이 직접 연결됩니다. 악의적 SQL(`; DROP TABLE ...`)이 실행될 수 있습니다. `SELECT/PRAGMA/EXPLAIN/WITH` 화이트리스트 검사가 있지만, 세미콜론으로 구분된 복합 문장은 방어하지 못합니다.

#### 🟠 P2: JWT 시크릿 DB 저장
**위치:** `src/auth/auth-service.ts:57-64`

```typescript
let secret = this.store.get_setting("jwt_secret");
if (!secret) {
  secret = randomBytes(48).toString("hex");
  this.store.set_setting("jwt_secret", secret);
}
```

JWT 서명 키가 admin.db SQLite 파일에 평문으로 저장됩니다. DB 파일이 유출되면 모든 JWT를 위조할 수 있습니다. 자가 호스팅 환경에서는 허용 가능하나, 멀티테넌트 환경에서는 환경변수 우선 로딩이 필요합니다.

#### 🟠 P3: CSRF 토큰 부재
**위치:** `src/dashboard/service.ts:75-104`

CORS + SameSite=Strict 쿠키로 일부 방어되지만, 명시적 CSRF 토큰 검증이 없습니다. `allowed_origins` 설정이 와일드카드(`*`)로 잘못 설정되면 CSRF 공격에 노출됩니다.

#### 🟡 P4: 인메모리 전용 레이트 리미터
**위치:** `src/auth/login-rate-limiter.ts`

레이트 리미터가 메모리 기반이어서 서버 재시작 시 초기화됩니다. 분산 환경에서는 Redis 기반 리미터가 필요합니다. 또한 Setup 엔드포인트와 로그인이 동일한 리미터(5회/15분)를 공유하는데, scrypt DoS 공격에 대해 더 엄격한 제한이 필요합니다.

#### 🟡 P5: 레거시 계정 토큰 만료 미적용
**위치:** `src/auth/auth-service.ts:189-196`

`password_changed_at` 컬럼 추가 이전에 생성된 레거시 계정은 `if (!changed_at_iso) return true;`로 처리되어, 비밀번호 변경 이전 발급된 토큰이 무기한 유효합니다.

---

### 2.2 에러 핸들링 문제

#### 🔴 P6: 옵저버 에러 무시 (버스 계층)
**위치:** `src/bus/service.ts:123,130` / `src/bus/redis-bus.ts:143`

```typescript
for (const fn of this.observers) try { fn("inbound", message); } catch { /* noop */ }
```

메시지 버스 옵저버의 예외가 완전히 삼켜집니다. 옵저버가 상태를 변경하는 경우(예: 오케스트레이션 트리거), 실패 시 상태 불일치가 발생하지만 감지할 수 없습니다.

#### 🔴 P7: 채널 에러 핸들러 내부의 에러 무시
**위치:** `src/channels/channel-renderer.ts:192-197`

```typescript
// 에러 핸들러(flush_on_error) 내부에서 에러를 삼킴
await this._chain.catch(() => {});
await this._finalize_native_stream().catch(() => {});
await this._send_block_summary().catch(() => {});
```

에러 핸들러 자체의 실패가 무시되어, 연쇄 장애 시 디버깅이 불가능합니다.

#### 🔴 P8: ACK 실패 무시
**위치:** `src/channels/manager.ts:226`

```typescript
Promise.all(leases.map((l) => l.ack())).then(() => undefined).catch(() => undefined);
```

메시지 ACK 실패가 무시되면 메시지가 무한 재처리될 수 있습니다.

#### 🟠 P9: 이벤트 로깅 사일런트 실패
**위치:** `src/orchestration/service.ts:342`

```typescript
this.events.append(patched).catch(() => { /* 이벤트 로깅 실패가 실행을 차단하면 안 됨 */ });
```

감사 추적(audit trail) 손실이 감지되지 않습니다. 의도적 설계이나, 최소한 메트릭 카운터로 실패 건수를 추적해야 합니다.

#### 🟠 P10: 비동기 훅 에러 무시
**위치:** `src/hooks/runner.ts:181`

```typescript
this._run_single(def, input).catch(() => {}); // 비동기 훅 실패 감지 불가
```

동기 훅은 결과를 확인하지만 비동기 훅은 완전히 무시됩니다. 어떤 훅이 왜 실패했는지 알 수 없습니다.

#### 🟡 P11: 대규모 catch(() => {}) 패턴
코드베이스 전체에 **525개 빈 catch 블록**이 245개 파일에 분포합니다. 대표적 위치:
- `src/services/kanban-store.ts` — 7건의 `log_activity().catch(() => {})` (감사 로그 손실)
- `src/agent/subagents.ts:628,648` — 세션 해제/훅 실행 실패 무시
- `src/dashboard/service.ts:660` — 세션 메시지 저장 실패 무시
- `src/utils/resilient-loop.ts:55` — 백그라운드 루프 자체의 치명적 오류 무시

---

### 2.3 타입 안전성 문제

#### 🟠 P12: `Record<string, unknown>` 과다 사용
코드베이스 전체에 **1,451건**의 `Record<string, unknown>` 사용. 프로바이더 설정, API 응답, 도구 파라미터 등에서 타입 정보가 손실됩니다.

```typescript
// src/contracts/api-responses.ts:50
export type ApiScopedProvider = {
  config: Record<string, unknown>; // 프로바이더별 설정이 타입 정보를 잃음
};
```

#### 🟡 P13: 대시보드 워크플로우 `any` 타입
**위치:** `src/dashboard/ops/workflow.ts:127-130`

```typescript
timestamp?: any;
data?: any;
body?: any;
```

ESLint `no-explicit-any` 규칙이 적용된 코드베이스에서 예외적으로 `any`가 사용됩니다.

#### 🟡 P14: ESLint 오류 7건 미해결
- `src/bootstrap/orchestration.ts:39` — 미사용 `ProviderPriority`
- `src/dashboard/routes/health.ts:1` — 미사용 `IncomingMessage`
- `src/dashboard/routes/webhook.ts:217` — 미사용 expression
- `src/orchestration/execution/run-agent-loop.ts:3`, `run-once.ts:4` — 미사용 `ToolExecutionContext`
- `src/services/reference-store.ts:256` — 미사용 `opts`

---

### 2.4 테스트 문제

#### 🟠 P15: 테스트 피라미드 역전
단위 테스트 850건 : 통합 테스트 15건 : E2E 13건 — **97:2:1 비율**. 이상적 비율(70:20:10)에 비해 통합/E2E 테스트가 현저히 부족합니다. 모듈 간 연동 문제가 늦게 발견될 수 있습니다.

#### 🟠 P16: i18n 테스트 부재
4,491개 키 × 2개 언어 = 8,982개 번역이 있지만, i18n 테스트는 **2개 파일 137줄**에 불과합니다. 로케일별 번역 검증, 누락 키 감지, 변수 치환 테스트가 없습니다.

#### 🟡 P17: 약한 어설션 패턴
375건의 `.toBe(true)` / `.toBe(false)` 사용. `.toContain()`, `.toMatchObject()` 등 구체적 어설션으로 대체하면 실패 시 진단이 용이합니다.

```typescript
// ❌ 약한 어설션 — 실패 시 "expected true, got false" 만 표시
expect(text.includes("step one")).toBe(true);
// ✅ 강한 어설션 — 실패 시 실제 text 값을 보여줌
expect(text).toContain("step one");
```

#### 🟡 P18: 테스트 spyOn 정리 누락
`vi.spyOn(globalThis, "fetch")` 후 `afterEach`에서 `vi.restoreAllMocks()`가 없는 테스트 파일이 있어, 테스트 간 상태 누출이 발생할 수 있습니다.

#### 🟡 P19: 멀티테넌트 격리 테스트 부재
`team_id` 기반 데이터 격리가 핵심 요구사항이지만, 교차 테넌트 데이터 누출 시나리오를 검증하는 테스트가 없습니다.

---

## 3. 개선점 (Improvements)

### 3.1 보안 개선

| 번호 | 개선 사항 | 우선순위 | 위치 |
|------|----------|---------|------|
| I-1 | EXPLAIN 쿼리 SQL 검증 — 세미콜론/서브쿼리 차단 | 🔴 높음 | `src/agent/tools/database.ts:91` |
| I-2 | JWT 시크릿 환경변수 우선 로딩 (`process.env.JWT_SECRET` → DB 폴백) | 🟠 중간 | `src/auth/auth-service.ts:57` |
| I-3 | CSRF 토큰 미들웨어 추가 (POST/PATCH/DELETE) | 🟠 중간 | `src/dashboard/service.ts` |
| I-4 | 레이트 리미터 Redis 백엔드 옵션 | 🟡 낮음 | `src/auth/login-rate-limiter.ts` |
| I-5 | 레거시 계정 첫 로그인 시 비밀번호 재설정 강제 | 🟡 낮음 | `src/auth/auth-service.ts:189` |
| I-6 | Recursive CTE DoS 방지 — SQL 복잡도 제한 | 🟡 낮음 | `src/agent/tools/database.ts:54` |

### 3.2 에러 핸들링 개선

| 번호 | 개선 사항 | 우선순위 | 위치 |
|------|----------|---------|------|
| I-7 | 버스 옵저버 오류 시 구조화된 로깅 추가 | 🔴 높음 | `src/bus/service.ts:123,130` |
| I-8 | ACK 실패 시 로깅 + 메트릭 카운터 | 🔴 높음 | `src/channels/manager.ts:226` |
| I-9 | 에러 핸들러 내부 실패 시 최소한 `logger.warn()` | 🟠 중간 | `src/channels/channel-renderer.ts:192` |
| I-10 | 감사 이벤트 append 실패 시 메트릭 증가 | 🟠 중간 | `src/orchestration/service.ts:342` |
| I-11 | `swallow()` 유틸 호출부에 선택적 로거 파라미터 추가 | 🟡 낮음 | `src/utils/common.ts:145` |
| I-12 | `resilient-loop` 치명적 종료 시 재시작 또는 알림 메커니즘 | 🟠 중간 | `src/utils/resilient-loop.ts:55` |

### 3.3 타입 안전성 개선

| 번호 | 개선 사항 | 우선순위 | 위치 |
|------|----------|---------|------|
| I-13 | 프로바이더별 설정 타입 디스크리미네이티드 유니온으로 교체 | 🟠 중간 | `src/contracts/api-responses.ts` |
| I-14 | 워크플로우 이벤트 `any` → 구체 타입 교체 | 🟡 낮음 | `src/dashboard/ops/workflow.ts:127` |
| I-15 | ESLint 미해결 오류 7건 수정 | 🟡 낮음 | §2.3 P14 참조 |

### 3.4 테스트 개선

| 번호 | 개선 사항 | 우선순위 | 위치 |
|------|----------|---------|------|
| I-16 | 통합 테스트 추가 — 모듈 간 연동 시나리오 | 🟠 중간 | `tests/` |
| I-17 | i18n 키 완전성 테스트 — 모든 키가 양쪽 로케일에 존재하는지 검증 | 🟠 중간 | `tests/i18n/` |
| I-18 | 멀티테넌트 격리 테스트 — 교차 team_id 접근 차단 검증 | 🟠 중간 | `tests/` |
| I-19 | `.toBe(true)` → 구체적 어설션 교체 (375건) | 🟡 낮음 | 테스트 전체 |
| I-20 | E2E 테스트 별도 CI 잡 분리 | 🟡 낮음 | `.github/workflows/ci.yml` |

### 3.5 운영 개선

| 번호 | 개선 사항 | 우선순위 | 위치 |
|------|----------|---------|------|
| I-21 | 매직 넘버를 명명 상수로 추출 (70건 이상) | 🟡 낮음 | §4.4 참조 |
| I-22 | 프론트엔드 커버리지 임계값 설정 | 🟡 낮음 | `web/vitest.config.ts` |
| I-23 | 로그 레벨별 에러 분류 가이드 문서화 | 🟡 낮음 | `docs/` |

---

## 4. 리팩토링 기회 (Refactoring Opportunities)

### 4.1 God Object 분해

#### R-1: `ChannelManager` 분해 (1,339줄, 28개 프로퍼티)
**위치:** `src/channels/manager.ts`

현재 ChannelManager가 라우팅, 렌더링, 승인, 세션 관리, 디바운싱, 쿨다운 등 **7가지 이상의 책임**을 가집니다.

**분해 제안:**
```
ChannelManager (파사드, ~200줄)
├── ChannelRouter          — 인바운드 메시지 라우팅
├── MessageRenderer        — 렌더링 프로파일 + 스트리밍
├── ApprovalCoordinator    — HITL 승인 게이트
├── InboundProcessor       — 디바운싱, 쿨다운, dedup
├── SessionManager         — 스레드 소유권, 세션 저장
└── RenderProfileStore     — 렌더링 설정 캐시
```

#### R-2: `PhaseLoopRunner` 분해 (1,395줄, 75개 if문)
**위치:** `src/agent/phase-loop-runner.ts`

페이즈 오케스트레이션, 에이전트 스폰, 노드 실행, 에러 처리, 상태 관리, 서브 워크플로우, 워크스페이스 격리를 모두 담당합니다.

**분해 제안:**
```
PhaseLoopRunner (코디네이터, ~300줄)
├── PhaseExecutor          — 페이즈별 실행 로직
├── AgentSpawner           — 에이전트 인스턴스 생성
├── NodeExecutor           — 141종 노드 핸들러 디스패치
├── PhaseStateManager      — 상태 전이 + 체크포인트
├── SubWorkflowRunner      — 재귀 서브 워크플로우
└── WorktreeIsolator       — Git worktree 격리
```

#### R-3: `MemoryStore` 분해
**위치:** `src/agent/memory.service.ts`

DB 관리, 벡터 스토어, 임베딩 생성, LLM 요약, Worker Thread, 청킹, 텍스트 정제, 검색을 모두 처리합니다.

**분해 제안:**
```
MemoryStore (파사드)
├── MemoryDb               — SQLite CRUD
├── MemoryVectorIndex      — 벡터 검색 + 임베딩
├── MemoryConsolidator     — LLM 기반 요약/통합
├── ChunkingService        — 텍스트 분할
└── TextProcessor          — 정제 + 정규화
```

---

### 4.2 대형 타입 파일 분할

#### R-4: `workflow-node.types.ts` 분할 (2,300줄)
**위치:** `src/agent/workflow-node.types.ts`

30개 이상의 노드 타입이 단일 파일에 정의되어 있습니다.

**분할 제안:**
```
src/agent/workflow-node-types/
├── index.ts               — Re-exports
├── flow-nodes.ts          — Branch, Merge, Switch, Router (15종)
├── data-nodes.ts          — Transform, Filter, Map, Sort (69종)
├── ai-nodes.ts            — LLM, Embed, Classify (10종)
├── integration-nodes.ts   — HTTP, DB, Slack, GitHub (37종)
├── interaction-nodes.ts   — HITL, Approval, Form (4종)
└── advanced-nodes.ts      — Batch, Subflow, Parallel (6종)
```

#### R-5: `kanban-store.ts` 분할 (1,045줄)
**위치:** `src/services/kanban-store.ts`

11개 인터페이스, SQL 스키마, CRUD, 자동화 규칙이 혼재합니다.

**분할 제안:**
```
src/services/kanban/
├── types.ts               — 인터페이스 정의
├── schema.ts              — SQL 스키마 + 마이그레이션
├── store.ts               — CRUD 연산
└── automation.ts          — 자동화 규칙 처리
```

---

### 4.3 중복 코드 제거

#### R-6: 반복 패턴 통합

| 패턴 | 위치 | 건수 | 개선 |
|------|------|------|------|
| `if (!card) return null;` | `kanban-store.ts:535, 570, 926` | 3 | 헬퍼 함수 추출 |
| `if (orche_state) {...}` | `phase-loop-runner.ts:215, 318, 342, 350` | 4 | 상태 관리 메서드 추출 |
| `if (board_id) {...}` | `kanban-store.ts:550, 592, 619` | 3 | 보드 스코핑 미들웨어 |
| `catch(() => {})` on logging | `kanban-store.ts` (7건) | 7 | `safe_log_activity()` 래퍼 |
| 메모리 서비스 테스트 `beforeEach` setup | `memory-service-*.test.ts` (4파일) | 4 | 공유 테스트 헬퍼 추출 |

---

### 4.4 매직 넘버 상수 추출

#### R-7: 하드코딩된 수치를 명명 상수로 추출

| 매직 넘버 | 위치 | 제안 상수명 |
|----------|------|-----------|
| `60_000` (1분 인터벌) | `channels/manager.ts:252, 261` | `CHANNEL_POLL_INTERVAL_MS` |
| `4000` (메시지 길이) | `channel-renderer.ts:241` | `MAX_MESSAGE_CHARS` |
| `3800` (텔레그램 제한) | `channel-renderer.ts:241` | `TELEGRAM_MAX_CHARS` |
| `3500` (텔레그램 청크) | `telegram.channel.ts:333` | `TELEGRAM_CHUNK_SIZE` |
| `30_000` (멘션 쿨다운) | `manager.ts:1116` | `MENTION_COOLDOWN_MS` |
| `5 * 60_000` (크론) | `ops/service.ts:36` | `CRON_HEALTH_INTERVAL_MS` |

---

### 4.5 깊은 중첩 해소

#### R-8: 4단계 이상 중첩 해소

| 위치 | 현재 깊이 | 개선 방법 |
|------|----------|----------|
| `phase-loop-runner.ts:668-676` | 5+ | 비동기 매핑을 별도 함수로 추출 |
| `channels/manager.ts:229-235` | 5 | 얼리 리턴 + 에러 핸들링 분리 |
| `kanban-store.ts:210-230` | 5 | SQL 템플릿을 별도 상수로 추출 |
| `dashboard/ops/workflow.ts:300+` | 5+ | Guard clause + 헬퍼 함수 추출 |

---

### 4.6 테스트 리팩토링

#### R-9: 통합 테스트 파일 분할
**위치:** `tests/channels/channel-pipeline-integration.test.ts` (3,050줄, 163 테스트)

39개 섹션이 인라인 주석으로 구분된 단일 파일. 병렬 실행이 어렵고 유지보수가 힘듭니다.

**분할 제안:**
```
tests/channels/integration/
├── basic-routing.test.ts
├── command-handling.test.ts
├── approval-flow.test.ts
├── streaming-render.test.ts
└── error-recovery.test.ts
```

#### R-10: 커버리지 번호 파일 통합
`memory-service-consolidate.test.ts`, `memory-service-crud.test.ts`, `memory-service-scoring.test.ts`, `memory-service-search.test.ts` 등 기능별로 분리된 테스트 파일들이 동일한 `beforeEach` setup을 반복합니다. 공유 테스트 팩토리로 중복을 제거할 수 있습니다.

---

## 5. 종합 평가

### 종합 등급: **A- (86/100)**

| 영역 | 점수 | 비고 |
|------|------|------|
| **아키텍처 설계** | 92/100 | 명확한 레이어, 인터페이스 추상화, 팩토리 DI |
| **보안** | 86/100 | AES-256-GCM, scrypt, SSRF 차단 우수. EXPLAIN SQL 인젝션, CSRF 부재 감점 |
| **코드 품질** | 85/100 | Strict TS, 0 `as any`, 일관된 컨벤션. God Object, 매직 넘버 감점 |
| **에러 핸들링** | 72/100 | 525개 빈 catch, 옵저버 에러 무시, ACK 실패 무시 |
| **테스트** | 84/100 | 3.6배 테스트 코드, 85% 임계값. 피라미드 역전, i18n 부재 감점 |
| **운영 성숙도** | 90/100 | Circuit Breaker, Health Scorer, Fallback, 컨테이너화 |
| **문서화** | 92/100 | 98개 설계 문서, 다이어그램, 이중 언어 |

### 리스크 요약

| 리스크 | 심각도 | 즉시 조치 필요 |
|--------|--------|-------------|
| EXPLAIN SQL 인젝션 | 🔴 높음 | ✅ |
| 옵저버/ACK 에러 무시 | 🔴 높음 | ✅ |
| God Object (3개) | 🟠 중간 | 다음 스프린트 |
| JWT 시크릿 DB 저장 | 🟠 중간 | 다음 스프린트 |
| 테스트 피라미드 역전 | 🟠 중간 | 점진적 개선 |
| 매직 넘버 70건+ | 🟡 낮음 | 점진적 개선 |
| i18n 테스트 부재 | 🟡 낮음 | 점진적 개선 |

### 권장 액션 플랜

**Phase 1 (즉시 — 1-2주)**
1. EXPLAIN SQL 인젝션 수정 (세미콜론/서브쿼리 차단)
2. 버스 옵저버 에러 로깅 추가
3. ACK 실패 로깅 + 메트릭 추가

**Phase 2 (단기 — 3-4주)**
1. ChannelManager God Object 분해
2. JWT 시크릿 환경변수 우선 로딩
3. 통합 테스트 10건 이상 추가
4. i18n 키 완전성 테스트 추가

**Phase 3 (중기 — 5-8주)**
1. PhaseLoopRunner 분해
2. workflow-node.types.ts 분할
3. 매직 넘버 상수 추출
4. `.toBe(true)` → 구체적 어설션 교체

**Phase 4 (장기)**
1. CSRF 토큰 미들웨어 추가
2. Redis 기반 분산 레이트 리미터
3. E2E 테스트 강화 + 별도 CI 잡
4. `Record<string, unknown>` → 구체 타입 교체 (주요 API부터)
