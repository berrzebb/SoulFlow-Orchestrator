# 중간 이슈 (Medium Issues)

작성일: 2026-03-11
기준 코드베이스: 현재 저장소

## 목적

이 문서는 즉시 장애를 일으키지는 않지만 코드 품질과 유지보수성을 저하시키는 중간 이슈 7건을 기록한다.
각 이슈에 대해 문제 진단, 영향 범위, 구현 계획을 포함한다.

---

## M1: `Record<string, unknown>` 과다 사용

### 위치

전체 코드베이스 (1,213건)

### 현재 문제

채널 메시지, 메타데이터, API 응답 등에서 `Record<string, unknown>` 타입이 광범위하게 사용된다.

```typescript
const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
const prev_error = String((msg.metadata as Record<string, unknown>)?.dispatch_error || "");
```

### 영향

- 타입 안전성 약화
- 런타임 에러 발견 지연
- IDE 자동완성 불가
- 리팩토링 시 변경 영향 추적 불가

### 구현 계획

이 이슈는 전역적이므로 점진적으로 접근해야 한다.

#### 단계 1: 고빈도 사용처 식별

다음 영역에서 전용 타입을 먼저 정의한다.

- 채널 메시지 타입: `SlackRawMessage`, `DiscordRawMessage`, `TelegramRawMessage`
- 디스패치 메타데이터: `DispatchMetadata`
- 대시보드 ops 응답: `OpsResult<T>`

#### 단계 2: 채널별 메시지 타입 파일 생성

```
src/channels/slack.types.ts
src/channels/discord.types.ts
src/channels/telegram.types.ts
```

각 파일에 프로바이더 API 응답 형태를 반영한 타입을 정의한다.

#### 단계 3: 점진적 교체

한 번에 모든 1,213건을 교체하지 않는다.
채널 레이어 → 디스패치 → 대시보드 → 나머지 순서로 교체한다.

### 완료 기준

- 채널 레이어의 `Record<string, unknown>` 사용이 전용 타입으로 대체된다
- 최소 상위 50건의 사용처가 전용 타입을 갖는다
- 기존 동작 변경 없음

### 예상 변경 범위

- `src/channels/*.types.ts` (신규 파일 3개)
- `src/channels/slack.channel.ts`, `discord.channel.ts`, `telegram.channel.ts`
- `src/channels/dispatch.service.ts`

---

## M2: 빈 catch 블록 467건

### 위치

전체 코드베이스 (467건)

### 현재 문제

`catch { }` 또는 `catch { /* noop */ }` 패턴이 467건 존재한다.

```typescript
try { agent_session_store.prune_expired(); } catch { /* noop */ }
} catch { /* no soul */ }
```

에러 정보가 완전히 유실된다.

### 영향

- 디버깅 어려움
- 무음 장애 누적
- 장기 운영 시 근본 원인 추적 불가

### 구현 계획

#### 단계 1: 분류

467건을 다음 카테고리로 분류한다.

1. **정당한 무시** — `finally` 내 `db.close()` 같은 정리 작업 (변경 불필요)
2. **debug 로그 추가** — 실패해도 동작에 영향 없지만 관찰은 필요한 경우
3. **warn/error 로그 추가** — 실패가 후속 동작에 영향을 줄 수 있는 경우

#### 단계 2: 카테고리별 일괄 처리

카테고리 2에 해당하는 catch 블록에 debug 로그를 추가한다.

```typescript
// 변경 전
try { session_store.prune_expired(); } catch { /* noop */ }

// 변경 후
try { session_store.prune_expired(); } catch (e) {
  logger.debug("prune_expired failed", { error: error_message(e) });
}
```

카테고리 3에 해당하는 catch 블록에 warn 로그를 추가한다.

#### 단계 3: ESLint 규칙 추가 검토

새로운 빈 catch 블록 생성을 방지하기 위해 `no-empty` 규칙 강화를 검토한다.

### 완료 기준

- 카테고리 분류가 완료된다
- 카테고리 2, 3에 해당하는 catch 블록에 로깅이 추가된다
- 카테고리 1은 주석으로 의도를 명시한다

### 예상 변경 범위

- 전역 다수 파일 (점진적 진행)

---

## M3: 도구 입력 JSON 파싱 오류 무시

### 위치

- `src/agent/backends/anthropic-native.agent.ts`
- `src/agent/backends/openai-compatible.agent.ts`

### 현재 문제

LLM이 보내는 도구 호출의 JSON 입력 파싱이 실패하면 빈 객체(`{}`)로 대체된다.

### 영향

- 도구가 잘못된 인수로 실행됨
- LLM 응답 품질 문제가 도구 실행 실패로 전파됨
- 디버깅 시 원인이 LLM인지 파싱인지 구분 불가

### 구현 계획

#### 단계 1: 파싱 실패 시 로깅 추가

```typescript
let tool_input: Record<string, unknown>;
try {
  tool_input = JSON.parse(raw_input);
} catch (e) {
  logger.warn("tool input JSON parse failed", {
    tool_name,
    raw_input: raw_input.slice(0, 500),
    error: error_message(e),
  });
  tool_input = {};
}
```

#### 단계 2: 파싱 실패를 도구 결과에 반영

파싱 실패 시 도구 결과에 에러 마커를 포함한다.

```typescript
if (parse_failed) {
  tool_result = {
    error: "tool_input_parse_failed",
    raw_input_preview: raw_input.slice(0, 200),
  };
}
```

### 완료 기준

- JSON 파싱 실패 시 로그가 남는다
- 도구 실행이 잘못된 인수로 조용히 진행되지 않는다
- 기존 정상 파싱 경로 동작이 유지된다

### 예상 변경 범위

- `src/agent/backends/anthropic-native.agent.ts`
- `src/agent/backends/openai-compatible.agent.ts`
- 관련 테스트 파일

---

## M4: Slack 타임스탬프 검증 미비

### 위치

`src/channels/slack.channel.ts` — `is_valid_slack_ts()`

### 현재 문제

```typescript
function is_valid_slack_ts(ts: string): boolean {
  return /^\d+\.\d+$/.test(ts); // 형식만 검증, 범위 미검증
}
```

`9223372036854775807.999999` 같은 극단값이 통과한다.

### 구현 계획

#### 범위 검증 추가

```typescript
function is_valid_slack_ts(ts: string): boolean {
  if (!/^\d+\.\d+$/.test(ts)) return false;
  const [sec] = ts.split(".");
  const sec_num = Number(sec);
  // Slack은 2013년 출시. 1970년 이전이나 먼 미래 값은 거부
  return sec_num > 1_000_000_000 && sec_num < 2_000_000_000;
}
```

### 예상 변경 범위

- `src/channels/slack.channel.ts` (1개 함수)
- `tests/channels/slack.channel.test.ts` (테스트 추가)

---

## M5: Telegram HTML 파싱 모드 미이스케이프

### 위치

`src/channels/telegram.channel.ts`

### 현재 문제

`parse_mode="HTML"` 설정 시 사용자 입력의 `<b>`, `<code>` 등이 마크업으로 해석될 수 있다.

### 구현 계획

#### HTML 이스케이프 유틸 추가

```typescript
function escape_telegram_html(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

사용자 입력이 포함되는 HTML 템플릿에서 이스케이프 함수를 적용한다.
시스템이 의도적으로 생성하는 마크업은 이스케이프하지 않는다.

### 예상 변경 범위

- `src/channels/telegram.channel.ts`
- `tests/channels/telegram.channel.test.ts` (테스트 추가)

---

## M6: OAuthFlowService 생명주기 미통합

### 위치

`src/oauth/flow-service.ts`

### 현재 문제

`close()` 메서드가 존재하지만 `ServiceLike` 인터페이스를 구현하지 않아 앱 셧다운 시 `close()`가 호출되지 않는다.

```typescript
this.cleanup_timer = setInterval(...);
this.refresh_timer = setInterval(...);
// unref() 호출은 되어 있지만, 명시적 정리가 누락됨
```

### 구현 계획

#### ServiceLike 인터페이스 구현

```typescript
export class OAuthFlowService implements ServiceLike {
  readonly name = "oauth-flow";

  async start(): Promise<void> {
    // 이미 생성자에서 타이머가 시작됨 — 추가 작업 불필요
  }

  async stop(): Promise<void> {
    this.close();
  }

  health_check(): { ok: boolean; detail?: string } {
    return { ok: true };
  }
}
```

ServiceManager에 등록한다.

```typescript
// bootstrap/services.ts
service_manager.register(oauth_flow_service, { required: false });
```

### 예상 변경 범위

- `src/oauth/flow-service.ts` (ServiceLike 구현)
- `src/bootstrap/services.ts` (등록 추가)
- `tests/oauth/oauth-flow.test.ts` (테스트 추가)

---

## M7: 컨텍스트 레퍼런스 동기화 지연

### 위치

`src/agent/context.service.ts`

### 현재 문제

```typescript
await this._reference_store.sync(); // build_system_prompt()마다 매번 호출
```

문서 변경 시 500ms+ 지연이 모든 프롬프트 생성에 누적된다.

### 구현 계획

#### TTL 기반 캐시 도입

```typescript
private _last_sync_at = 0;
private static SYNC_TTL_MS = 5_000; // 5초

private async _maybe_sync(): Promise<void> {
  const now = Date.now();
  if (now - this._last_sync_at < ContextService.SYNC_TTL_MS) return;
  await this._reference_store.sync();
  this._last_sync_at = now;
}
```

`build_system_prompt()`에서 `_maybe_sync()`를 호출하도록 변경한다.

### 완료 기준

- 5초 이내 재호출 시 sync를 건너뛴다
- 5초 경과 후에는 정상적으로 동기화한다
- 기존 동작 변경 없음

### 예상 변경 범위

- `src/agent/context.service.ts` (1개 메서드 수정)
- `tests/agent/context-service.test.ts` (테스트 추가)

---

## 진행 상태

| 이슈 | 상태 | 비고 |
|------|------|------|
| M1: Record 과다 사용 | 미착수 | 점진적 진행 |
| M2: 빈 catch 블록 | 미착수 | 분류 선행 |
| M3: JSON 파싱 오류 무시 | 미착수 | |
| M4: Slack 타임스탬프 | 미착수 | |
| M5: Telegram HTML | 미착수 | |
| M6: OAuth 생명주기 | 미착수 | |
| M7: 컨텍스트 동기화 | 미착수 | |
