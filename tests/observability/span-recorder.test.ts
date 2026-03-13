/**
 * OB-3 — ExecutionSpan + SpanRecorder 단위 테스트.
 *
 * 검증 항목:
 *   1. span 생성 시 필수 필드가 채워진다 (span_id, trace_id, kind, name, started_at)
 *   2. end()로 정상 종료 → status, ended_at, duration_ms 채워짐
 *   3. fail()로 에러 종료 → status="error", error 메시지 포함
 *   4. 중복 end/fail 호출은 무시된다 (멱등)
 *   5. on_end 콜백이 종료 시 호출된다
 *   6. 순환 버퍼: max_spans 초과 시 오래된 span이 제거된다
 *   7. correlation context가 span에 포함된다
 *   8. attributes가 start/end에서 병합된다
 */
import { describe, it, expect, vi } from "vitest";
import {
  ExecutionSpanRecorder,
  type ExecutionSpan,
  type SpanKind,
} from "@src/observability/span.js";
import { create_correlation } from "@src/observability/correlation.js";

describe("ExecutionSpanRecorder — span 생성", () => {
  it("start()가 필수 필드를 가진 span을 반환한다", () => {
    const recorder = new ExecutionSpanRecorder();
    const corr = create_correlation({ team_id: "t1" });
    const handle = recorder.start("orchestration_run", "execute", corr);

    expect(handle.span.span_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(handle.span.trace_id).toBe(corr.trace_id);
    expect(handle.span.kind).toBe("orchestration_run");
    expect(handle.span.name).toBe("execute");
    expect(handle.span.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(handle.span.ended_at).toBeUndefined();
    expect(handle.span.duration_ms).toBeUndefined();
    expect(handle.span.status).toBeUndefined();
  });

  it("correlation 필드가 span에 포함된다", () => {
    const recorder = new ExecutionSpanRecorder();
    const corr = create_correlation({ team_id: "t1", user_id: "u1", provider: "openai" });
    const handle = recorder.start("channel_inbound", "message", corr);

    expect(handle.span.correlation.team_id).toBe("t1");
    expect(handle.span.correlation.user_id).toBe("u1");
    expect(handle.span.correlation.provider).toBe("openai");
  });

  it("start attributes가 span.attributes에 포함된다", () => {
    const recorder = new ExecutionSpanRecorder();
    const handle = recorder.start("http_request", "GET /api/state", create_correlation(), { method: "GET", path: "/api/state" });

    expect(handle.span.attributes.method).toBe("GET");
    expect(handle.span.attributes.path).toBe("/api/state");
  });

  it("trace_id가 없는 correlation이면 자동 생성된다", () => {
    const recorder = new ExecutionSpanRecorder();
    const handle = recorder.start("dashboard_route", "state", {});

    expect(handle.span.trace_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("ExecutionSpanRecorder — span 종료", () => {
  it("end()로 정상 종료하면 status, ended_at, duration_ms가 채워진다", () => {
    const recorder = new ExecutionSpanRecorder();
    const handle = recorder.start("orchestration_run", "execute", create_correlation());
    const finished = handle.end();

    expect(finished.status).toBe("ok");
    expect(finished.ended_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof finished.duration_ms).toBe("number");
    expect(finished.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("end()에 커스텀 status를 전달할 수 있다", () => {
    const recorder = new ExecutionSpanRecorder();
    const handle = recorder.start("workflow_run", "phase", create_correlation());
    const finished = handle.end("timeout");

    expect(finished.status).toBe("timeout");
  });

  it("end() 시 추가 attributes가 병합된다", () => {
    const recorder = new ExecutionSpanRecorder();
    const handle = recorder.start("http_request", "req", create_correlation(), { method: "POST" });
    handle.end("ok", { status_code: 200 });

    expect(handle.span.attributes.method).toBe("POST");
    expect(handle.span.attributes.status_code).toBe(200);
  });

  it("fail()로 에러 종료하면 status='error'와 error 메시지가 포함된다", () => {
    const recorder = new ExecutionSpanRecorder();
    const handle = recorder.start("delivery", "send", create_correlation());
    const finished = handle.fail("connection refused");

    expect(finished.status).toBe("error");
    expect(finished.error).toBe("connection refused");
    expect(finished.ended_at).toBeTruthy();
    expect(typeof finished.duration_ms).toBe("number");
  });

  it("중복 end() 호출은 무시된다 (멱등)", () => {
    const recorder = new ExecutionSpanRecorder();
    const handle = recorder.start("orchestration_run", "exec", create_correlation());
    const first = handle.end("ok");
    const second = handle.end("error");

    expect(first).toBe(second);
    expect(first.status).toBe("ok");
    expect(recorder.completed_count).toBe(1);
  });

  it("end() 후 fail() 호출도 무시된다", () => {
    const recorder = new ExecutionSpanRecorder();
    const handle = recorder.start("orchestration_run", "exec", create_correlation());
    handle.end("ok");
    handle.fail("should not apply");

    expect(handle.span.status).toBe("ok");
    expect(handle.span.error).toBeUndefined();
  });
});

describe("ExecutionSpanRecorder — 저장 + 콜백", () => {
  it("종료된 span이 get_spans()에 포함된다", () => {
    const recorder = new ExecutionSpanRecorder();
    recorder.start("orchestration_run", "a", create_correlation()).end();
    recorder.start("workflow_run", "b", create_correlation()).end();

    expect(recorder.get_spans()).toHaveLength(2);
    expect(recorder.completed_count).toBe(2);
  });

  it("종료되지 않은 span은 get_spans()에 포함되지 않는다", () => {
    const recorder = new ExecutionSpanRecorder();
    recorder.start("orchestration_run", "pending", create_correlation());

    expect(recorder.get_spans()).toHaveLength(0);
  });

  it("on_end 콜백이 종료 시 호출된다", () => {
    const on_end = vi.fn();
    const recorder = new ExecutionSpanRecorder({ on_end });
    const handle = recorder.start("delivery", "send", create_correlation());
    handle.end();

    expect(on_end).toHaveBeenCalledOnce();
    expect(on_end.mock.calls[0][0].kind).toBe("delivery");
    expect(on_end.mock.calls[0][0].status).toBe("ok");
  });

  it("on_end 콜백이 fail() 시에도 호출된다", () => {
    const on_end = vi.fn();
    const recorder = new ExecutionSpanRecorder({ on_end });
    recorder.start("channel_inbound", "msg", create_correlation()).fail("timeout");

    expect(on_end).toHaveBeenCalledOnce();
    expect(on_end.mock.calls[0][0].status).toBe("error");
  });

  it("max_spans 초과 시 오래된 span이 제거된다", () => {
    const recorder = new ExecutionSpanRecorder({ max_spans: 3 });
    for (let i = 0; i < 5; i++) {
      recorder.start("orchestration_run", `span_${i}`, create_correlation()).end();
    }

    expect(recorder.get_spans()).toHaveLength(3);
    expect(recorder.get_spans()[0].name).toBe("span_2");
    expect(recorder.get_spans()[2].name).toBe("span_4");
  });

  it("clear()가 모든 span을 제거한다", () => {
    const recorder = new ExecutionSpanRecorder();
    recorder.start("orchestration_run", "a", create_correlation()).end();
    recorder.start("orchestration_run", "b", create_correlation()).end();
    recorder.clear();

    expect(recorder.get_spans()).toHaveLength(0);
    expect(recorder.completed_count).toBe(0);
  });
});

describe("ExecutionSpanRecorder — span 종류 커버리지", () => {
  const ALL_KINDS: SpanKind[] = [
    "http_request", "dashboard_route", "channel_inbound",
    "orchestration_run", "workflow_run", "delivery",
  ];

  it.each(ALL_KINDS)("kind '%s'이 정상 생성된다", (kind) => {
    const recorder = new ExecutionSpanRecorder();
    const handle = recorder.start(kind, `test_${kind}`, create_correlation());
    handle.end();

    expect(recorder.get_spans()).toHaveLength(1);
    expect(recorder.get_spans()[0].kind).toBe(kind);
  });
});
