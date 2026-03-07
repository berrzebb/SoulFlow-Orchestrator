# Memory Search Upgrade: Chunking + Scored Hybrid + Temporal Decay

> **Status**: `implemented` | **Dependencies**: sqlite-vec, FTS5, embed service
> **Reference**: OpenClaw memory system, memsearch (zilliztech)

## Problem

Three bottlenecks in current memory search:

1. **Document-level embeddings** — As longterm memory grows, vectors average out and search precision degrades
2. **Naive union merge** — FTS5 + vector results merged without scores, yielding poor ranking quality
3. **No time awareness** — A 3-week-old record and yesterday's record carry the same weight

## Solution: 4-Phase Improvement

### Phase 1: Heading-Based Chunking

Split documents by heading to ensure each chunk represents a single topic.

```
## User Preferences
prefers dark mode, Korean responses...

## Project Structure
src/agent/ — agent runtime...
```

The above longterm document splits into 2 chunks:
- chunk[0]: "User Preferences\nprefers dark mode, Korean responses..."
- chunk[1]: "Project Structure\nsrc/agent/ — agent runtime..."

#### Chunking Algorithm

```
1. Split by markdown headings (# through ######)
2. Re-split sections exceeding MAX_CHUNK_SIZE (1500 chars) at paragraph (\n\n) boundaries
3. Overlap: 2 lines (context continuity)
4. Assign SHA-256 hash per chunk: hash(source:startLine:endLine:contentHash)
5. Skip re-embedding for hash-unchanged chunks
```

#### Schema Change

```sql
-- Existing memory_documents retained as source of truth
-- New table: chunk index
CREATE TABLE memory_chunks (
  chunk_id    TEXT PRIMARY KEY,   -- SHA-256 composite hash
  doc_key     TEXT NOT NULL,      -- memory_documents.doc_key FK
  heading     TEXT NOT NULL DEFAULT '',
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  content     TEXT NOT NULL,
  content_hash TEXT NOT NULL
);

-- FTS5 rebuilt at chunk level
CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
  content,
  content='memory_chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- vec0 at chunk level
CREATE VIRTUAL TABLE memory_chunks_vec USING vec0(
  embedding float[256]
);
```

### Phase 2: Scored Hybrid Fusion (RRF)

Merge FTS5 BM25 + vector KNN results using **Reciprocal Rank Fusion**.

```
RRF_score(chunk) = sum_over_rankers( 1 / (k + rank_i) )
```

- `k = 60` (memsearch default; prevents over-influence of low ranks)
- Each ranker (FTS5, vector) retrieves `top_k × 3` candidates
- Sum RRF scores from both rankers for final ranking

#### Why RRF over Weighted Fusion

| Method | Pros | Cons |
|--------|------|------|
| Weighted (0.7v + 0.3t) | Intuitive | BM25 and vector scores have different scales; normalization needed |
| **RRF** | Scale-independent (rank-based), no tuning needed | Only 1 param (k) |

RRF merges by rank alone — no score normalization needed, making it simple and stable.

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

Apply time decay to search results, prioritizing recent memories.

```
decayed_score = rrf_score * e^(-lambda * age_days)
lambda = ln(2) / half_life_days
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| half_life | 14 days | Daily records decay 50% after 2 weeks |
| longterm exempt | true | Long-term memory has no decay (evergreen) |

Decay curve:
- Today: 100%
- 7 days: ~71%
- 14 days: 50%
- 30 days: ~23%
- 60 days: ~5%

### Phase 4: Compaction Flush

Automatically insert a memory-save turn before context compression.

#### Trigger Condition

When token usage in the agent loop reaches a threshold:
```
current_tokens >= context_window - reserve_floor - soft_threshold
```

Defaults (for 200K context):
- `reserve_floor`: 20,000 tokens
- `soft_threshold`: 4,000 tokens
- Trigger: ~176,000 tokens

#### Mechanism

1. Agent loop detects token threshold
2. Insert silent memory flush turn before user message processing
3. System: "Session nearing compaction. Store durable memories now."
4. Agent calls `memory(action="append_daily", ...)`
5. If response is NO_REPLY, skip; otherwise save memory then continue original conversation
6. Max 1 flush per compaction cycle

## Implementation Plan

### Phase 1: Chunking (memory.service.ts)

| Change | File |
|--------|------|
| `chunk_markdown()` function | `src/agent/memory-chunker.ts` (new) |
| `memory_chunks` + `_fts` + `_vec` tables | `memory.service.ts` — `ensure_initialized()` |
| Auto re-chunk on document write | `sqlite_upsert_document()`, `sqlite_append_document()` |
| Switch `search()` target to chunks | `memory.service.ts` — `search()` |

### Phase 2: RRF Fusion (memory.service.ts)

| Change | File |
|--------|------|
| `rrf_merge()` utility | `src/agent/memory-scoring.ts` (new) |
| Apply RRF in `search()` | `memory.service.ts` |

### Phase 3: Temporal Decay (memory.service.ts)

| Change | File |
|--------|------|
| `temporal_decay()` | `src/agent/memory-scoring.ts` |
| `created_at` timestamp on chunks | `memory_chunks` schema |

### Phase 4: Compaction Flush (loop.service.ts)

| Change | File |
|--------|------|
| Token count threshold detection | `src/agent/loop.service.ts` |
| Flush turn insertion logic | `src/agent/loop.service.ts` |

## Migration

- Existing `memory_documents` table preserved as source of truth
- `memory_chunks` + `_fts` + `_vec` are derived indexes (rebuildable)
- Lazy re-chunking + re-embedding on first search
- Existing `memory_vec` table deprecated → replaced by `memory_chunks_vec`
- `MemoryStoreLike` interface unchanged (internal implementation only)

## Metrics

| Before | After (expected) |
|--------|-----------------|
| 1 document = 1 vector | 1 document = N chunk vectors |
| Union merge (rank ignored) | RRF score-based ranking |
| No time awareness | 14-day half-life decay |
| Memory loss on compaction | Auto flush for preservation |
