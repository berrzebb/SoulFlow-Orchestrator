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

## 메모리 압축 (Consolidation)

장기 세션에서 오래된 대화 내용을 자동으로 압축하여 중요 정보만 장기 기억에 보존합니다.

압축 시 에이전트가:
1. 최근 N개 메시지를 분석
2. 중요 패턴, 결정사항, 사용자 선호를 추출
3. `memory_update`로 장기 기억을 갱신
4. `history_entry`로 일별 기록에 요약 추가

## 민감정보 처리

메모리 저장 전 자동으로 민감정보를 마스킹합니다. 실제 토큰/패스워드는 메모리에 기록되지 않습니다.

→ API 키, 토큰은 [보안 Vault](./security.md)에 별도 저장

## 관련 문서

→ [보안 Vault](./security.md)
→ [메모리 커맨드 레퍼런스](../guide/slash-commands.md)
