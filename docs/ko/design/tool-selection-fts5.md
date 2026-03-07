# 도구 선택 최적화: SQLite FTS5

> **Status**: `in-progress` | **Type**: 성능 최적화

## 문제

165개 도구의 전체 스키마를 매 요청마다 전송하면 ~25,000 토큰 소비. 현재 in-memory 키워드 카운팅 인덱스로 ~80% 절감했으나, 랭킹 품질에 한계가 있음.

### 현재 방식의 한계 (키워드 카운팅)

| 문제 | 예시 |
|------|------|
| 빈도 편향 | description에 "file"이 5번 나오는 도구가 정확히 "read_file"인 도구보다 높은 점수 |
| 문서 길이 무시 | 짧은 description의 도구가 불리 (매칭 키워드가 적을 수밖에 없음) |
| 역문서 빈도 부재 | "execute"같은 흔한 단어와 "crontab"같은 희귀 단어가 동일 가중치 |
| 비영속 | 프로세스 재시작 시 매번 인메모리 인덱스 재구축 |

## 솔루션: SQLite FTS5 + BM25

### 아키텍처

```
                    ┌─────────────┐
                    │ ToolRegistry│
                    │  (165 tools)│
                    └──────┬──────┘
                           │ build()
                    ┌──────▼──────┐
                    │  ToolIndex  │
                    │ (singleton) │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  SQLite DB  │
                    │  FTS5 + WAL │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼───┐  ┌────▼───┐  ┌────▼───┐
         │ tools  │  │fts_cont│  │tools_fts│
         │(master)│  │(content)│  │ (FTS5) │
         └────────┘  └────────┘  └─────────┘
```

### DB 스키마

```sql
-- 마스터 테이블: 메타데이터
CREATE TABLE tools (
  name     TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  core     INTEGER NOT NULL DEFAULT 0,
  desc_raw TEXT NOT NULL DEFAULT ''
);

-- FTS5 content 백킹 테이블
CREATE TABLE tools_fts_content (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT ''
);

-- FTS5 가상 테이블 (BM25 랭킹 자동 지원)
CREATE VIRTUAL TABLE tools_fts USING fts5(
  name, description, tags,
  content='tools_fts_content',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
```

### BM25 컬럼 가중치

```sql
SELECT name, bm25(tools_fts, 5.0, 2.0, 1.0) AS rank
FROM tools_fts
WHERE tools_fts MATCH ?
ORDER BY rank
```

| 컬럼 | 가중치 | 근거 |
|------|--------|------|
| `name` | 5.0 | 도구 이름 직접 매칭이 가장 강력한 신호 |
| `description` | 2.0 | 설명 내 키워드 매칭 |
| `tags` | 1.0 | action enum, 카테고리 등 보조 태그 |

### 쿼리 파이프라인

```
사용자 요청 (한/영 혼합)
    │
    ▼
[1] 한국어 키워드 확장 (KO_KEYWORD_MAP)
    "파일 검색" → + "file filesystem read_file write_file search web_search grep find"
    │
    ▼
[2] 영어 토큰화 + 불용어 제거
    │
    ▼
[3] FTS5 MATCH 쿼리 생성
    "file" OR "filesystem" OR "read_file" OR "search" OR "grep" OR "find"
    │
    ▼
[4] BM25 랭킹 (SQLite 내부)
    │
    ▼
[5] Core 도구 (13개) + BM25 상위 N개 + 카테고리 폴백
    │
    ▼
  선택된 도구 (20~35개)
```

### 선택 규칙

1. **Core 도구** (13개) — 항상 포함: message, ask_user, request_file, send_file, read_file, write_file, edit_file, list_dir, search_files, exec, memory, datetime, chain
2. **분류기 지정 도구** — classifier가 명시적으로 요청한 도구
3. **FTS5 BM25 상위** — 요청 텍스트 매칭, once=25개, agent/task=35개
4. **카테고리 폴백** — 매칭 도구 < 15개이면 분류기 카테고리로 보강

### 자동 갱신 메커니즘

```
ToolRegistry.register(tool)
    │
    ▼
OrchestrationService.execute()
    │ rebuild_tool_index(schemas, category_map, db_path)
    ▼
ToolIndex.build()
    │ DELETE + INSERT (transactional)
    ▼
  FTS5 인덱스 자동 갱신
```

- `rebuild_tool_index()`는 매 요청 디스패치 시 호출 (변경 감지 최적화 가능)
- 도구 추가/제거 시 다음 요청에서 자동 반영
- WAL 모드로 읽기/쓰기 동시성 보장

## 비교: 변경 전 vs 후

| 지표 | 키워드 카운팅 | FTS5 BM25 |
|------|-------------|-----------|
| 랭킹 품질 | 단순 매칭 횟수 | TF-IDF 기반 BM25 (문서 길이 정규화, 역문서 빈도) |
| 부분 매칭 | 불가 | FTS5 토크나이저 지원 |
| 저장 | 인메모리 (프로세스 재시작 시 소멸) | 디스크 영속 (WAL) |
| 빌드 시간 | ~2ms (Map 순회) | ~5ms (SQLite INSERT + FTS 인덱싱) |
| 쿼리 시간 | ~0.5ms (Map 룩업) | ~1ms (FTS5 MATCH + BM25) |
| 토큰 절감 | ~80% | ~80% (동일, 선택 도구 수 동일) |
| 의존성 | 없음 | better-sqlite3 (기존 의존성) |

> 165개 도구 규모에서 성능 차이는 체감 불가. **BM25 랭킹 품질 향상**이 핵심 가치.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/orchestration/tool-index.ts` | **전면 재작성**: in-memory → SQLite FTS5 |
| `src/orchestration/tool-selector.ts` | `rebuild_tool_index()` 시그니처에 `db_path` 추가 |
| `src/orchestration/service.ts` | `rebuild_tool_index()` 호출 시 `db_path` 전달 |

## DB 위치

```
{workspace}/runtime/tools/tool-index.db
```

프로젝트 컨벤션에 따라 `{data_dir}/` 하위에 배치. 다른 SQLite DB들과 동일한 패턴:
- `{data_dir}/config/config.db`
- `{data_dir}/events/events.db`
- `{data_dir}/sessions/sessions.db`
- `{data_dir}/cron/cron.db`

## 향후: 벡터 확장

현재는 FTS5 BM25만 사용. 향후 sqlite-vec 확장을 추가하여 의미론적 유사도 검색을 보강할 수 있음:

1. Ollama 임베딩 모델로 도구 description 벡터화
2. `vec_f32` 컬럼에 저장
3. 쿼리 시 FTS5 BM25 + cosine similarity 하이브리드 랭킹

이는 도구가 500개 이상으로 증가하거나, "비슷한 기능의 도구"를 구분해야 할 때 의미가 있음. 현재 165개 규모에서는 FTS5만으로 충분.
