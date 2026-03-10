# 코드 품질 개선 체크리스트

> 5대 원칙(YAGNI, DRY, SOLID, KISS, LoD) 기반 리팩토링 추적 문서.
> 이터레이션마다 이 파일을 먼저 읽고, 처리 후 상태를 업데이트합니다.
> 마지막 업데이트: 2026-03-10 (이터레이션 2)

---

## ✅ 완료

| # | 원칙 | 파일 | 내용 | 커밋 |
|---|------|------|------|------|
| 1 | DRY+perf | `src/orchestration/classifier.ts` | identity 분류기 Jaccard 유사도 기반 교체 | `c6455a8` |
| 2 | DRY+perf | `src/orchestration/classifier.ts` | inquiry 키워드→Jaccard, complexity 구현 | `947325d` |
| 3 | perf | `src/orchestration/classifier.ts` | 레퍼런스 토큰 집합 사전 계산 + 연결어 오매칭 수정 | `4d62a55` |
| 4 | perf | `src/channels/command-intent.ts` | 인라인 regex 18개 → 모듈 레벨 상수 | `8eeb42e` |
| 5 | DRY | `src/utils/html-strip.ts` (신규) | HTML→마크다운 변환 공통 유틸 추출 | `b11f581` |
| 6 | KISS+SRP | `src/utils/string-match.ts` (신규) | levenshtein → CommandRouter에서 분리 | `8d9aa21` |
| 7 | perf+DRY | `src/channels/commands/cron.handler.ts` | regex 10개 + Set 2개 모듈 레벨 추출 | `6d8d1ad` |
| 8 | 일관성 | 핸들러 6개 | args_lower[0] 통일 | `e20efb0` |

---

## 🔴 우선순위 높음

### ~~P1-A: `levenshtein` 함수 유틸로 추출~~ ✅ 완료 (`8d9aa21`)

### ~~P1-B: 핸들러 액션 파싱 중복 패턴~~ → **SKIP (YAGNI)**
- 각 핸들러의 액션은 다른 인자를 받으며 4~5개 분기 — 추상화 시 오히려 복잡해짐
- 현재 `if-else` 체인이 KISS에 부합

---

## 🟡 우선순위 중간

### ~~P2-A: `CommandRouter` SRP 위반~~ → **SKIP**
- 62줄, private 메서드 2개. 퍼지 매칭은 라우팅의 일부로 볼 수 있음. 분리 대비 효과 미미.

### ~~P2-B: `CronHandler` SRP 위반~~ → **SKIP + perf 수정 완료** (`6d8d1ad`)
- SRP 분리 불필요 (파싱 함수가 이미 클래스 외부 분리됨)
- **대신 수정**: 인라인 regex 8개 + Set 2개 모듈 레벨로 추출 완료

### ~~P2-C: 메타데이터 접근 헬퍼~~ → **SKIP (YAGNI)**
- 파일당 2회 사용. `|| {}` 패턴은 명확하고 간단. 헬퍼 추출 시 오히려 인다이렉션만 추가.

### ~~P2-D: `phase-workflow.ts` 중복~~ → **SKIP**
- 실제 확인 결과: `pending_user_input` 조회 1곳, 순회 목적이 달라 DRY 아님.

---

## 🟢 우선순위 낮음

### ~~P3-A: 분류기 임계값 상수화~~ ✅ 완료 (`0794a02`)
- IDENTITY_THRESHOLD=0.4, INQUIRY_THRESHOLD=0.3 명명 상수 복원

### ~~P3-B: `args_lower` 불일치~~ ✅ 완료 (`e20efb0`)
- 6개 핸들러 args_lower[0] 통일

### ~~P3-C: cron 나머지 regex~~ ✅ 완료 (`e20efb0`)
- RE_CRON_ADD_QUERY, RE_CRON_REMOVE_QUERY 추출

### P3-C: `INTENT_PATTERNS` 정규식 precompile (perf)
- **파일**: `src/orchestration/intent-patterns.ts`
- **문제**: RegExp 객체가 객체 리터럴 내부에 선언 (이미 모듈 레벨이므로 1회 컴파일됨)
- **결론**: 현재 상태 이미 적절 — **skip**
- **작업**: [x] skip (이미 모듈 레벨)

---

## 조사 완료 → 모두 SKIP

| 항목 | 파일 | 결론 |
|------|------|------|
| `persona-message-renderer.ts` 오버라이드 레이어 | L174-194 | 의도적 3단계 스타일 병합 설계 |
| `StyleOverrideOptions` normalize 함수 | L416-423 | 의도적 union API — 호출자 편의 |
| `NON_RETRYABLE_ERRORS` 중앙화 | L35-38 | 파일 내 2회만 사용 — 이미 최적 위치 |

---

## 최종 요약

**완료**: 9개 항목 (classifier 4 + command-intent 1 + html-strip 1 + string-match 1 + cron 1 + args_lower 1)
**SKIP (YAGNI/의도적 설계)**: 8개 항목
**신규 유틸 생성**: `src/utils/html-strip.ts`, `src/utils/string-match.ts`
