# 조치 계획 (Action Plan)

작성일: 2026-03-11
기준 코드베이스: 현재 저장소

## 목적

이 문서는 코드 리뷰에서 도출된 모든 이슈와 리팩토링 기회를 우선순위별 로드맵으로 정리한다.
실행 가능한 단위로 분류하여 순차적으로 진행할 수 있게 한다.

---

## 즉시 조치 (Phase 1 — 긴급)

프로덕션 배포 전에 해결해야 하는 항목이다.
예상 기간: 1–2일

| 순위 | 항목 | 문서 | 영향 | 노력 |
|------|------|------|------|------|
| 1 | C2: 이중 Promise 해결 경쟁 조건 | [01-critical-issues.md](./01-critical-issues.md#c2-이중-promise-해결-경쟁-조건) | 높음 | **낮음** |
| 2 | C1: 벡터 DB 연결 누수 | [01-critical-issues.md](./01-critical-issues.md#c1-벡터-db-연결-누수) | 높음 | 중간 |
| 3 | O3: `with_sqlite()` 에러 로깅 | [05-observability-improvements.md](./05-observability-improvements.md#o3-with_sqlite-에러-로깅) | 중간 | **낮음** |
| 4 | C3: Worker 실패 관찰 가능성 | [01-critical-issues.md](./01-critical-issues.md#c3-무음-worker-실패) | 중간 | **낮음** |
| 5 | M6: OAuth 생명주기 통합 | [02-medium-issues.md](./02-medium-issues.md#m6-oauthflowservice-생명주기-미통합) | 중간 | **낮음** |

### Phase 1 진행 규칙

- 한 PR에서 구조 이동과 기능 수정을 동시에 하지 않는다
- 각 수정 후 관련 테스트를 추가/실행한다
- C2는 가드 패턴만 적용하므로 30분 내 완료 가능하다
- C1은 try-finally 구조 검증이 필요하므로 신중하게 진행한다

---

## 단기 개선 (Phase 2 — 1주 이내)

코드 품질을 한 단계 올리는 항목이다.
예상 기간: 3–5일

| 순위 | 항목 | 문서 | 영향 | 노력 |
|------|------|------|------|------|
| 1 | C4: SQLite 초기화 strict | [01-critical-issues.md](./01-critical-issues.md#c4-sqlite-초기화-무음-실패) | 높음 | 중간 |
| 2 | P1: 레퍼런스 동기화 디바운스 | [06-performance-improvements.md](./06-performance-improvements.md#p1-레퍼런스-동기화-디바운스) | 중간 | **낮음** |
| 3 | M7: 컨텍스트 동기화 최적화 | [02-medium-issues.md](./02-medium-issues.md#m7-컨텍스트-레퍼런스-동기화-지연) | 중간 | **낮음** |
| 4 | M3: JSON 파싱 오류 로깅 | [02-medium-issues.md](./02-medium-issues.md#m3-도구-입력-json-파싱-오류-무시) | 중간 | **낮음** |
| 5 | S1: Slack 타임스탬프 범위 검증 | [04-security-improvements.md](./04-security-improvements.md#s1-slack-타임스탬프-범위-검증) | 중간 | **낮음** |
| 6 | S5: 셸 작업 디렉토리 검증 | [04-security-improvements.md](./04-security-improvements.md#s5-셸-핸들러-작업-디렉토리-검증) | 중간 | **낮음** |
| 7 | L6: Math.random → crypto | [03-minor-issues.md](./03-minor-issues.md#l6-mathrandom-id-생성) | 낮음 | **낮음** |

### Phase 2 진행 규칙

- C4는 `with_sqlite_strict()` 도입이므로 O3과 함께 진행한다
- P1과 M7은 같은 파일(`context.service.ts`)이므로 하나의 PR로 묶는다
- 보안 항목(S1, S5)은 별도 PR로 분리한다

---

## 중기 리팩토링 (Phase 3 — 2주 이내)

구조적 개선을 위한 리팩토링이다.
예상 기간: 1–2주

| 순위 | 항목 | 문서 | 영향 | 노력 |
|------|------|------|------|------|
| 1 | R1: 채널 HTTP 유틸리티 추출 | [07-refactoring-high-impact.md](./07-refactoring-high-impact.md#r1-채널-http-유틸리티-추출) | 높음 | 중간 |
| 2 | R2+R3: 노드 핸들러 헬퍼 | [07-refactoring-high-impact.md](./07-refactoring-high-impact.md#r2-노드-핸들러-캐스팅-헬퍼) | 높음 | 중간 |
| 3 | R4: DashboardService 분할 | [07-refactoring-high-impact.md](./07-refactoring-high-impact.md#r4-dashboardservice-분할) | 중간 | 중간 |
| 4 | O1: 빈 catch 블록 정리 | [05-observability-improvements.md](./05-observability-improvements.md#o1-빈-catch-블록-로깅-추가) | 높음 | 높음 |
| 5 | S2: 파일 경로 검증 통합 | [04-security-improvements.md](./04-security-improvements.md#s2-채널별-파일-경로-검증-통합) | 중간 | 중간 |
| 6 | S3: Telegram HTML 이스케이프 | [04-security-improvements.md](./04-security-improvements.md#s3-telegram-html-콘텐츠-이스케이프) | 중간 | **낮음** |

### Phase 3 진행 규칙

- R1은 BaseChannel 수정이므로 3개 채널 테스트를 모두 실행한다
- R2+R3는 `_helpers.ts` 파일 하나에서 시작하고, 핸들러는 점진적으로 교체한다
- R4는 3단계(RouteRegistry → ChatSessionStore → facade 축소)로 나누어 진행한다
- O1은 디렉토리 단위로 커밋을 나눈다

---

## 장기 계획 (Phase 4 — 1개월 이내)

점진적으로 진행하는 구조적 개선이다.
예상 기간: 2–4주

| 순위 | 항목 | 문서 | 영향 | 노력 |
|------|------|------|------|------|
| 1 | R5: 채널별 메시지 타입 | [08-refactoring-medium-low.md](./08-refactoring-medium-low.md#r5-채널별-메시지-타입-정의) | 중간 | 높음 |
| 2 | M1: Record 과다 사용 정리 | [02-medium-issues.md](./02-medium-issues.md#m1-recordstring-unknown-과다-사용) | 중간 | 높음 |
| 3 | R7: 타임아웃 상수 중앙화 | [08-refactoring-medium-low.md](./08-refactoring-medium-low.md#r7-타임아웃-상수-중앙화) | 낮음 | **낮음** |
| 4 | R6: 에러 엔벨로프 표준화 | [08-refactoring-medium-low.md](./08-refactoring-medium-low.md#r6-에러-응답-엔벨로프-표준화) | 중간 | 중간 |
| 5 | R9: 스킬 시스템 타입 | [08-refactoring-medium-low.md](./08-refactoring-medium-low.md#r9-스킬-시스템-typescript-인터페이스-도입) | 중간 | 중간 |
| 6 | R10: 분류기 로케일 | [08-refactoring-medium-low.md](./08-refactoring-medium-low.md#r10-분류기-한국어-의존성-설정-가능화) | 낮음 | 중간 |
| 7 | R11: 재시작 메커니즘 | [08-refactoring-medium-low.md](./08-refactoring-medium-low.md#r11-progress_relay-재시작-메커니즘) | 낮음 | **낮음** |
| 8 | O5: 모듈별 로그 레벨 | [05-observability-improvements.md](./05-observability-improvements.md#o5-모듈별-로그-레벨-오버라이드) | 중간 | 중간 |
| 9 | P2: 임베딩 워밍업 | [06-performance-improvements.md](./06-performance-improvements.md#p2-도구-임베딩-워밍업) | 중간 | 중간 |
| 10 | P3: 메일박스 크기 제한 | [06-performance-improvements.md](./06-performance-improvements.md#p3-루프-서비스-메일박스-크기-제한) | 중간 | 중간 |

### Phase 4 진행 규칙

- R5와 M1은 동일 작업이므로 하나로 묶는다
- 각 항목은 독립적이므로 우선순위에 따라 선택적으로 진행 가능하다
- 기능 릴리스와 충돌하지 않도록 리팩토링 전용 브랜치에서 작업한다

---

## 보류/평가 필요 (Deferred)

현재 시점에서 조치가 불필요하거나 추가 평가가 필요한 항목이다.

| 항목 | 문서 | 이유 |
|------|------|------|
| L4: DESC 인덱스 효율 | [03-minor-issues.md](./03-minor-issues.md#l4-sqlite-desc-인덱스-효율성) | SQLite 버전 확인 선행 필요 |
| L5: DLQ 콘텐츠 절삭 | [03-minor-issues.md](./03-minor-issues.md#l5-dlq-콘텐츠-4000자-절삭) | 실제 디버깅 시 문제 여부 확인 필요 |
| O4: 분류기 프로파일링 | [05-observability-improvements.md](./05-observability-improvements.md#o4-분류기-에스컬레이션-비율-프로파일링) | 프로덕션 트래픽 확보 후 의미 있음 |
| S4: 경로 절대 검증 | [04-security-improvements.md](./04-security-improvements.md#s4-설정-경로-절대-경로-검증) | 배포 환경 확인 후 결정 |
| S6: HTTP 타임아웃 설정 | [04-security-improvements.md](./04-security-improvements.md#s6-http-요청-타임아웃-설정-가능화) | 현재 고정값으로 충분한지 확인 필요 |
| P4: 크론 조기 감지 | [06-performance-improvements.md](./06-performance-improvements.md#p4-크론-스케줄러-불가능-표현식-조기-감지) | 실제 사용 빈도 확인 필요 |
| P5: 정리 백오프 | [06-performance-improvements.md](./06-performance-improvements.md#p5-세션-정리-실패-시-백오프) | 실패 빈도 확인 필요 |
| M2: 빈 catch 분류 | [02-medium-issues.md](./02-medium-issues.md#m2-빈-catch-블록-467건) | O1과 통합 진행 |
| M4: Slack 타임스탬프 | [02-medium-issues.md](./02-medium-issues.md#m4-slack-타임스탬프-검증-미비) | S1과 통합 진행 |
| M5: Telegram HTML | [02-medium-issues.md](./02-medium-issues.md#m5-telegram-html-파싱-모드-미이스케이프) | S3과 통합 진행 |
| L1: 쓰기 큐 에러 | [03-minor-issues.md](./03-minor-issues.md#l1-쓰기-큐-에러-삼킴) | 실제 장애 사례 확인 후 진행 |
| L2: 크론 불가능 일정 | [03-minor-issues.md](./03-minor-issues.md#l2-크론-표현식-불가능한-일정-미검증) | P4와 통합 진행 |
| L3: 메모리 통합 중복 | [03-minor-issues.md](./03-minor-issues.md#l3-메모리-통합-시-중복-제거-미수행) | 장기 운영 데이터 필요 |

---

## 전체 이슈 요약

### 심각도별 분포

| 심각도 | 건수 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | 보류 |
|--------|------|---------|---------|---------|---------|------|
| 🔴 Critical | 4 | 3 | 1 | — | — | — |
| 🟡 Medium | 7 | 1 | 3 | — | — | 3 |
| 🟢 Minor | 6 | — | 1 | — | — | 5 |
| 보안 | 6 | — | 2 | 2 | — | 2 |
| 관찰 | 5 | 2 | — | 1 | 1 | 1 |
| 성능 | 5 | — | 1 | — | 2 | 2 |
| 리팩토링 | 11 | — | — | 3 | 7 | 1 |
| **합계** | **44** | **6** | **8** | **6** | **10** | **14** |

### 예상 등급 변화

| Phase | 완료 후 예상 등급 | 주요 개선 |
|-------|-------------------|----------|
| 현재 | 8.0/10 (B+) | — |
| Phase 1 완료 | 8.3/10 (B+) | 심각 이슈 해소 |
| Phase 2 완료 | 8.5/10 (A-) | 에러 처리 + 보안 강화 |
| Phase 3 완료 | 8.8/10 (A-) | 구조적 중복 제거 |
| Phase 4 완료 | 9.0/10 (A) | 전면적 타입 안전성 + 관찰 가능성 |

---

## 진행 추적

이 문서는 각 Phase 완료 시 업데이트한다.

| Phase | 상태 | 시작일 | 완료일 |
|-------|------|--------|--------|
| Phase 1 | 미착수 | — | — |
| Phase 2 | 미착수 | — | — |
| Phase 3 | 미착수 | — | — |
| Phase 4 | 미착수 | — | — |
