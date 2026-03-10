# 코드 품질 개선 체크리스트

> 5대 원칙(YAGNI, DRY, SOLID, KISS, LoD) 기반 리팩토링 추적 문서.
> 이터레이션마다 이 파일을 먼저 읽고, 처리 후 상태를 업데이트합니다.
> 마지막 업데이트: 2026-03-10 (이터레이션 3)

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

---

## 이터레이션 3 신규 발견

### ✅ P1-A: `dashboard/ops/workflow.ts` — `run_phase_loop` deps 3중복 [DRY]
- **위치**: create/resume/resume_orphaned 3곳
- **해결**: `runner_deps` 상수 추출 완료

### ✅ P1-B: `channels/manager.ts` — `is_status_mode` 2중복 [DRY]
- **위치**: `invoke_and_reply` L628, `deliver_result` L769
- **해결**: `deliver_result(... is_status_mode)` 파라미터 전달로 수정 완료

### ✅ P1-C: `dashboard/ops/workflow.ts` — `PROVIDER_TYPE_TO_ID`/`VALID_PROVIDER_IDS` 함수 내부 [DRY, KISS]
- **해결**: 모듈 레벨 상수로 이동 완료

### ✅ P1-D: `agent/phase-loop-runner.ts` — "페이즈 완료" 6줄 패턴 2중복 [DRY]
- **위치**: interactive 경로(L372-378), 일반 경로(L530-535) — 동일 6줄 패턴
- **해결**: `finalize_phase(state, phase_state, phase_def, store, on_event, options)` 헬퍼 추출 완료

### ✅ P1-E: `PRIVATE_HOST_RE` SSRF 정규식 4중복 [DRY, 보안]
- **위치**: `agent/nodes/http.ts`, `agent/nodes/retriever.ts`, `agent/nodes/web-scrape.ts`, `agent/tools/http-utils.ts`
- **문제**: 동일한 보안 임계 정규식이 4곳에 복사됨. 유지보수 시 한 곳만 수정될 위험.
- **해결**: 세 노드에서 로컬 `PRIVATE_HOST_RE` 삭제 → `validate_url` (`http-utils.ts`) 임포트로 교체. `.local` 도메인 체크를 `http-utils.ts`에 통합.

### ✅ P1-F: `validate_url` 2중복 [DRY, 보안]
- **위치**: `agent/tools/web.ts` (로컬, `string|null` 반환) vs `agent/tools/http-utils.ts` (정규, `URL|string` 반환)
- **문제**: 유사하지만 반환 타입이 다른 중복 구현. `web.ts`에는 `.local` 체크 있으나 `http-utils.ts`에는 없었음.
- **해결**: `.local` 체크를 `http-utils.ts`로 통합. `web.ts`는 얇은 래퍼(`null`/`string` 변환)로 교체 → 내부적으로 정규 구현 위임.

---

## 이터레이션 4 신규 발견

### ✅ I4-A: `channels/media-collector.ts` — `PRIVATE_HOST_RE` + `is_private_url` 잔여 중복 [DRY, 보안]
- **문제**: `PRIVATE_HOST_RE` prefix 패턴이 `http-utils.ts`와 별도 관리.
- **해결**: `validate_url` 임포트 → `is_private_url` 1줄 위임 패턴으로 교체.

### ✅ I4-B: `document-docx/pdf/pptx/xlsx` 4파일 — NodeHandler 구조 거의 동일 [DRY]
- **위치**: `agent/nodes/document-*.ts` (각 51줄 = 총 204줄)
- **문제**: `DocumentTool` 호출 패턴 4중복. icon/color/action/extra_param 이름만 다름.
- **해결**: `make_document_handler(cfg)` 팩토리로 `agent/nodes/document.ts` 통합 (77줄). 4개 파일 삭제. ~127줄 제거.

### ✅ I4-C: AbortController + timer 패턴 10중복 [DRY, KISS]
- **위치**: `nodes/web-scrape.ts`, `nodes/http.ts`, `nodes/web-search.ts`, `nodes/web-table.ts`, `nodes/web-form.ts`, `tools/graphql.ts`, `tools/embedding.ts`, `tools/notification.ts`, `providers/orchestrator-llm.provider.ts`, `providers/openrouter.provider.ts`
- **문제**: `new AbortController + setTimeout + AbortSignal.any(...)` 패턴 10곳 산재. `clearTimeout` 누락 위험.
- **해결**: `make_abort_signal(timeout_ms, external?)` → `utils/common.ts` 추가. 10개 파일 단일 호출로 교체. `AbortSignal.timeout()` 기반으로 자동 정리됨.

---

## 코드베이스 전체 스캔 결과 (이터레이션 3)

### 조사 완료 → SKIP 결정

| 파일 | 항목 | 결론 |
|------|------|------|
| `agent/backends/codex-appserver.agent.ts` vs `claude-sdk.agent.ts` | SDK vs JSON-RPC 구현 차이 | 의도적 다형성 — DRY 아님 |
| `channels/telegram.channel.ts` vs `slack.channel.ts` | 채널 인터페이스 구현 | 의도적 다형성 — DRY 아님 |
| `dashboard/routes/kanban.ts` + 기타 라우트 | `if (!store) {...}` 가드 반복 | 라우트마다 다른 컨텍스트, 추출 시 오버엔지니어링 |
| `agent/phase-loop-runner.ts` | `state.updated_at = now_iso(); store.upsert(state)` 다수 반복 | 상태기계 특성상 각 전환 지점이 다름 — YAGNI |
| `agent/skills.service.ts` | inline regex 5개 (L407, L422, L427, L434, L441) | 각 1회 사용, 메서드 내부 — 추출 불필요 |
| `providers/orchestrator-llm.runtime.ts` | Docker/Podman 엔진 처리 | 의도적 분기 — DRY 아님 |
| `agent/subagents.ts` | 990줄, 복잡하나 단일 책임 | SRP 준수 확인 |
| `dashboard/service.ts` | 725줄, 28개 라우트 import | 라우트 파일 분리 완료 상태 |
| `cron/service.ts` | 828줄 | DB 스키마·스케줄 로직 분리됨, 적절 |
| `agent/tools/index.ts` | 639줄, 100+ import | 도구 레지스트리 패턴, 정상 |

---

## 최종 요약

**이터레이션 3 완료**: 6개 항목 (P1-A~F)
**이터레이션 4 완료**: 3개 항목 (I4-A~C)
**총 완료**: 20개 항목
**SKIP (YAGNI/의도적 설계)**: 18개 항목
**신규 헬퍼/유틸**: `runner_deps`, `finalize_phase`, `html-strip.ts`, `string-match.ts`, `make_document_handler`, `make_abort_signal`
**보안 개선**: `validate_url`에 `.local` mDNS 도메인 차단 추가
**코드 제거**: ~127줄 (4 document 핸들러 파일 통합)
