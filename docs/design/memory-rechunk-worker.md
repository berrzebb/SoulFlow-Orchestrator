# Memory Rechunk Worker 설계

## 배경

일별 메모리(`append_daily`)가 업데이트될 때 `rechunk_document`가 메인 스레드에서 동기 실행된다. 이 작업이 에이전트(LLM) 호출 직전에 블로킹하여 발화 시작 지연을 유발한다.

### 현재 흐름
```
사용자 메시지 수신
  → record_user (await)
    → SQLite INSERT          (동기)
    → SQLite READ 전체 문서  (동기)
    → chunk_markdown()       (동기, CPU)
    → SQLite 청크 upsert     (동기)
  → 에이전트 시작 ← 블로킹 해제
    → LLM 호출 (2~30s)
  → 응답 전송
```

### 목표 흐름
```
사용자 메시지 수신
  → record_user (await)
    → SQLite INSERT          (동기, 데이터 보존 필수)
  → 에이전트 시작 ← 즉시
    → LLM 호출 (2~30s)
    (워커: SQLite READ → chunk_markdown → SQLite 청크 upsert)
  → 응답 전송
```

---

## 설계

### 컴포넌트

```
MemoryStore (메인 스레드)
  │
  │ postMessage({ sqlite_path, doc_key, kind, day, content })
  ▼
RechunkWorker (worker_threads, 별도 OS 스레드)
  ├─ chunk_markdown()          — CPU 집약
  └─ SQLite 청크 인덱스 갱신   — IO
```

### 파일 구조

| 파일 | 역할 |
|------|------|
| `src/agent/memory-rechunk-worker.ts` | 워커 엔트리포인트. 청킹 + 임베딩 실행 |
| `src/agent/memory.service.ts` | 워커 생성·관리. `schedule_rechunk`로 위임 |
| `src/agent/memory.types.ts` | `EmbedWorkerConfig` 타입 정의 |
| `src/bootstrap/runtime-data.ts` | `embed_worker_config` 빌드 및 반환 |
| `src/bootstrap/agent-core.ts` | `memory_store.set_embed_worker_config` 주입 |
| `src/main.ts` | DI 체인에 `embed_worker_config` 전달 |

---

## 워커 메시지 프로토콜

```typescript
// 메인 → 워커
type RechunkJob = {
  sqlite_path: string;         // 메모리 DB 경로
  doc_key: string;             // 문서 고유 키 (예: "daily:2026-03-10")
  kind: string;                // "daily" | "longterm"
  day: string;                 // YYYY-MM-DD
  content: string;             // 전체 문서 내용
  embed?: EmbedWorkerConfig;   // 임베딩 설정 (설정된 경우에만)
};

type EmbedWorkerConfig = {
  api_base: string;   // e.g. "http://ollama:11434/v1"
  api_key: string | null;
  model: string;
  dims: number;       // 256
};

// 워커 → 메인: 없음 (fire-and-forget)
```

응답 없음. 청킹/임베딩 실패는 조용히 무시된다(검색 인덱스는 eventual consistency 허용).

---

## 워커 생명주기

```
첫 rechunk 요청
  → Worker 생성 (lazy singleton)
  → worker.unref()  ← 프로세스 종료 시 강제 대기 없음

워커 에러 발생
  → this.rechunk_worker = null  ← 다음 요청 시 재생성

프로세스 종료
  → unref() 덕분에 워커 자동 정리 (진행 중인 청킹은 중단될 수 있음)
     → 허용: 청킹은 검색 인덱스, 원본 문서는 이미 SQLite에 저장됨
```

---

## 개발/운영 환경 분기

```
실행 환경            import.meta.url 확장자   워커 경로
─────────────────────────────────────────────────────────
tsx (dev)           .ts                       src/agent/memory-rechunk-worker.ts
                                               + execArgv: ["--import", "tsx"]
컴파일 (dist/)       .js                       dist/agent/memory-rechunk-worker.js
                                               + execArgv: []
```

---

## 정합성 보장

| 단계 | 스레드 | 보장 |
|------|--------|------|
| 원본 문서 INSERT | 메인 | `record_user` await 완료 후 에이전트 시작 → 원본 손실 없음 |
| 청크 인덱스 갱신 | 워커 | eventual consistency — 직후 검색 시 이전 청크가 반환될 수 있음 |
| get_history() | 메인 | sessions 테이블 사용, 청킹과 무관 |

---

## 트레이드오프

**선택**: 단일 persistent 워커 (lazy singleton)

| 방식 | 장점 | 단점 |
|------|------|------|
| 단일 워커 | 생성 오버헤드 1회 | 직렬 처리 (동시 청킹 불가) |
| 워커 풀 | 병렬 청킹 가능 | 복잡도, SQLite 동시 쓰기 충돌 위험 |
| 매 요청마다 생성 | 구현 단순 | 워커 생성 오버헤드 (~5ms) per 메시지 |

일별 메모리는 일반적으로 순차 업데이트이므로 단일 워커로 충분.
