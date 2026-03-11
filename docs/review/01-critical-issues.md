# 심각 이슈 (Critical Issues)

작성일: 2026-03-11
기준 코드베이스: 현재 저장소

## 목적

이 문서는 프로덕션 운영에서 즉시 문제가 될 수 있는 심각 이슈 4건을 기록한다.
각 이슈에 대해 문제 진단, 영향 범위, 구현 계획을 포함한다.

---

## C1: 벡터 DB 연결 누수

### 위치

`src/agent/memory.service.ts` — `search_chunks_vec()` 메서드

### 현재 문제

벡터 검색 시 `embed_fn()` 호출이 실패하면 DB 연결이 닫히지 않을 수 있다.

```typescript
const db = new Database(this.sqlite_path, { readonly: true });
sqliteVec.load(db);
// ... embed_fn() 호출 중 실패 시 db.close() 미도달 가능
finally { db?.close(); }
```

현재 코드는 try-finally 구조를 갖고 있지만, `embed_fn()`이 Promise reject를 일으키면서 동시에 db 참조가 유효한 상태에서 예외가 전파되는 경로가 존재한다.

### 영향

- 부하 시 연결 풀 고갈
- 메모리 누수 (특히 long-running 프로세스에서)
- SQLite 파일 잠금이 해제되지 않아 다른 읽기 작업에도 영향 가능

### 구현 계획

#### 단계 1: embed_fn 호출을 try-finally 내부로 확실히 격리

현재 구조를 검증하여 embed_fn 실패 경로에서 db.close()가 반드시 호출되는지 확인한다.

```typescript
async search_chunks_vec(query: string, limit: number): Promise<ChunkResult[]> {
  let db: DatabaseSync | null = null;
  try {
    db = new Database(this.sqlite_path, { readonly: true });
    sqliteVec.load(db);

    // embed_fn 호출을 try 블록 안에서 수행
    const embedding = await this.embed_fn([query.slice(0, 2000)]);
    if (!embedding?.length) return [];

    // 이후 db 쿼리 수행
    const stmt = db.prepare(`SELECT ...`);
    return stmt.all(embedding[0]) as ChunkResult[];
  } catch (e) {
    this.logger.debug("vec search failed", { error: error_message(e) });
    return [];
  } finally {
    try { db?.close(); } catch { /* close 자체의 실패는 무시해도 된다 */ }
  }
}
```

#### 단계 2: embed_fn에 타임아웃 추가

embed_fn이 무한 대기하는 경우를 방지한다.

```typescript
const embedding = await Promise.race([
  this.embed_fn([query.slice(0, 2000)]),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("embed_fn timeout")), 10_000)
  ),
]);
```

#### 단계 3: 테스트 추가

- embed_fn이 reject하는 시나리오에서 db.close()가 호출되는지 검증
- embed_fn이 타임아웃하는 시나리오 검증

### 완료 기준

- embed_fn 실패 시에도 db 연결이 반드시 해제된다
- 타임아웃이 설정되어 무한 대기가 방지된다
- 기존 벡터 검색 결과가 동일하다

### 예상 변경 범위

- `src/agent/memory.service.ts` (1개 메서드)
- `tests/agent/memory-service-*.test.ts` (테스트 추가)

---

## C2: 이중 Promise 해결 경쟁 조건

### 위치

`src/agent/backends/codex-appserver.agent.ts` — 이벤트 핸들러

### 현재 문제

`turn/completed`와 `thread/closed` 이벤트 순서에 따라 Promise가 이중 해결될 수 있다.

```typescript
if (method === "turn/completed") {
  turn_completed = true;
  resolve({...});   // 첫 번째 해결
}
if (method === "thread/closed") {
  if (!turn_completed) {
    resolve({...}); // 경쟁: turn_completed 플래그 설정 후에도 도달 가능
  }
}
```

문제는 두 이벤트가 거의 동시에 도착하는 경우, `turn_completed` 플래그 확인과 `resolve()` 호출 사이에 경쟁이 발생할 수 있다는 점이다.

### 영향

- 처리되지 않은 Promise 거부로 에러 핸들러 충돌 가능
- 드물지만 재현 불가능한 간헐적 에이전트 실행 실패

### 구현 계획

#### 단계 1: 원자적 해결 가드 도입

```typescript
let resolution_pending = true;

const do_resolve = (result: AgentResult): void => {
  if (!resolution_pending) return;
  resolution_pending = false;
  resolve(result);
};

const do_reject = (error: Error): void => {
  if (!resolution_pending) return;
  resolution_pending = false;
  reject(error);
};
```

#### 단계 2: 기존 resolve/reject 호출을 do_resolve/do_reject로 교체

모든 이벤트 핸들러에서 직접 `resolve()`/`reject()` 대신 가드 함수를 사용한다.

#### 단계 3: 테스트 추가

- turn/completed → thread/closed 순서 시나리오
- thread/closed → turn/completed 순서 시나리오
- 동시 도착 시 첫 번째만 해결되는지 검증

### 완료 기준

- Promise가 정확히 한 번만 해결된다
- 두 이벤트의 순서에 관계없이 결과가 일관된다
- 기존 정상 경로 동작이 유지된다

### 예상 변경 범위

- `src/agent/backends/codex-appserver.agent.ts` (이벤트 핸들러)
- `tests/agent/backends/codex-appserver-agent.test.ts` (테스트 추가)

---

## C3: 무음 Worker 실패

### 위치

`src/agent/memory.service.ts` — 리청킹 Worker

### 현재 문제

리청킹 Worker의 실패가 조용히 무시된다.

```typescript
try {
  this.get_rechunk_worker().postMessage(job);
} catch {
  // 무음 실패 — 청크가 스테일 상태로 남음
}
```

Worker가 실패하면 메모리 인덱스가 실제 문서와 동기화되지 않은 채로 남는다.
이 상태는 외부에서 관찰할 수 없다.

### 영향

- 장기 운영 시 메모리 검색 품질 저하
- 관찰 가능성(observability) 완전 부재
- 장애 원인 추적 불가

### 구현 계획

#### 단계 1: Worker 에러 이벤트 핸들러 추가

```typescript
private get_rechunk_worker(): Worker {
  if (!this._worker) {
    this._worker = new Worker(RECHUNK_WORKER_PATH);
    this._worker.on("error", (err) => {
      this.logger.error("rechunk worker error", { error: error_message(err) });
      this._worker_error_count++;
    });
    this._worker.on("exit", (code) => {
      if (code !== 0) {
        this.logger.warn("rechunk worker exited with code", { code });
      }
      this._worker = null; // 다음 호출 시 재생성
    });
  }
  return this._worker;
}
```

#### 단계 2: 실패 메트릭 노출

```typescript
get_health(): { ok: boolean; worker_errors: number } {
  return {
    ok: this._worker_error_count === 0,
    worker_errors: this._worker_error_count,
  };
}
```

#### 단계 3: catch 블록에 로깅 추가

```typescript
try {
  this.get_rechunk_worker().postMessage(job);
} catch (e) {
  this.logger.warn("rechunk job dispatch failed", { error: error_message(e) });
}
```

### 완료 기준

- Worker 실패 시 로그가 남는다
- Worker 에러 카운트가 health_check에서 조회 가능하다
- Worker 비정상 종료 시 다음 호출에서 자동 재생성된다

### 예상 변경 범위

- `src/agent/memory.service.ts` (Worker 관리 로직)
- `tests/agent/memory-service-*.test.ts` (테스트 추가)

---

## C4: SQLite 초기화 무음 실패

### 위치

- `src/decision/decision-store.ts`
- `src/events/workflow-events-service.ts`
- `src/cron/cron-scheduler.ts`

(공통: `with_sqlite()` 헬퍼 사용)

### 현재 문제

`with_sqlite()` 헬퍼가 에러 시 `null`을 반환하지만, 호출자가 null 체크를 하지 않는 경우가 있다.

```typescript
with_sqlite(this.sqlite_path, (db) => {
  db.exec(`CREATE TABLE IF NOT EXISTS ...`);
  return true;
}); // null 체크 없음! 디스크 권한 오류 등으로 실패 시 조용히 지나감
```

### 영향

- 스키마 초기화 실패 시 서비스가 비기능 상태로 시작됨
- 후속 INSERT/SELECT가 "table not found" 에러를 일으킴
- 근본 원인(디스크 권한, 용량 부족)이 숨겨짐

### 구현 계획

#### 단계 1: `with_sqlite_strict()` 변형 추가

`src/utils/sqlite-helper.ts`에 실패 시 throw하는 변형을 추가한다.

```typescript
export function with_sqlite_strict<T>(
  db_path: string,
  run: (db: DatabaseSync) => T,
  options?: SqliteRunOptions,
): T {
  let db: DatabaseSync | null = null;
  try {
    db = new Database(db_path);
    if (options?.pragmas) {
      for (const p of options.pragmas) db.pragma(p);
    }
    return run(db);
  } finally {
    try { db?.close(); } catch { /* close 실패는 무시 */ }
  }
  // catch 없음 — 에러가 그대로 전파됨
}
```

#### 단계 2: 스키마 초기화 호출을 with_sqlite_strict로 교체

필수 초기화 경로에서는 실패 시 서비스 시작을 중단해야 한다.

```typescript
// decision-store.ts
private async ensure_initialized(): Promise<void> {
  await this.ensure_dirs();
  with_sqlite_strict(this.sqlite_path, (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS decisions ...`);
  });
}
```

#### 단계 3: 기존 with_sqlite()에 에러 로깅 추가

기존 `with_sqlite()` 함수의 catch 블록에 최소한 에러 로깅을 추가한다.

```typescript
} catch (error) {
  // 기존: return null (무음)
  // 변경: 로깅 후 null 반환
  console.error(`[with_sqlite] ${db_path}:`, error);
  return null;
}
```

### 완료 기준

- 필수 스키마 초기화는 `with_sqlite_strict()`를 사용한다
- 초기화 실패 시 서비스가 시작되지 않는다
- 기존 `with_sqlite()` 사용처 중 초기화가 아닌 곳은 그대로 유지한다
- 기존 `with_sqlite()` catch에 로깅이 추가된다

### 예상 변경 범위

- `src/utils/sqlite-helper.ts` (함수 추가 + 기존 함수 로깅)
- `src/decision/decision-store.ts` (호출 교체)
- `src/events/workflow-events-service.ts` (호출 교체)
- `src/cron/cron-scheduler.ts` (호출 교체)
- 관련 테스트 파일 (시나리오 추가)

---

## 진행 상태

| 이슈 | 상태 | 비고 |
|------|------|------|
| C1: 벡터 DB 연결 누수 | 미착수 | |
| C2: 이중 Promise 해결 | 미착수 | |
| C3: 무음 Worker 실패 | 미착수 | |
| C4: SQLite 초기화 무음 실패 | 미착수 | |
