# Hybrid Search: FTS5 + sqlite-vec

> **Status**: `completed` | **Dependencies**: sqlite-vec v0.1.7-alpha.2, OpenRouter Embeddings API

## Problem

FTS5 BM25 키워드 매칭만으로는 시멘틱 유사성을 포착하지 못함.
- "파일 내용 바꿔줘" → `edit_file` 도구를 찾지 못함 (키워드 불일치)
- "어제 뭐 했는지 알려줘" → 메모리에서 관련 일지를 찾지 못함

## Solution

FTS5 BM25 (키워드) + sqlite-vec KNN (시멘틱)을 결합한 하이브리드 검색.

### Architecture

```
Query Text
    |
    +---> FTS5 BM25 (keyword match, fast)
    |         |
    |         v
    |     ranked results (priority)
    |
    +---> sqlite-vec KNN (semantic match, lazy embed)
              |
              v
          supplementary results
              |
    +---------+
    v
  Merged Set (FTS5 first, vector fills remaining slots)
```

### Embedding Strategy: Lazy + Content-Hash

임베딩은 비용이 높은 외부 API 호출 → **검색 시점에 lazy하게 수행**.

1. **쓰기 시**: `content_hash` (FNV-1a 32bit)만 저장. 임베딩 API 호출 없음.
2. **검색 시**: `vec0` 테이블에 없는 행 검출 → 배치 임베딩 → 저장.
3. **변경 감지**: `content_hash` 불일치 시 재임베딩.

| 동작 | 빈도 | API 호출 |
|------|------|----------|
| 도구 등록 (build) | 서버 시작 시 1회 | 없음 |
| 메모리 쓰기 | 매 대화 | 없음 |
| 도구 검색 (select) | 매 요청 | 첫 호출 시 1회 (이후 캐시) |
| 메모리 검색 | /memory search | stale 문서만 |

### Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Model | `text-embedding-3-small` | OpenRouter 경유, 저비용 |
| Dimensions | 256 | 도구 165개, 메모리 수백 건 → 256차원 충분 |
| Max chars | 1500 (tools), 2000 (memory) | 임베딩 입력 truncate |
| Distance | L2 on normalized vectors | `cosine_sim = 1 - (L2^2 / 2)` |

### Applied Stores

#### 1. Tool Index (`src/orchestration/tool-index.ts`)

```sql
-- 기존 FTS5 테이블에 추가
ALTER TABLE tools ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
CREATE VIRTUAL TABLE tools_vec USING vec0(embedding float[256]);
```

- `build()`: FTS5 + tools 테이블에 content_hash 저장, vec0는 비워둠
- `select()` (async): FTS5 BM25 → 벡터 KNN 보강 → 머지
- `ensure_embeddings_fresh()`: 첫 select 시 전체 도구 배치 임베딩 (165개 → API 2회)

#### 2. Memory Store (`src/agent/memory.service.ts`)

```sql
ALTER TABLE memory_docs ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
CREATE VIRTUAL TABLE memory_vec USING vec0(embedding float[256]);
```

- `search()`: FTS5 결과 + `vector_search()` 결과 머지
- `vector_search()`: stale 문서 배치 임베딩 → KNN

### Dependency Injection

```typescript
// EmbedFn 타입 (memory.service.ts에 정의)
type EmbedFn = (texts: string[], opts: { model?: string; dimensions?: number })
  => Promise<{ embeddings: number[][] }>;

// main.ts에서 주입
agent.context.memory_store.set_embed?.(embed_service);
get_tool_index().set_embed(embed_service);
```

`set_embed()`가 호출되지 않으면 벡터 검색이 비활성화되고 FTS5만 사용 (graceful degradation).

### File Changes

| File | Change |
|------|--------|
| `src/orchestration/tool-index.ts` | sqlite-vec 로드, vec0 테이블, `set_embed()`, async `select()`, `vector_search()`, `ensure_embeddings_fresh()` |
| `src/orchestration/tool-selector.ts` | `select_tools_for_request()` async 변환 |
| `src/orchestration/service.ts` | `await select_tools_for_request()` |
| `src/agent/memory.service.ts` | `EmbedFn` 타입, `set_embed()`, vec0 테이블, hybrid `search()`, `vector_search()` |
| `src/agent/memory.types.ts` | `set_embed?()` optional 메서드 추가 |
| `src/main.ts` | `set_embed()` 연결 (memory + tool-index) |
