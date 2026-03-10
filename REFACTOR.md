# 코드 품질 개선 체크리스트

> 5대 원칙(YAGNI, DRY, SOLID, KISS, LoD) 기반 리팩토링 추적 문서.
> 이터레이션마다 이 파일을 먼저 읽고, 처리 후 상태를 업데이트합니다.
> 마지막 업데이트: 2026-03-10 (이터레이션 5)

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
| `dashboard/routes/kanban.ts` + 기타 라우트 | `if (!store) {...}` 가드 반복 | ~~라우트마다 다른 컨텍스트, 추출 시 오버엔지니어링~~ → **재평가: 완전 동일 코드 32회** → I8-A 처리 |
| `agent/phase-loop-runner.ts` | `state.updated_at = now_iso(); store.upsert(state)` 다수 반복 | 상태기계 특성상 각 전환 지점이 다름 — YAGNI |
| `agent/skills.service.ts` | inline regex 5개 (L407, L422, L427, L434, L441) | 각 1회 사용, 메서드 내부 — 추출 불필요 |
| `providers/orchestrator-llm.runtime.ts` | Docker/Podman 엔진 처리 | 의도적 분기 — DRY 아님 |
| `agent/subagents.ts` | 990줄, 복잡하나 단일 책임 | SRP 준수 확인 |
| `dashboard/service.ts` | 725줄, 28개 라우트 import | 라우트 파일 분리 완료 상태 |
| `cron/service.ts` | 828줄 | DB 스키마·스케줄 로직 분리됨, 적절 |
| `agent/tools/index.ts` | 639줄, 100+ import | 도구 레지스트리 패턴, 정상 |

---

## 이터레이션 5 신규 발견

### ✅ I5-A: `timed_fetch` / `check_http` AbortController 잔존 [DRY, perf]
- **위치**: `agent/tools/http-utils.ts` L88, `agent/tools/healthcheck.ts` L69
- **문제**: I4-C에서 10곳 정리했으나 이 2곳이 누락됨
- **해결**: `AbortSignal.timeout()` 교체 + `timed_fetch` async 제거 (`7c94b2b`)

### ✅ I5-B: `node.country.output.*` i18n 키 불일치 [정확성]
- **위치**: `en.json` L2976-2978, `ko.json` L2976-2978
- **문제**: `.country`/`.countries` 스테일 키 → 컴포넌트는 `.code/.dial/.currency/.results` 참조
- **해결**: 양 파일 교체 완료 (이전 커밋에 포함)

### ✅ I5-C: 신규 노드(country/geo/ical/json-patch/jsonl) 등록 상태 검증
- **결론**: 백엔드 `nodes/index.ts`, 프론트엔드 `web/.../nodes/index.ts` 모두 정상 등록 확인

---

## 이터레이션 6 신규 발견

### ✅ I6-A: AbortController relay 패턴 3곳 [DRY, perf]
- **위치**: `backends/anthropic-native.agent.ts`, `backends/openai-compatible.agent.ts`, `cron/runtime-handler.ts`
- **해결**: `make_abort_signal(timeout, external?)` 단일 호출. try/finally 블록 제거 (`4f88bf1`)

### ✅ I6-B: TS2312 — `interface extends OrcheNodeDefinition` (union type) 9곳 [타입 정확성]
- **위치**: `nodes/color/country/geo/ical/json-patch/jsonl/random/semver/url.ts`
- **해결**: `type Xxx = OrcheNodeDefinition & { ... }` 로 변경

### ✅ I6-C: TS2339 — 미커밋 변경에서 타입 정의 누락 [타입 정확성]
- **위치**: `workflow-node.types.ts`
- **해결**: ChangelogNodeDef/DataFormatNodeDef/FtpNodeDef/PackageManagerNodeDef/StatsNodeDef 필드 추가

---

## 이터레이션 7 신규 발견

### 전체 코드베이스 SRP/God class 스캔 결과

| 파일 | 줄 수 | 결론 |
|------|-------|------|
| `channels/manager.ts` | 1338L | 채널 메시지 생명주기 오케스트레이터 — 의도적 조율자 패턴. SRP 준수 |
| `orchestration/service.ts` | 622L | execute() 위임 패턴. 이미 세분화됨 |
| `services/kanban-store.ts` | 1280L | 대형 인터페이스+구현. DB 서비스 특성상 적절 |
| `agent/workflow-node.types.ts` | 2121L | 순수 타입 덤프. 클래스 아님 |
| `dashboard/ops/workflow.ts` | 1087L | 긴 스키마 문서 상수 + 단일 팩토리 함수. 클래스 아님 |
| `agent/phase-loop-runner.ts` | 1314L | 페이즈 실행 엔진 단일 책임 |
| `agent/memory.service.ts` | 794L | 내장 SQL 스키마 포함. 적절 |

### ✅ I7-A: `resolve_reply_to` 3중 정의 + 잘못된 위치 [DRY, SRP]
- **위치**: `orchestration/service.ts` L613, `orchestration/request-preflight.ts` L243, `orchestration/execution/helpers.ts` L70
- **문제**: 동일한 채널 계층 함수가 orchestration 레이어에 3중 복제. `channels/`가 `orchestration/`에서 import하는 역방향 의존성 발생.
- **해결**: `channels/types.ts`에 정규 정의 추가. 3개 중복 제거. `channels/manager.ts`, `bootstrap/channels.ts` import 경로 수정. `orchestration/service.ts`는 `export { resolve_reply_to } from "../channels/types.js"` 하위 호환 re-export 유지.

---

## 이터레이션 8 신규 발견

### ✅ I8-A: `dashboard/routes/kanban.ts` — `store_or_503` 가드 32중복 [DRY, KISS]
- **위치**: 32개 라우트 핸들러 블록
- **문제**: `const store = get_store(ctx); if (!store) { json(res, 503, { error: "kanban_unavailable" }); return true; }` 완전 동일 2라인이 32회 반복
- **해결**: `store_or_503(ctx)` 헬퍼 추출. 503 에러 코드+메시지 한 곳 집중. 호출부는 `const store = store_or_503(ctx); if (!store) return true;` 로 단순화

### ✅ I8-B: `sleep` 유틸 산재 5곳 [DRY]
- **위치**: `agent/nodes/retry.ts`, `agent/pty/container-cli-agent.ts`, `providers/service.ts`, `agent/nodes/wait.ts`, `agent/tools/screenshot.ts`
- **문제**: `utils/common.ts`에 `sleep(ms)` 이미 export 되어 있으나 5개 파일에서 로컬 재정의 또는 인라인 `setTimeout` 사용
- **해결**: 5개 파일 모두 `utils/common.ts`에서 `sleep` import로 교체. 로컬 정의 삭제.

### ✅ I8-C: `request-preflight.ts` — `helpers.ts` 함수 4중 복사 [DRY, SRP]
- **위치**: `orchestration/request-preflight.ts`
- **문제**: `build_tool_context`, `compose_task_with_media`, `build_context_message`, `inbound_scope_id` + 관련 regex 2개가 `execution/helpers.ts`와 완전 동일하게 복사됨
- **해결**: 로컬 복사본 전부 삭제 → `./execution/helpers.js` import로 교체

---

## 이터레이션 9 신규 발견

### ✅ I9-A: `dashboard/routes/` — ops_or_503 가드 패턴 전파 [DRY, KISS]
- **위치**: `agent-provider.ts`(16), `oauth.ts`(12), `channel.ts`(8), `cron.ts`(6), `skill.ts`(5), `cli-auth.ts`(4), `memory.ts`(5) — 총 56회
- **문제**: I8-A와 동일한 패턴이 kanban.ts 외 7개 파일에도 존재. 에러 문자열과 503 코드가 파일당 최대 16곳 산재.
- **해결**: 각 파일에 `xxx_or_503(ctx)` 헬퍼 추가. `replace_all`로 일괄 제거.

### ✅ I9-B: `agent/tools/web.ts` — agent-browser 7개 함수 중복 구현 [DRY, SRP]
- **위치**: `agent/tools/web.ts` L19-135 (7개 함수: `detect_agent_browser_binary`, `parse_last_json_line`, `quote_cmd_arg`, `compact_session_name`, `run_agent_browser_cli`, `agent_browser_error`, `parsed_browser_data`)
- **문제**: `agent-browser-client.ts`에 이미 정규 구현이 export되어 있으나 `web.ts`가 독립적으로 재구현. 파일 주석("web/web-table/web-form/screenshot 공유")에 명시된 설계 의도 미반영.
- **해결**: 7개 로컬 함수 삭제. `agent-browser-client.ts`에서 import. `run_agent_browser_cli` → 1줄 어댑터로 교체. `compact_session_name` 호출 시그니처 4곳 수정.

---

## 최종 요약

**이터레이션 3 완료**: 6개 항목 (P1-A~F)
**이터레이션 4 완료**: 3개 항목 (I4-A~C)
**이터레이션 5 완료**: 3개 항목 (I5-A~C)
**이터레이션 6 완료**: 3개 항목 (I6-A~C)
**이터레이션 7 완료**: 1개 항목 (I7-A) + God class 스캔 완료
**이터레이션 8 완료**: 3개 항목 (I8-A~C)
**이터레이션 9 완료**: 2개 항목 (I9-A~B)
**총 완료**: 32개 항목
**SKIP (YAGNI/의도적 설계)**: 25개 항목 (이터레이션 7 스캔: 7개 추가)
**신규 헬퍼/유틸**: `runner_deps`, `finalize_phase`, `html-strip.ts`, `string-match.ts`, `make_document_handler`, `make_abort_signal`, `resolve_reply_to` (channels/types.ts로 이동), `store_or_503` (kanban.ts)
**보안 개선**: `validate_url`에 `.local` mDNS 도메인 차단 추가
**코드 제거**: ~127줄 (4 document 핸들러 통합) + 9줄 (AbortController 잔존) + relay 패턴 3곳 + `resolve_reply_to` 2중복 제거 + sleep 5중복 제거 + request-preflight 4함수 복사본 제거 + kanban 가드 32중복 단순화
