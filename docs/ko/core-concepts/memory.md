# 메모리 시스템

SoulFlow 에이전트는 세션이 끝나도 기억을 유지합니다. 모든 메모리는 SQLite(`memory/memory.db`)에 저장됩니다.

## 메모리 종류

| 종류 | 저장 경로 | 용도 | 수명 |
|------|----------|------|------|
| 장기 기억 | `sqlite://memory/longterm` | 검증된 패턴, 사용자 선호, 결정사항 | 영구 |
| 일별 기억 | `sqlite://memory/daily/YYYY-MM-DD` | 오늘의 작업 기록, 진행 중인 컨텍스트 | 일 단위 |

## 에이전트에서의 사용

에이전트는 `memory` 도구를 통해 메모리에 접근합니다.

```
action=read_longterm       → 장기 기억 전체 읽기
action=write_longterm      → 장기 기억 덮어쓰기
action=read_daily          → 오늘(또는 지정일) 기억 읽기
action=append_daily        → 오늘 기억에 내용 추가
action=list_daily          → 날짜별 기억 목록 조회
action=search              → 키워드로 과거 기억 검색
```

### 기억 기록 흐름

```
새로운 사실 발견
  → append_daily로 일별 기억에 기록    ← 즉시 저장
  → 반복 확인을 통해 안정성 검증
  → write_longterm으로 장기 기억에 반영 ← 검증 후 승격
```

## 슬래시 커맨드로 조회

```
/memory status                 → 메모리 상태 요약
/memory list                   → 날짜별 기억 목록
/memory today                  → 오늘 기억 내용
/memory longterm               → 장기 기억 전체
/memory search <검색어>        → 키워드 검색
```

## 하이브리드 검색

메모리 시스템은 여러 검색 전략을 결합한 하이브리드 검색을 지원합니다:

| 전략 | 기술 | 강점 |
|------|------|------|
| **키워드 (FTS5/BM25)** | SQLite FTS5 전문 검색 인덱스 + BM25 랭킹 | 정확한 용어 매칭, 빠름 |
| **시맨틱 (sqlite-vec)** | 네이티브 KNN 벡터 검색 | 의미 기반 유사도 |

임베딩 모델이 사용 가능하면(Ollama 또는 외부) 메모리 항목이 자동으로 청킹 및 벡터화됩니다. 검색 결과는 **Reciprocal Rank Fusion (RRF)**으로 병합하고, 시간 감쇠와 **MMR (Maximal Marginal Relevance)** 리랭킹으로 관련성과 다양성의 균형을 맞춥니다.

임베딩 모델이 없으면 FTS5 키워드 매칭으로만 검색합니다.

### 토크나이저 인프라

하이브리드 검색 파이프라인은 일관된 쿼리 처리를 위해 공유 토크나이저 레이어를 사용합니다:

| 컴포넌트 | 역할 |
|----------|------|
| **TokenizerPolicy** | 플러그인 방식의 다국어 토크나이저 전략 — 언어별 규칙을 런타임에 선택 |
| **QueryNormalizer** | FTS5/BM25 인덱싱 전 쿼리 정규화 (소문자 변환, 구두점 제거, CJK 분절) |
| **LexicalProfile** | 콘텐츠 유형별 BM25 파라미터 조정 (장문 기억 vs. 짧은 스니펫) |
| **LanguageRuleLike** | 언어별 규칙이 구현하는 계약 (한국어/CJK 단어 분리, 라틴어 불용어 제거) |

토크나이저 정책은 **쓰기 시점**(메모리 저장)과 **읽기 시점**(검색) 모두에 일관되게 적용되어, FTS5 인덱스 토큰과 쿼리 토큰이 정확히 일치합니다.

### 세션 노벨티 게이트

이미 조회한 콘텐츠가 반복 노출되지 않도록 검색 파이프라인에 세션 노벨티 게이트가 포함됩니다:

- 현재 세션에서 조회한 문서 ID를 추적
- 이후 검색에서 이미 반환된 결과를 필터링
- 에이전트가 반복 정보 대신 새로운 컨텍스트를 받도록 보장

## 메모리 압축 (Consolidation)

장기 세션에서 오래된 대화 내용을 자동으로 압축하여 중요 정보만 장기 기억에 보존합니다.

압축 시 에이전트가:
1. 최근 N개 메시지를 분석
2. 중요 패턴, 결정사항, 사용자 선호를 추출
3. `memory_update`로 장기 기억을 갱신
4. `history_entry`로 일별 기록에 요약 추가

### 설정

대시보드 → **Settings** → `memory.consolidation`에서 설정합니다:

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `enabled` | `true` | 자동 압축 활성화/비활성화 |
| `trigger` | `idle` | 트리거 모드: `idle` (세션 비활성 후) 또는 `cron` (주기적) |
| `idleAfterMs` | 1800000 | idle 트리거: 마지막 활동 후 대기 시간 (ms) |
| `intervalMs` | 86400000 | cron 트리거: 압축 주기 (ms, 기본 24시간) |
| `windowDays` | 7 | 분석 대상 daily memory 윈도우 (일) |
| `archiveUsed` | `false` | 압축 후 사용된 daily 엔트리 삭제 여부 |

### Daily Memory 자동 주입

최근 daily memory를 시스템 프롬프트에 자동 주입할 수 있습니다:

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `dailyInjectionDays` | `3` | 주입할 최근 일수 (0 = 비활성) |
| `dailyInjectionMaxChars` | `4000` | 최대 주입 글자 수 |

## 민감정보 처리

메모리 저장 전 자동으로 민감정보를 마스킹합니다. 실제 토큰/패스워드는 메모리에 기록되지 않습니다.

→ API 키, 토큰은 [보안 Vault](./security.md)에 별도 저장

## 관련 문서

→ [보안 Vault](./security.md)
→ [메모리 커맨드 레퍼런스](../guide/slash-commands.md)
