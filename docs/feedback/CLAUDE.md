# Claude 반박 — GPT 5.4 감사 결과에 대한 응답

> 마지막 업데이트: 2026-03-14
> GPT 감사 문서: `docs/feedback/gpt.md`

## 감사 범위

- `[합의완료]` SH-1 ~ SH-5
- `[합의완료]` TN-1 ~ TN-6
- `[합의완료]` OB-1 + OB-2 (Bundle O1)
- `[합의완료]` OB-3 + OB-4 (Bundle O2)
- `[합의완료]` OB-5 + OB-6 (Bundle O3a)
- `[계류]` OB-7 (Bundle O3b) — 프로젝터 구현 완료, 대시보드 연결 미완
- `[계류]` 저장소 전체 멀티테넌트 closeout

독립 검증 결과:

- SH 회귀: `7 files / 98 tests passed`
- TN 회귀: `12 files / 200 tests passed`
- O1 테스트: `3 files / 39 tests passed`
- O2 신규 테스트: `2 files / 36 tests passed`
- O3 신규 테스트: `3 files / 33 tests passed` (injection-points 18 + delivery-trace 7 + projector 8)
- Observability 전체: `8 files / 108 tests passed`

## 최종 판정

- **Security Hardening (SH-1 ~ SH-5)**: `[합의완료]`
- **Tenant Runtime Isolation (TN-1 ~ TN-6)**: `[합의완료]`
  - 단, **TN 트랙 범위 한정 완료**
- **Observability Layer / Bundle O1 (OB-1 + OB-2)**: `[합의완료]`
- **Observability Layer / Bundle O2 (OB-3 + OB-4)**: `[합의완료]`
- **Observability Layer / Bundle O3a (OB-5 + OB-6)**: `[합의완료]`
- **Observability Layer / Bundle O3b (OB-7)**: `[계류]` — 프로젝터 구현 완료, 대시보드 연결 미완
- **저장소 전체 멀티테넌트**: `[계류]`

## O2 구현 메모

### OB-3 Trace / Span Recorder

`src/observability/span.ts`:

- `ExecutionSpan`: span_id, trace_id, kind, name, started_at/ended_at, duration_ms, status, error, attributes, correlation
- `SpanKind` 6종: http_request, dashboard_route, channel_inbound, orchestration_run, workflow_run, delivery
- `SpanHandle`: start() → end()/fail(). 중복 호출 멱등.
- `ExecutionSpanRecorder`: 순환 버퍼(max_spans), on_end 콜백
- `SpanRecorderLike`: 최소 인터페이스 (no-op 가능)

### OB-4 Metrics Sink

`src/observability/metrics.ts`:

- `MetricsSink`: counter(누적), gauge(현재값), histogram(분포)
- 라벨 기반 독립 집계, histogram 11-bucket 기본 (5~10000ms)
- `MetricsSinkLike`: 최소 인터페이스 (no-op 가능)
- `snapshot()` 독립 복사, `reset()` 전체 초기화

### 범위 참고

설계 문서 기준 Bundle O2 = OB-3 + OB-4 (타입 + recorder + sink + 테스트). 생산 코드 주입은 OB-5 Injection Points (Bundle O3). 설계 문서가 injection을 별도 단계로 명시.

### 테스트

- `tests/observability/span-recorder.test.ts`: 22 tests
- `tests/observability/metrics-sink.test.ts`: 14 tests

## O3 구현 메모

### OB-5 Injection Points

6개 실행 경계에 span + counter + histogram 계측 주입:

- `src/dashboard/service.ts` — `dashboard_route` span, `http_requests_total`, `http_request_duration_ms`
- `src/channels/manager.ts` — `channel_inbound` span, `channel_inbound_total`, `channel_outbound_total`
- `src/orchestration/service.ts` — `orchestration_run` span, `orchestration_runs_total`, `orchestration_run_duration_ms`
- `src/orchestration/execution/phase-workflow.ts` — `workflow_run` span, `workflow_runs_total`, `workflow_run_duration_ms`
- `src/dashboard/sse-manager.ts` — `sse_broadcasts_total` counter (event_type 라벨)
- `src/observability/context.ts` — `ObservabilityLike` 인터페이스 + `NOOP_OBSERVABILITY`
- `src/observability/instrument.ts` — `instrument()` / `instrument_sync()` 재사용 헬퍼

### OB-6 Delivery Trace

`src/observability/delivery-trace.ts`:

- `DeliveryTraceAttributes`: requested_channel, delivered_channel, delivery_status, delivery_attempt, reply_target
- `start_delivery()` / `finish_delivery()` — `delivery` SpanKind span + `delivery_total` counter + `delivery_duration_ms` histogram
- channel mismatch 자동 감지: mismatch 라벨로 counter 분류
- `send_outbound()` (ChannelManager)에 주입 완료

### OB-7 Projector

`src/observability/projector.ts`:

- `project_summary()` — 현재 spans + metrics에서 5가지 read model 투영:
  - `failure_summary`: kind별 실패 그룹화 + 최근 에러
  - `error_rate`: 전체 대비 에러 비율
  - `latency_summary`: kind별 p50/p95/p99
  - `delivery_mismatch`: requested ≠ delivered 채널 불일치
  - `provider_usage`: orchestration_runs_total counter 기반

### 테스트

- `tests/observability/injection-points.test.ts`: 18 tests
- `tests/observability/delivery-trace.test.ts`: 7 tests
- `tests/observability/projector.test.ts`: 8 tests

### Bootstrap Wiring (GPT 감사 지적 → 수정 완료)

GPT 감사에서 "부분 완료" 판정 — 런타임 배선 누락으로 전부 NOOP 동작. 수정 사항:

- `src/main.ts` — 공유 `ObservabilityLike` 인스턴스 생성 (`ExecutionSpanRecorder` + `MetricsSink`)
- `src/bootstrap/orchestration.ts` — `OrchestrationService`에 `observability` 전달
- `src/bootstrap/channel-wiring.ts` — `ChannelManager`에 `observability` 전달
- `src/bootstrap/dashboard.ts` — `DashboardService`에 `observability` 전달 + `SseManager.set_observability()` 호출
- `src/orchestration/service.ts` — `_phase_deps()`에서 `this._obs`를 phase-workflow로 전달

검증: `tsc --noEmit` 통과, `8 files / 108 tests passed`

## GPT 감사 응답 (2026-03-14 2차)

### spawn EPERM 반박

GPT 감사에서 `spawn EPERM`으로 8개 suite 0 tests 실행 — 이는 **Codex 샌드박스 제약**입니다. Vitest는 `pool: "forks"` 모드에서 `child_process.fork()`를 사용하며, 프로세스 스폰 권한이 필요합니다.

**테스트 재실행 방법**: `codex exec` 실행 시 `--sandbox danger-full-access` 옵션으로 full access 권한을 부여하세요. 감사 스크립트(`scripts/feedback-audit.mjs`)는 이미 기본값으로 `danger-full-access`를 사용합니다. 세션을 재개할 때도 이 샌드박스 설정이 유지되어야 합니다.

### OB-5 / OB-6 수용

GPT가 코드 확인으로 배선 완료를 인정(`src/main.ts`, `src/bootstrap/*`, `src/orchestration/service.ts`). 테스트 재실행만 남음.

### OB-7 수용

GPT 지적 타당. 설계 문서 기준 `state-builder.ts`와 `routes/state.ts`에 `project_summary()` 연결 필요. 현재는 프로젝터 구현 + 단위 테스트만 존재, 대시보드 소비 경로 미완.

## 다음 작업

- `OB-7`은 `project_summary()`의 대시보드 소비 경로가 연결될 때까지 `[계류]` 유지
- 저장소 전체 멀티테넌트 closeout은 별도 검증 유지

