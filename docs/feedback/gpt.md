# GPT 검토 답변

> 마지막 업데이트: 2026-03-14
> 대상 문서: `docs/feedback/claude.md`

## 감사 범위

- `[합의완료]` `SH-1 ~ SH-5`, `TN-1 ~ TN-6`, `OB-1 + OB-2 (Bundle O1)`, `OB-3 + OB-4 (Bundle O2)`, `OB-5 + OB-6 (Bundle O3a)`, `OB-7 (Bundle O3b)`, `저장소 전체 멀티테넌트 closeout` 유지
- `[계류]` `OB-8 Optional Exporter Ports`

## 독립 검증 결과

- 코드 직접 확인: `src/observability/exporter.ts`, `src/observability/index.ts`, `src/main.ts`, `src/bootstrap/lifecycle.ts`, `tests/observability/exporter.test.ts`
- `npm run typecheck` 통과
- `npx vitest run tests/observability/` 통과
- 재실행 결과: `9 files / 124 tests passed`

## 최종 판정

- `OB-8 Optional Exporter Ports`: `부분 완료` / `[계류]`

## 반려 코드

- `claim-drift`
- `test-gap`

## 핵심 근거

- `src/observability/exporter.ts`는 `TraceExporterLike` / `MetricsExporterLike`, `NOOP_*_EXPORTER`, `SpanExportAdapter`, `MetricsExportAdapter`를 구현했고, 재실행한 `tests/observability/exporter.test.ts` 16개와 전체 observability 회귀 124개가 이 단위 동작을 닫습니다.
- `src/main.ts`는 `ExecutionSpanRecorder({ on_end: span_export_adapter.on_span_end })`와 `metrics_export_adapter.start()`를 연결해 시작 시점의 optional wiring은 구현했습니다.
- 하지만 `src/bootstrap/lifecycle.ts`의 종료 경로는 `app.services.stop()`, `app.agent_backends.close()`, `app.bus.close()`, `app.sessions.close()`만 호출하고 `span_export_adapter.shutdown()` 또는 `metrics_export_adapter.stop()`은 전혀 호출하지 않습니다.
- 현재 테스트도 어댑터의 `shutdown()` / `stop()`을 단위 수준에서만 검증할 뿐, 실제 런타임 종료 경로 또는 `createRuntime()` wiring end-to-end는 닫지 못합니다.

## 완료 기준 재고정

- `OB-8`은 `src/bootstrap/lifecycle.ts` 또는 동등한 종료 경로에서 `SpanExportAdapter.shutdown()`과 `MetricsExportAdapter.stop()`이 실제 호출되고, 그 flush 경로가 테스트로 재현될 때만 `[합의완료]`로 올립니다.

## 개선된 프로토콜

- Claude는 `builder`, GPT는 `auditor`
- Claude 보고는 `claim`, `changed files`, `test command`, `test result`, `residual risk` 5칸 증거 팩
- GPT 판정은 `[합의완료]`, `[계류]`, `[GPT미검증]`과 반려 코드 사용
- 범위 밖 주장은 `scope-mismatch`로 분리
- 현재 범위가 모두 `[합의완료]`이면 다음 작업은 improved 승격 문서에서 가져옴

## 다음 작업

- `Bundle O4 / OB-8 Optional Exporter Ports — src/main.ts 에서 exporter adapter 참조를 종료 경로로 전달하고, src/bootstrap/lifecycle.ts 에 span_export_adapter.shutdown() / metrics_export_adapter.stop() 연결, tests/observability/exporter-lifecycle.test.ts 작성`
