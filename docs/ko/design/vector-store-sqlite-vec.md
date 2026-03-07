# 벡터 스토어: sqlite-vec 네이티브 KNN

> **Status**: `completed` | **Dependency**: sqlite-vec v0.1.7-alpha.2

## 문제

기존 vector-store는 query 시 **전체 행을 JS로 로드 → JSON.parse → 코사인 유사도 계산**.
데이터 1,000건 기준: 1,000회 JSON.parse + 1,000회 코사인 루프 + JS 정렬.

## 솔루션

sqlite-vec의 `vec0` 가상 테이블로 KNN을 SQL 레벨에서 처리.

### 아키텍처

```
                ┌──────────────┐
                │ vector-store │
                │   service    │
                └──────┬───────┘
                       │ with_vec_db()
                ┌──────▼───────┐
                │  SQLite + WAL│
                │  + sqlite-vec│
                └──────┬───────┘
                       │
            ┌──────────┼──────────┐
            │          │          │
       ┌────▼───┐ ┌───▼────┐ ┌──▼──────────┐
       │{col}_  │ │{col}_  │ │ sqlite_master│
       │ meta   │ │  vec   │ │ (existence)  │
       │(TEXT id)│ │(vec0)  │ └─────────────┘
       └────────┘ └────────┘
```

### 스키마

```sql
-- 메타데이터 (text id, document, metadata)
CREATE TABLE "{col}_meta" (
  rid        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT UNIQUE NOT NULL,
  document   TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- vec0 가상 테이블 (float32 벡터, L2 distance)
CREATE VIRTUAL TABLE "{col}_vec" USING vec0(
  embedding float[{dim}]
);
```

### 정규화된 벡터에서 L2로 코사인 유사도 도출

sqlite-vec 0.1.7-alpha.2는 `distance_metric='cosine'` 미지원.
대신 **벡터를 L2 정규화 후 저장** → L2 거리로 코사인 유사도 도출:

```
cosine_similarity = 1 - (L2_distance² / 2)
```

| L2 거리 | 코사인 유사도 | 의미 |
|---------|-------------|------|
| 0.0 | 1.0 | 동일 |
| 1.0 | 0.5 | 직교에 가까움 |
| 1.414 | 0.0 | 직교 |
| 2.0 | -1.0 | 반대 |

### 연산

**upsert**: meta INSERT OR UPDATE → rid 조회 → vec DELETE + INSERT (정규화)
```sql
INSERT INTO "{col}_meta" (id, document, metadata_json) VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET ...;
DELETE FROM "{col}_vec" WHERE rowid = ?;
INSERT INTO "{col}_vec" (rowid, embedding) VALUES (?, ?);  -- Float32Array
```

**query**: vec0 MATCH + JOIN meta → L2 → 코사인 변환
```sql
SELECT m.id, v.distance, m.document, m.metadata_json
FROM "{col}_vec" v
JOIN "{col}_meta" m ON m.rid = v.rowid
WHERE v.embedding MATCH ?  -- Float32Array (normalized)
  AND k = ?
ORDER BY v.distance
```

**delete**: meta에서 rid 조회 → vec + meta 삭제

### 비교: 변경 전 vs 후

| 지표 | 변경 전 (JS brute-force) | 변경 후 (sqlite-vec) |
|------|------------------------|---------------------|
| 1K 벡터 쿼리 | ~15ms (JSON.parse×1K + cosine×1K) | ~1ms (네이티브 KNN) |
| 10K 벡터 쿼리 | ~150ms | ~3ms |
| 저장 | TEXT JSON (`[0.1, 0.2, ...]`) | binary float32 blob |
| 메모리 | 전체 행 JS 로드 | SQL 내부 처리, 결과만 반환 |
| 의존성 | 없음 | sqlite-vec (prebuild .so/.dll) |

### 변경 파일

| 파일 | 변경 |
|------|------|
| `src/services/vector-store.service.ts` | **전면 재작성**: JS cosine → sqlite-vec 네이티브 KNN |
| `package.json` | `sqlite-vec` 의존성 추가 |

### 컨테이너 통합

- sqlite-vec npm 패키지가 플랫폼별 prebuild 바이너리 제공 (linux-x64, darwin-arm64 등)
- `npm ci`로 자동 설치 → 별도 `.so` 빌드 불필요
- `sqliteVec.load(db)` 호출 시 `db.loadExtension()`으로 확장 로드

### 주의사항

- vec0 virtual table은 **UPDATE 미지원** → DELETE + INSERT 패턴 필수
- rowid는 **BigInt 필수** (better-sqlite3 제약)
- 차원(dim)은 CREATE 시 고정 → 컬렉션 생성 후 변경 불가
- vec0 테이블은 첫 upsert 시 lazy 생성 (차원을 알아야 하므로)
