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

## OB-8 Optional Exporter Ports `[GPT미검증]`

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
