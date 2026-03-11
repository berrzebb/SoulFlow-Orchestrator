# 성능 최적화 (Performance Improvements)

작성일: 2026-03-11
기준 코드베이스: 현재 저장소

## 목적

이 문서는 프로덕션 운영 환경에서 성능을 개선할 수 있는 5건의 최적화 항목을 기록한다.
현재 성능 등급: **7.5/10 (B)**

현재 잘 되어 있는 것:
- 인메모리 BoundedQueue의 O(1) enqueue/dequeue
- Worker Thread 격리로 청킹이 메인 스레드를 블로킹하지 않음
- ToolIndex의 인메모리 역인덱스로 80% 쿼리가 디스크 I/O 없이 처리됨
- LRU 쿼리 캐시로 반복 쿼리 최적화

---

## P1: 레퍼런스 동기화 디바운스

### 위치

`src/agent/context.service.ts`

### 현재 상태

```typescript
await this._reference_store.sync(); // build_system_prompt()마다 매번 호출
```

`build_system_prompt()`가 호출될 때마다 레퍼런스 스토어를 동기화한다.
문서가 변경되지 않았더라도 매번 디스크 I/O가 발생한다.

### 영향

- 프롬프트 생성 당 500ms+ 지연 가능
- 동시 여러 에이전트 실행 시 누적 지연

### 구현 계획

#### TTL 기반 디바운스

```typescript
private _last_sync_at = 0;
private static readonly SYNC_TTL_MS = 5_000;

private async _maybe_sync(): Promise<void> {
  const now = Date.now();
  if (now - this._last_sync_at < ContextService.SYNC_TTL_MS) return;
  await this._reference_store.sync();
  this._last_sync_at = now;
}
```

`build_system_prompt()`에서 `sync()` 대신 `_maybe_sync()`를 호출한다.

### 분리 방법

기존 파일 내 수정. 디바운스 로직 자체가 3줄이므로 별도 유틸 불필요.

### 완료 기준

- 5초 이내 재호출 시 sync를 건너뜀
- 5초 경과 후 정상 동기화
- 기존 프롬프트 결과 동일

### 예상 변경 범위

- `src/agent/context.service.ts` (1개 메서드)
- 테스트 추가

---

## P2: 도구 임베딩 워밍업

### 위치

`src/orchestration/tool-index.ts`

### 현재 상태

도구 임베딩이 첫 사용 시 지연 생성(lazy)된다.
첫 쿼리에서 1~2초 지연이 발생한다.

### 영향

- 첫 번째 사용자 요청의 응답 시간 증가
- 냉간 시작(cold start) 경험 저하

### 구현 계획

#### 비동기 워밍업

서비스 시작 시 백그라운드에서 임베딩을 미리 생성한다.

```typescript
async warm_up(): Promise<void> {
  const tools = this.get_all_tools();
  const unembedded = tools.filter(t => !this._has_embedding(t.name));
  if (unembedded.length === 0) return;

  this.logger.debug("warming up tool embeddings", { count: unembedded.length });
  const texts = unembedded.map(t => `${t.name}: ${t.description}`);
  await this.embed_fn(texts); // 배치 임베딩
  this.logger.debug("tool embedding warm-up complete");
}
```

`ServiceManager` 등록 후 `start()` 단계에서 호출한다.

### 분리 방법

기존 파일 내 메서드 추가. 별도 분리 불필요.

### 완료 기준

- 서비스 시작 후 첫 쿼리 지연 없음
- 워밍업 실패 시 기존 lazy 방식으로 폴백
- 워밍업 시간이 서비스 시작을 블로킹하지 않음

### 예상 변경 범위

- `src/orchestration/tool-index.ts` (메서드 추가)
- `src/bootstrap/orchestration.ts` (워밍업 호출)
- 테스트 추가

---

## P3: 루프 서비스 메일박스 크기 제한

### 위치

`src/agent/loop.service.ts`

### 현재 상태

에이전트 루프의 메일박스에 크기 제한이 없다.
메시지가 처리되는 속도보다 빠르게 도착하면 메모리가 무한히 증가한다.

### 영향

- 대량 메시지 수신 시 메모리 고갈 가능
- OOM(Out of Memory) 크래시 위험

### 구현 계획

#### BoundedQueue 패턴 적용

기존 `InMemoryMessageBus`의 `BoundedQueue` 패턴을 메일박스에도 적용한다.

```typescript
private readonly mailbox = new BoundedQueue<MailboxMessage>(1000, "drop-oldest");
```

또는 최대 크기를 설정 가능하게 한다.

```typescript
const MAILBOX_MAX = config.agent?.mailboxMax ?? 1000;
```

### 분리 방법

기존 파일 내 수정. `BoundedQueue`는 이미 `src/bus/` 에 구현되어 있으므로 재사용한다.

### 완료 기준

- 메일박스에 크기 제한이 적용됨
- 오버플로 시 가장 오래된 메시지가 드롭됨
- 드롭 시 warn 로그
- 기존 메일박스 동작 유지

### 예상 변경 범위

- `src/agent/loop.service.ts` (메일박스 타입 변경)
- 테스트 추가

---

## P4: 크론 스케줄러 불가능 표현식 조기 감지

### 위치

`src/cron/cron-scheduler.ts`

### 현재 상태

`59 23 31 2 *` 같은 불가능한 스케줄을 366일치 반복(531,360회)까지 시도한다.

### 영향

- 불필요한 CPU 소모
- 크론 잡 등록 시 피드백 지연

### 구현 계획

#### 사전 검증 함수

```typescript
const MAX_NEXT_RUN_ITERATIONS = 60 * 24 * 366;

function is_impossible_cron(parsed: ParsedCron): boolean {
  // 2월 30~31일
  if (parsed.month.length === 1 && parsed.month[0] === 2) {
    if (parsed.dom.some(d => d >= 30)) return true;
  }
  return false;
}
```

잡 등록 시 사전 검증을 수행하고, 불가능 시 즉시 에러를 반환한다.

### 분리 방법

기존 파일 내 함수 추가.

### 예상 변경 범위

- `src/cron/cron-scheduler.ts` (검증 함수 + 상수화)
- 테스트 추가

---

## P5: 세션 정리 실패 시 백오프

### 위치

`src/bootstrap/services.ts`

### 현재 상태

```typescript
setInterval(() => {
  try { agent_session_store.prune_expired(); } catch { /* noop */ }
}, 3_600_000); // 1시간 고정
```

정리 실패 시 재시도가 없고, 실패 빈도가 올라가도 간격이 동일하다.

### 영향

- 세션 누적으로 디스크 사용량 증가
- 실패 원인(디스크 가득 참 등)이 해결되어도 1시간 대기

### 구현 계획

```typescript
let prune_interval = 3_600_000; // 기본 1시간
let consecutive_failures = 0;

async function try_prune(): Promise<void> {
  try {
    agent_session_store.prune_expired();
    consecutive_failures = 0;
    prune_interval = 3_600_000; // 성공 시 원래 간격
  } catch (e) {
    consecutive_failures++;
    logger.warn("prune failed", { error: error_message(e), failures: consecutive_failures });
    // 지수 백오프: 1시간 → 2시간 → 4시간 (최대)
    prune_interval = Math.min(prune_interval * 2, 4 * 3_600_000);
  }
  setTimeout(try_prune, prune_interval);
}

setTimeout(try_prune, prune_interval);
```

### 분리 방법

기존 `bootstrap/services.ts` 내 수정.
로직이 커지면 `src/session/prune-scheduler.ts`로 분리 가능.

### 예상 변경 범위

- `src/bootstrap/services.ts` (정리 로직)

---

## 진행 상태

| 항목 | 우선순위 | 상태 |
|------|----------|------|
| P1: 레퍼런스 디바운스 | 높 | 미착수 |
| P2: 임베딩 워밍업 | 중 | 미착수 |
| P3: 메일박스 크기 제한 | 중 | 미착수 |
| P4: 크론 조기 감지 | 저 | 미착수 |
| P5: 정리 백오프 | 저 | 미착수 |
