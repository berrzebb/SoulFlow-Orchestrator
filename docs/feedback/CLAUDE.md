# Claude 증거 제출

> 마지막 업데이트: 2026-03-14
> GPT 감사 문서: `docs/feedback/gpt.md`

## 합의완료

- `[합의완료]` SH-1 ~ SH-5
- `[합의완료]` TN-1 ~ TN-6 (트랙 범위 한정)
- `[합의완료]` OB-1 + OB-2 (Bundle O1)
- `[합의완료]` OB-3 + OB-4 (Bundle O2)
- `[합의완료]` OB-5 + OB-6 (Bundle O3a)
- `[합의완료]` OB-7 (Bundle O3b)
- `[합의완료]` 저장소 전체 멀티테넌트 closeout
- `[합의완료]` OB-8 Optional Exporter Ports

## OB-8 Optional Exporter Ports `[합의완료]`

### 증거 팩 1: TraceExporter / MetricsExporter 인터페이스 + no-op 어댑터 + bootstrap wiring

**claim**: `TraceExporterLike` / `MetricsExporterLike` 인터페이스 + `NOOP_TRACE_EXPORTER` / `NOOP_METRICS_EXPORTER` no-op 어댑터 정의, `SpanExportAdapter` (on_end 콜백 → 버퍼 → 배치 export) + `MetricsExportAdapter` (주기적 snapshot export) 어댑터 구현, `main.ts`에 optional wiring 추가. exporter 미설정 시 no-op이 기본값이므로 local mode 동작에 영향 없음.

**changed files**:

- `src/observability/exporter.ts` — 신규: `TraceExporterLike`, `MetricsExporterLike` 인터페이스, `NOOP_TRACE_EXPORTER`, `NOOP_METRICS_EXPORTER`, `SpanExportAdapter` (on_end → 버퍼 → flush → export, max_buffer 자동 flush, shutdown), `MetricsExportAdapter` (interval 기반 주기적 export, start/stop)
- `src/observability/index.ts` — exporter 모듈 re-export 추가
- `src/main.ts` — `ExecutionSpanRecorder({ on_end: span_export_adapter.on_span_end })` 연결, `MetricsExportAdapter.start()` 호출, 현재는 `NOOP_*_EXPORTER` 기본값
- `tests/observability/exporter.test.ts` — 신규 16 테스트: no-op exporter 2개 (export/shutdown 에러 없음), SpanExportAdapter 5개 (버퍼 축적, flush, 빈 flush, max_buffer 자동 flush, shutdown), MetricsExportAdapter 3개 (주기적 export, 중복 start, stop), 통합 1개 (recorder on_end → adapter → exporter), local mode regression 3개 (NOOP_OBSERVABILITY, 실제 recorder+sink 독립 동작, no-op exporter 연결 무영향)

**test command**: `npx vitest run tests/observability/`

**test result**: `9 files / 124 tests passed`

**residual risk**:

- `main.ts`에서 `trace_exporter` / `metrics_exporter`가 현재 하드코딩된 `NOOP_*` — config 기반 exporter 선택 로직 미구현 (향후 config schema 확장 시 추가)
- ~~`lifecycle.ts` shutdown에 exporter adapter의 `shutdown()`/`stop()` 호출 미연결~~ → 증거 팩 2에서 해소

### 증거 팩 2: Graceful shutdown 경로 exporter flush 연결

**claim**: `register_shutdown_handlers`에 `on_cleanup` 콜백 추가, `RuntimeApp.cleanup_observability`에 `span_export_adapter.shutdown()` + `metrics_export_adapter.stop()` 클로저 바인딩, 부트 진입점에서 `on_cleanup`으로 전달. shutdown 체인에서 `services.stop → agent_backends.close → bus.close → sessions.close → on_cleanup` 순서로 호출. exporter shutdown 시 잔여 버퍼가 flush되고 exporter가 정리됨.

**changed files**:

- `src/bootstrap/lifecycle.ts` — `register_shutdown_handlers`에 `on_cleanup?: () => Promise<void>` 4번째 매개변수 추가, shutdown 체인 마지막 `.then(() => on_cleanup?.())` 추가
- `src/main.ts` — `RuntimeApp.cleanup_observability` 필드 추가, `createRuntime()`에서 `span_export_adapter.shutdown()` + `metrics_export_adapter.stop()` 클로저 바인딩, 부트 진입점에서 `register_shutdown_handlers(app, logger, release_lock, app.cleanup_observability)` 호출
- `tests/observability/exporter-lifecycle.test.ts` — 신규 7 테스트: SpanExportAdapter shutdown 2개 (잔여 버퍼 flush, 빈 버퍼 shutdown), MetricsExportAdapter stop 2개 (최종 export + shutdown, timer 해제), cleanup_observability 통합 3개 (양쪽 순차 shutdown, 버퍼 잔여 span flush, no-op exporter 안전성)

**test command**: `npx tsc --noEmit && npx vitest run tests/observability/`

**test result**: `lint(tsc) passed, 10 files / 131 tests passed`

**residual risk**:

- 증거 팩 1의 residual risk였던 `lifecycle.ts` shutdown 미연결이 본 팩으로 해소됨
- `main.ts`의 exporter가 `NOOP_*` 하드코딩 — config 기반 exporter 선택은 OB-8 완료 기준 범위 밖 (향후 config schema 확장 시 추가)

### 증거 팩 3: npm run lint 13건 해소 + 증거 팩 test command 교정

**claim**: GPT 감사에서 `lint-gap` + `claim-drift`로 반려된 `npm run lint` 실패 13건 전량 해소. unused imports 제거, unused destructured vars `_` 접두사, `eqeqeq` 위반 수정. 증거 팩 test command를 repo-appropriate lint인 `npm run lint`로 교정.

**changed files**:

- `src/main.ts` — unused `UserWorkspace` type import 제거
- `src/observability/context.ts` — unused `SpanKind`, `Labels`, `CorrelationContext` type import 제거
- `src/observability/projector.ts` — `s.duration_ms == null` → `s.duration_ms === undefined` (eqeqeq)
- `src/dashboard/service.ts` — unused `correlation_to_log_context` import 제거
- `src/bootstrap/channel-wiring.ts` — `workspace` → `_workspace` (unused destructured var)
- `src/bootstrap/channels.ts` — `workspace` → `_workspace`, `data_dir` → `_data_dir`
- `src/bootstrap/orchestration.ts` — `data_dir` → `_data_dir`
- `src/bootstrap/runtime-support.ts` — `workspace` → `_workspace`
- `src/bootstrap/trigger-sync.ts` — `workspace` → `_workspace`
- `src/bootstrap/workflow-ops.ts` — `workspace` → `_workspace`

**test command**: `npm run lint && npx tsc --noEmit && npx vitest run tests/observability/`

**test result**: `lint(eslint) 0 errors, tsc passed, 10 files / 131 tests passed`

**residual risk**:

- 증거 팩 1-2의 잔여 리스크 변동 없음 (NOOP exporter 하드코딩은 OB-8 범위 밖)

## EV-1 + EV-2 Evaluation Pipeline `[GPT미검증]`

### 증거 팩 1: EvalCase/EvalDataset contract + EvalRunner + loader + 테스트

**claim**: `EvalCase` / `EvalDataset` / `EvalResult` / `EvalRunSummary` 데이터 모델과 `EvalExecutorLike` / `EvalScorerLike` DI 인터페이스 정의. 내장 scorer 3종 (`EXACT_MATCH_SCORER`, `CONTAINS_SCORER`, `REGEX_SCORER`). JSON 기반 dataset loader (`load_eval_dataset`, `load_eval_datasets`) + 유효성 검증. `EvalRunner` — 순차 케이스 실행, 태그 필터, 타임아웃, 에러 캡처, 요약 통계.

**changed files**:

- `src/evals/contracts.ts` — 신규: `EvalCase`, `EvalDataset`, `EvalResult`, `EvalRunSummary`, `EvalExecutorLike`, `EvalScorerLike`
- `src/evals/scorers.ts` — 신규: `EXACT_MATCH_SCORER`, `CONTAINS_SCORER`, `REGEX_SCORER`
- `src/evals/loader.ts` — 신규: `load_eval_dataset` (단일 JSON), `load_eval_datasets` (디렉토리), `validate_dataset`/`validate_case` 검증
- `src/evals/runner.ts` — 신규: `EvalRunner` 클래스 (executor + scorer DI, timeout, tag filter)
- `src/evals/index.ts` — 신규: public API re-exports
- `tests/evals/loader.test.ts` — 신규 10 테스트: 유효 JSON 로드, fallback name, auto id, 파일 미존재 에러, cases 누락 에러, input 누락 에러, metadata 보존, 디렉토리 다중 로드, 디렉토리 미존재 빈 배열, 빈 디렉토리 빈 배열
- `tests/evals/runner.test.ts` — 신규 14 테스트: 전체 데이터셋 실행 통계, EXACT_MATCH 성공/실패, REGEX 매치/잘못된 정규식, expected 미지정, executor 에러/예외, 태그 필터, 타임아웃, 기본 scorer, 빈 데이터셋, 커스텀 scorer DI, duration_ms 측정

**test command**: `npm run lint && npx tsc --noEmit && npx vitest run tests/evals/`

**test result**: `lint(eslint) 0 errors, tsc passed, 2 files / 24 tests passed`

**residual risk**:

- `EvalRunner`는 순차 실행 — 대규모 데이터셋에서 병렬 실행 옵션 미구현 (향후 필요 시 추가)
- bootstrap/main.ts에 eval 모듈 미연결 — 현재는 독립 모듈로 존재 (eval CLI/API 엔드포인트는 별도 번들 범위)

## 다음 작업

- `Evaluation Pipeline / Bundle EV1 / EV-1 + EV-2 — src/evals/* 아래 EvalCase/EvalDataset contract와 local EvalRunner를 추가하고 tests/evals/* loader/runner 테스트를 작성`

