# 관찰 가능성 강화 (Observability Improvements)

작성일: 2026-03-11
기준 코드베이스: 현재 저장소

## 목적

이 문서는 시스템의 관찰 가능성을 강화할 수 있는 5건의 개선 항목을 기록한다.
현재 코드베이스의 에러 처리 등급은 **6.5/10 (C+)**이며, 관찰 가능성 부재가 주요 원인이다.

현재 잘 되어 있는 것:
- `error_message()` 유틸이 283곳에서 일관되게 사용됨
- 구조적 JSON 로깅 (timestamp, level, name, msg 형식)
- 서비스별 health_check 메서드

---

## O1: 빈 catch 블록 로깅 추가

### 위치

전체 코드베이스 (467건)

### 현재 상태

빈 catch 블록(`catch { }`, `catch { /* noop */ }`)이 467건 존재한다.
에러 정보가 완전히 유실되어 장애 원인 추적이 불가능하다.

### 영향

에러 처리 등급(6.5/10)의 가장 큰 원인.
이 항목 하나를 해결하면 등급이 7.5~8.0으로 올라갈 수 있다.

### 구현 계획

#### 단계 1: 분류

467건을 3개 카테고리로 분류한다.

| 카테고리 | 설명 | 조치 |
|----------|------|------|
| A. 정당한 무시 | `finally` 내 `db.close()`, 정리 작업 | 주석으로 의도 명시 |
| B. 관찰 필요 | 실패해도 동작에 영향 없지만 관찰은 필요 | `logger.debug()` 추가 |
| C. 경고 필요 | 실패가 후속 동작에 영향 줄 수 있음 | `logger.warn()` 추가 |

#### 단계 2: 일괄 처리

카테고리 B 예시:

```typescript
// 변경 전
try { session_store.prune_expired(); } catch { /* noop */ }

// 변경 후
try { session_store.prune_expired(); } catch (e) {
  logger.debug("prune_expired skipped", { error: error_message(e) });
}
```

카테고리 A 예시:

```typescript
// 변경 전
finally { try { db?.close(); } catch {} }

// 변경 후 (주석만 추가)
finally { try { db?.close(); } catch { /* close 실패는 무시 — 리소스 해제 보장 */ } }
```

#### 단계 3: 점진적 처리 순서

1. `src/agent/` — 에이전트 관련 (최우선)
2. `src/channels/` — 채널 관련
3. `src/orchestration/` — 오케스트레이션
4. `src/dashboard/` — 대시보드
5. 나머지

#### 단계 4: 신규 빈 catch 방지

ESLint 규칙 강화를 검토한다.

```javascript
// eslint.config.js
"no-empty": ["error", { "allowEmptyCatch": false }]
```

기존 코드에 대해서는 `// eslint-disable-next-line no-empty` 주석으로 예외 처리한다.

### 분리 방법

각 파일에서 개별 수정. 별도 모듈 분리 불필요.
커밋은 디렉토리 단위로 나누어 진행한다.

### 예상 변경 범위

- 전역 다수 파일 (점진적 처리)

---

## O2: Worker 실패 관찰 가능성 추가

### 위치

`src/agent/memory.service.ts`

### 현재 상태

리청킹 Worker의 실패가 조용히 무시된다. (Critical Issue C3과 연관)

```typescript
try {
  this.get_rechunk_worker().postMessage(job);
} catch {
  // 무음
}
```

### 구현 계획

#### 단계 1: Worker 에러 이벤트 핸들러

```typescript
this._worker.on("error", (err) => {
  this.logger.error("rechunk worker error", { error: error_message(err) });
  this._worker_error_count++;
});

this._worker.on("exit", (code) => {
  if (code !== 0) {
    this.logger.warn("rechunk worker exited abnormally", { code });
  }
  this._worker = null;
});
```

#### 단계 2: health_check에 Worker 상태 포함

```typescript
get_health(): { ok: boolean; worker_errors: number } {
  return {
    ok: this._worker_error_count === 0,
    worker_errors: this._worker_error_count,
  };
}
```

#### 단계 3: catch 블록 로깅

```typescript
try {
  this.get_rechunk_worker().postMessage(job);
} catch (e) {
  this.logger.warn("rechunk dispatch failed", { error: error_message(e) });
}
```

### 분리 방법

기존 파일 내 수정. Worker 관리 로직이 커지면 별도 `rechunk-worker-manager.ts`로 분리 가능하지만, 현재는 불필요.

### 예상 변경 범위

- `src/agent/memory.service.ts`
- 테스트 추가

---

## O3: `with_sqlite()` 에러 로깅

### 위치

`src/utils/sqlite-helper.ts`

### 현재 상태

```typescript
} catch {
  return null; // 무음 실패
}
```

모든 SQLite 에러가 조용히 `null`로 변환된다.

### 구현 계획

#### 단계 1: 기존 함수에 로깅 추가

```typescript
} catch (error) {
  console.error(`[with_sqlite] ${db_path}:`, error instanceof Error ? error.message : String(error));
  return null;
}
```

#### 단계 2: strict 변형 추가 (Critical Issue C4와 연관)

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
    try { db?.close(); } catch { /* close 실패 무시 */ }
  }
}
```

### 분리 방법

기존 `src/utils/sqlite-helper.ts` 내에 함수 추가. 별도 분리 불필요.

### 예상 변경 범위

- `src/utils/sqlite-helper.ts` (로깅 추가 + 함수 추가)
- 테스트 추가

---

## O4: 분류기 에스컬레이션 비율 프로파일링

### 위치

`src/orchestration/classifier.ts`

### 현재 상태

분류기가 `once → agent` 에스컬레이션을 수행하는 비율을 추적하지 않는다.
임계값 조정의 근거 데이터가 없다.

### 구현 계획

```typescript
class ClassifierMetrics {
  private counts = new Map<string, number>();

  record(mode: string): void {
    this.counts.set(mode, (this.counts.get(mode) || 0) + 1);
  }

  get_stats(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}
```

분류 결과마다 `metrics.record(result.mode)`를 호출한다.
health_check 또는 대시보드 API로 노출한다.

### 분리 방법

`ClassifierMetrics` 클래스를 `src/orchestration/classifier.ts` 내부에 추가한다.
API 노출은 대시보드 라우트에서 접근한다.

### 예상 변경 범위

- `src/orchestration/classifier.ts` (메트릭 추가)
- `src/dashboard/routes/state.ts` (API 노출, 선택적)

---

## O5: 모듈별 로그 레벨 오버라이드

### 위치

`src/utils/logger.ts`

### 현재 상태

전체 애플리케이션에 단일 로그 레벨만 설정 가능하다.
특정 모듈만 debug로 설정할 수 없다.

```typescript
init_log_level("info"); // 전역 설정만 가능
```

### 구현 계획

```typescript
const module_overrides = new Map<string, LogLevel>();

export function set_module_log_level(module: string, level: LogLevel): void {
  module_overrides.set(module, level);
}

// ConsoleLogger 내부
private should_log(level: LogLevel): boolean {
  const override = module_overrides.get(this.name);
  const effective = override ?? global_level;
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[effective];
}
```

환경 변수로도 설정 가능하게 한다.

```
LOG_LEVEL_OVERRIDE=memory:debug,classifier:debug
```

### 분리 방법

기존 `src/utils/logger.ts` 내에서 수정. 별도 분리 불필요.

### 예상 변경 범위

- `src/utils/logger.ts` (오버라이드 로직 추가)
- 테스트 추가

---

## 진행 상태

| 항목 | 우선순위 | 상태 |
|------|----------|------|
| O1: 빈 catch 블록 | 중 | 미착수 |
| O2: Worker 관찰 | 높 | 미착수 |
| O3: SQLite 에러 로깅 | 높 | 미착수 |
| O4: 분류기 프로파일링 | 저 | 미착수 |
| O5: 모듈별 로그 레벨 | 중 | 미착수 |
