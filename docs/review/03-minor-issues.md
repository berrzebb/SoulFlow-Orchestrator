# 경미 이슈 (Minor Issues)

작성일: 2026-03-11
기준 코드베이스: 현재 저장소

## 목적

이 문서는 즉시 조치가 필요하지는 않지만 장기적으로 기술 부채가 될 수 있는 경미 이슈 6건을 기록한다.
각 이슈에 대해 문제 진단, 영향 범위, 구현 계획을 포함한다.

---

## L1: 쓰기 큐 에러 삼킴

### 위치

`src/decision/decision-store.ts` — `enqueue_write()`

### 현재 문제

```typescript
private async enqueue_write<T>(job: () => Promise<T>): Promise<T> {
  const run = this.write_queue.then(job, job);
  this.write_queue = run.then(() => undefined, () => undefined); // 에러 삼킴
  return run;
}
```

두 번째 `.then(() => undefined, () => undefined)`가 큐 자체의 에러를 삼킨다.
job1이 실패해도 job2는 실행되지만, 큐의 에러 상태가 유실된다.

### 영향

- 연쇄 쓰기 실패 시 근본 원인 추적 불가
- 큐 상태 불일치 가능

### 구현 계획

```typescript
private async enqueue_write<T>(job: () => Promise<T>): Promise<T> {
  const run = this.write_queue.then(job, job);
  this.write_queue = run.then(
    () => undefined,
    (e) => { this.logger?.debug("write queue error propagated", { error: error_message(e) }); }
  );
  return run;
}
```

### 예상 변경 범위

- `src/decision/decision-store.ts` (1개 메서드)

---

## L2: 크론 표현식 불가능한 일정 미검증

### 위치

`src/cron/cron-scheduler.ts` — `_compute_next_run()`

### 현재 문제

`59 23 31 2 *` (2월 31일) 같은 불가능한 스케줄을 366일치 반복(531,360회)까지 시도한 후 `null`을 반환한다.

```typescript
for (let i = 0; i < 60 * 24 * 366; i += 1) {
  // ... 매칭 시도
}
```

### 영향

- 불필요한 CPU 소모 (최대 531,360회 반복)
- null 반환 후 별도 경고 없음

### 구현 계획

#### 단계 1: 매직 넘버 상수화

```typescript
const MAX_NEXT_RUN_ITERATIONS = 60 * 24 * 366;
```

#### 단계 2: 조기 감지

알려진 불가능 패턴을 사전 검증한다.

```typescript
function is_impossible_cron(parsed: ParsedCron): boolean {
  // 31일: 2월에만 해당하는 경우
  if (parsed.dom.includes(31) && parsed.month.length === 1 && parsed.month[0] === 2) return true;
  // 30일: 2월에만 해당하는 경우
  if (parsed.dom.includes(30) && parsed.month.length === 1 && parsed.month[0] === 2) return true;
  return false;
}
```

#### 단계 3: 경고 로그

루프 완주 시 경고를 남긴다.

```typescript
if (i === MAX_NEXT_RUN_ITERATIONS - 1) {
  on_warn?.(`no matching time found for cron '${schedule.expr}' within 1 year`);
}
```

### 예상 변경 범위

- `src/cron/cron-scheduler.ts` (검증 + 상수화)

---

## L3: 메모리 통합 시 중복 제거 미수행

### 위치

`src/agent/memory.service.ts` — consolidation 로직

### 현재 문제

장기 메모리 통합(consolidation) 시 이미 통합된 블록이 중복으로 누적된다.
통합 주기마다 같은 내용이 반복 추가될 수 있다.

### 영향

- 장기 운영 시 메모리 저장소 크기 불필요하게 증가
- 검색 결과에 중복 콘텐츠 노출

### 구현 계획

#### 통합 전 중복 체크

```typescript
// 기존 통합 결과의 content hash를 비교
const existing_hashes = new Set(
  existing_consolidated.map(c => hash(c.content))
);
const new_blocks = candidates.filter(
  c => !existing_hashes.has(hash(c.content))
);
```

### 예상 변경 범위

- `src/agent/memory.service.ts` (통합 로직)

---

## L4: SQLite DESC 인덱스 효율성

### 위치

- `src/decision/decision-store.ts`
- `src/events/workflow-events-service.ts`

### 현재 문제

```sql
CREATE INDEX IF NOT EXISTS idx_decisions_updated_at ON decisions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_events_at ON workflow_events(at DESC);
```

SQLite 3.45 이전 버전에서는 `DESC` 인덱스 힌트가 무시될 수 있다.
Node.js better-sqlite3가 번들하는 SQLite 버전에 따라 효과가 달라진다.

### 영향

- `ORDER BY ... DESC` 쿼리에서 인덱스를 활용하지 못할 수 있음
- 대량 데이터 시 쿼리 성능 저하

### 구현 계획

#### 확인

```typescript
// better-sqlite3가 번들하는 SQLite 버전 확인
const version = db.prepare("SELECT sqlite_version()").get();

// EXPLAIN QUERY PLAN으로 인덱스 사용 확인
const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM decisions ORDER BY updated_at DESC LIMIT 10").all();
```

실제 인덱스가 사용되지 않는 경우에만 ASC 인덱스로 교체하고 쿼리를 조정한다.

### 예상 변경 범위

- 확인 결과에 따라 결정 (변경 불필요할 수 있음)

---

## L5: DLQ 콘텐츠 4,000자 절삭

### 위치

`src/channels/dispatch.service.ts` — Dead Letter Queue 저장

### 현재 문제

디스패치 서비스의 DLQ에서 에러 콘텐츠가 4,000자로 절삭된다.

```typescript
content: message.content.slice(0, 4000),
```

### 영향

- 디버깅에 필요한 에러 컨텍스트가 유실될 수 있음
- 긴 메시지의 실패 원인 추적 어려움

### 구현 계획

#### 절삭 한도 증가

4,000자를 16,000자로 증가시킨다.

```typescript
const DLQ_CONTENT_MAX = 16_000;
content: message.content.slice(0, DLQ_CONTENT_MAX),
```

또는 압축 옵션을 제공한다.

### 예상 변경 범위

- `src/channels/dispatch.service.ts` (상수 변경)

---

## L6: `Math.random()` ID 생성

### 위치

`src/bootstrap/trigger-sync.ts`

### 현재 문제

```typescript
const run_id = `wf-trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
```

비암호학적 난수 사용. ID 충돌 가능성이 이론적으로 존재한다.

### 영향

- ID 충돌 가능성 (매우 낮지만 비영)
- 보안 컨텍스트에서의 예측 가능성

### 구현 계획

```typescript
import { randomBytes } from "node:crypto";

const run_id = `wf-trigger_${Date.now()}_${randomBytes(4).toString("hex")}`;
```

### 예상 변경 범위

- `src/bootstrap/trigger-sync.ts` (1줄)

---

## 진행 상태

| 이슈 | 상태 | 비고 |
|------|------|------|
| L1: 쓰기 큐 에러 삼킴 | 미착수 | |
| L2: 크론 불가능 일정 | 미착수 | |
| L3: 메모리 통합 중복 | 미착수 | |
| L4: DESC 인덱스 효율 | 미착수 | 확인 선행 |
| L5: DLQ 콘텐츠 절삭 | 미착수 | |
| L6: Math.random() ID | 미착수 | |
