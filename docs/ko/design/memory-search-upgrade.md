# Memory Search Upgrade: Chunking + Scored Hybrid + Temporal Decay

> **Status**: `implemented` | **Dependencies**: sqlite-vec, FTS5, embed service
> **Reference**: OpenClaw memory system, memsearch (zilliztech)

## Problem

현재 메모리 검색의 3가지 병목:

1. **문서 단위 임베딩** — longterm 메모리가 커지면 벡터가 평균화되어 검색 정밀도 하락
2. **단순 합집합 병합** — FTS5 결과 + 벡터 결과를 점수 없이 합치므로 순위 품질 낮음
3. **시간 무시** — 3주 전 기록과 어제 기록이 동일 가중치

## Solution: 4단계 개선

### Phase 1: Heading-Based Chunking

문서를 헤딩 단위로 분할하여 각 청크가 하나의 토픽을 대표.

```
## 사용자 선호
dark mode 선호, 한국어 응답...

## 프로젝트 구조
src/agent/ — 에이전트 런타임...
```

위 longterm을 2개 청크로 분할:
- chunk[0]: "사용자 선호\ndark mode 선호, 한국어 응답..."
- chunk[1]: "프로젝트 구조\nsrc/agent/ — 에이전트 런타임..."

#### Chunking Algorithm

```
1. 마크다운 헤딩(# ~ ######)으로 섹션 분할
2. 섹션이 MAX_CHUNK_SIZE(1500자) 초과 시 단락(\n\n) 경계에서 재분할
3. 오버랩: 2줄 (문맥 연속성)
4. 각 청크에 SHA-256 해시 부여: hash(source:startLine:endLine:contentHash)
5. 해시 불변 청크는 재임베딩 스킵
```

#### Schema Change

```sql
-- 기존 memory_documents는 그대로 유지 (source of truth)
-- 새 테이블: 청크 인덱스
CREATE TABLE memory_chunks (
  chunk_id    TEXT PRIMARY KEY,   -- SHA-256 composite hash
  doc_key     TEXT NOT NULL,      -- memory_documents.doc_key FK
  heading     TEXT NOT NULL DEFAULT '',
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  content     TEXT NOT NULL,
  content_hash TEXT NOT NULL
);

-- FTS5는 청크 단위로 재구축
CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
  content,
  content='memory_chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- vec0도 청크 단위
CREATE VIRTUAL TABLE memory_chunks_vec USING vec0(
  embedding float[256]
);
```

### Phase 2: Scored Hybrid Fusion (RRF)

FTS5 BM25 + 벡터 KNN 결과를 **Reciprocal Rank Fusion**으로 병합.

```
RRF_score(chunk) = sum_over_rankers( 1 / (k + rank_i) )
```

- `k = 60` (memsearch 기본값, 낮은 순위의 과도한 영향 방지)
- 각 ranker(FTS5, vector)에서 `top_k × 3` 후보를 가져옴
- 두 ranker의 RRF 점수를 합산하여 최종 순위 결정

#### Why RRF over Weighted Fusion

| 방식 | 장점 | 단점 |
|------|------|------|
| Weighted (0.7v + 0.3t) | 직관적 | BM25 점수와 벡터 점수 스케일이 다름, 정규화 필요 |
| **RRF** | 스케일 무관 (순위 기반), 튜닝 불필요 | k 파라미터 1개만 |

RRF는 점수 정규화 없이 순위만으로 병합하므로 구현이 간단하고 안정적.

#### Pseudocode

```typescript
function rrf_merge(
  fts_results: { id: string; rank: number }[],
  vec_results: { id: string; rank: number }[],
  k = 60,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();

  for (const r of fts_results) {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + r.rank));
  }
  for (const r of vec_results) {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + r.rank));
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
```

### Phase 3: Temporal Decay

검색 결과에 시간 감쇠를 적용하여 최근 기억을 우선.

```
decayed_score = rrf_score * e^(-lambda * age_days)
lambda = ln(2) / half_life_days
```

| 파라미터 | 값 | 근거 |
|----------|-----|------|
| half_life | 14일 | 일별 기록은 2주 후 50% 감쇠 |
| longterm 면제 | true | 장기 기억은 감쇠 없음 (evergreen) |

감쇠 곡선:
- 오늘: 100%
- 7일: ~71%
- 14일: 50%
- 30일: ~23%
- 60일: ~5%

### Phase 4: Compaction Flush

컨텍스트 압축 전 자동으로 메모리 저장 턴을 삽입.

#### Trigger Condition

에이전트 루프에서 토큰 사용량이 임계점에 도달하면:
```
current_tokens >= context_window - reserve_floor - soft_threshold
```

기본값 (200K 컨텍스트 기준):
- `reserve_floor`: 20,000 토큰
- `soft_threshold`: 4,000 토큰
- 트리거: ~176,000 토큰

#### Mechanism

1. 에이전트 루프가 토큰 임계점 감지
2. 사용자 메시지 처리 전에 silent memory flush turn 삽입
3. 시스템: "Session nearing compaction. Store durable memories now."
4. 에이전트가 `memory(action="append_daily", ...)` 호출
5. 응답이 NO_REPLY면 스킵, 아니면 메모리 저장 후 원래 대화 계속
6. 1 compaction 주기당 최대 1회 flush

## Implementation Plan

### Phase 1: Chunking (memory.service.ts)

| 변경 | 파일 |
|------|------|
| `chunk_markdown()` 함수 | `src/agent/memory-chunker.ts` (신규) |
| `memory_chunks` + `_fts` + `_vec` 테이블 | `memory.service.ts` — `ensure_initialized()` |
| 문서 쓰기 시 자동 re-chunk | `sqlite_upsert_document()`, `sqlite_append_document()` |
| `search()` 대상을 chunks로 변경 | `memory.service.ts` — `search()` |

### Phase 2: RRF Fusion (memory.service.ts)

| 변경 | 파일 |
|------|------|
| `rrf_merge()` 유틸 | `src/agent/memory-scoring.ts` (신규) |
| `search()`에서 RRF 적용 | `memory.service.ts` |

### Phase 3: Temporal Decay (memory.service.ts)

| 변경 | 파일 |
|------|------|
| `temporal_decay()` | `src/agent/memory-scoring.ts` |
| 청크에 `created_at` 타임스탬프 | `memory_chunks` 스키마 |

### Phase 4: Compaction Flush (loop.service.ts)

| 변경 | 파일 |
|------|------|
| 토큰 카운트 임계점 감지 | `src/agent/loop.service.ts` |
| flush turn 삽입 로직 | `src/agent/loop.service.ts` |

## Migration

- 기존 `memory_documents` 테이블은 source of truth로 유지
- `memory_chunks` + `_fts` + `_vec`는 파생 인덱스 (rebuild 가능)
- 첫 검색 시 lazy re-chunking + re-embedding
- 기존 `memory_vec` 테이블은 deprecated → `memory_chunks_vec`로 대체
- `MemoryStoreLike` 인터페이스 변경 없음 (내부 구현만 변경)

## Metrics

| Before | After (예상) |
|--------|-------------|
| 문서 1개 = 벡터 1개 | 문서 1개 = 청크 N개 벡터 |
| 합집합 병합 (순위 무시) | RRF 점수 기반 순위 |
| 시간 무시 | 14일 반감기 감쇠 |
| Compaction 시 기억 소실 | 자동 flush로 보존 |
