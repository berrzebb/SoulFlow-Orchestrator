/**
 * OB-2 Structured JSON Envelope — 계약 테스트.
 *
 * 검증 항목:
 *   1. 로그 출력이 공통 envelope 스키마를 따른다 (ts, level, name, msg)
 *   2. child logger가 부모의 base context를 상속한다
 *   3. child의 child가 context를 누적한다
 *   4. 호출 시 전달한 ctx가 base context를 override한다
 *   5. correlation 필드가 envelope에 포함된다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create_logger, type LogEnvelope } from "@src/logger.js";

/** console.log/error 출력을 캡처. */
function capture_logs(): { lines: LogEnvelope[]; restore: () => void } {
  const lines: LogEnvelope[] = [];
  const orig_log = console.log;
  const orig_error = console.error;

  console.log = (...args: unknown[]) => {
    try { lines.push(JSON.parse(String(args[0])) as LogEnvelope); } catch { /* skip */ }
  };
  console.error = (...args: unknown[]) => {
    try { lines.push(JSON.parse(String(args[0])) as LogEnvelope); } catch { /* skip */ }
  };

  return {
    lines,
    restore: () => { console.log = orig_log; console.error = orig_error; },
  };
}

describe("JSON Envelope 기본 필드", () => {
  let cap: ReturnType<typeof capture_logs>;

  beforeEach(() => { cap = capture_logs(); });
  afterEach(() => { cap.restore(); });

  it("ts, level, name, msg 필드가 항상 존재한다", () => {
    const log = create_logger("test-mod", "debug");
    log.info("hello");

    expect(cap.lines).toHaveLength(1);
    const entry = cap.lines[0];
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.level).toBe("info");
    expect(entry.name).toBe("test-mod");
    expect(entry.msg).toBe("hello");
  });

  it("debug/info/warn/error 모두 같은 envelope 구조", () => {
    const log = create_logger("test-mod", "debug");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(cap.lines).toHaveLength(4);
    for (const entry of cap.lines) {
      expect(entry).toHaveProperty("ts");
      expect(entry).toHaveProperty("level");
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("msg");
    }
    expect(cap.lines.map((e) => e.level)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("레벨 필터링이 동작한다 (info 레벨에서 debug 무시)", () => {
    const log = create_logger("test-mod", "info");
    log.debug("should not appear");
    log.info("should appear");

    expect(cap.lines).toHaveLength(1);
    expect(cap.lines[0].msg).toBe("should appear");
  });

  it("ad-hoc ctx 필드가 envelope에 포함된다", () => {
    const log = create_logger("test-mod", "debug");
    log.info("with ctx", { status: "ok", duration_ms: 42 });

    expect(cap.lines[0].status).toBe("ok");
    expect(cap.lines[0].duration_ms).toBe(42);
  });
});

describe("child logger — base context 누적", () => {
  let cap: ReturnType<typeof capture_logs>;

  beforeEach(() => { cap = capture_logs(); });
  afterEach(() => { cap.restore(); });

  it("child가 부모 이름을 변경하고 base context를 상속한다", () => {
    const parent = create_logger("parent", "debug");
    const child = parent.child("child", { team_id: "t1", user_id: "u1" });

    child.info("from child");

    expect(cap.lines).toHaveLength(1);
    const entry = cap.lines[0];
    expect(entry.name).toBe("child");
    expect(entry.team_id).toBe("t1");
    expect(entry.user_id).toBe("u1");
  });

  it("child의 child가 context를 누적한다", () => {
    const root = create_logger("root", "debug");
    const mid = root.child("mid", { team_id: "t1" });
    const leaf = mid.child("leaf", { chat_id: "c1" });

    leaf.info("deep");

    expect(cap.lines).toHaveLength(1);
    const entry = cap.lines[0];
    expect(entry.name).toBe("leaf");
    expect(entry.team_id).toBe("t1");
    expect(entry.chat_id).toBe("c1");
  });

  it("child의 base context와 호출 시 ctx가 합쳐진다", () => {
    const log = create_logger("mod", "debug").child("sub", { team_id: "t1" });
    log.info("merged", { run_id: "r1" });

    const entry = cap.lines[0];
    expect(entry.team_id).toBe("t1");
    expect(entry.run_id).toBe("r1");
  });

  it("호출 시 ctx가 base context를 override한다", () => {
    const log = create_logger("mod", "debug").child("sub", { team_id: "t1" });
    log.info("override", { team_id: "t2" });

    expect(cap.lines[0].team_id).toBe("t2");
  });

  it("부모 logger의 출력에는 child base context가 포함되지 않는다", () => {
    const parent = create_logger("parent", "debug");
    parent.child("child", { team_id: "t1" });
    parent.info("parent log");

    expect(cap.lines).toHaveLength(1);
    expect(cap.lines[0].name).toBe("parent");
    expect(cap.lines[0].team_id).toBeUndefined();
  });

  it("child 없이 base context를 전달하면 base_ctx가 비어있다", () => {
    const log = create_logger("bare", "debug");
    log.info("no base");

    expect(cap.lines[0].team_id).toBeUndefined();
    expect(cap.lines[0].trace_id).toBeUndefined();
  });
});

describe("correlation 필드 통합", () => {
  let cap: ReturnType<typeof capture_logs>;

  beforeEach(() => { cap = capture_logs(); });
  afterEach(() => { cap.restore(); });

  it("correlation 키가 base context로 전달되면 envelope에 포함된다", () => {
    const log = create_logger("svc", "debug").child("handler", {
      trace_id: "abc-123",
      request_id: "req-1",
      team_id: "team_a",
      user_id: "alice",
    });
    log.info("request start");

    const entry = cap.lines[0];
    expect(entry.trace_id).toBe("abc-123");
    expect(entry.request_id).toBe("req-1");
    expect(entry.team_id).toBe("team_a");
    expect(entry.user_id).toBe("alice");
  });

  it("correlation_to_log_context 변환 후 child에 전달", async () => {
    const { correlation_to_log_context } = await import("@src/logger.js");
    const { create_correlation } = await import("@src/observability/correlation.js");

    const corr = create_correlation({ team_id: "t1", user_id: "u1", provider: "anthropic" });
    const log_ctx = correlation_to_log_context(corr);
    const log = create_logger("svc", "debug").child("handler", log_ctx);
    log.info("correlated");

    const entry = cap.lines[0];
    expect(entry.trace_id).toBe(corr.trace_id);
    expect(entry.team_id).toBe("t1");
    expect(entry.provider).toBe("anthropic");
  });
});

describe("에러 처리", () => {
  let cap: ReturnType<typeof capture_logs>;

  beforeEach(() => { cap = capture_logs(); });
  afterEach(() => { cap.restore(); });

  it("순환 참조 ctx → _ctx_error: true로 안전하게 처리", () => {
    const log = create_logger("err-test", "debug");
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    log.info("circular", circular);

    expect(cap.lines).toHaveLength(1);
    expect(cap.lines[0]._ctx_error).toBe(true);
  });

  it("error 레벨은 console.error로 출력", () => {
    const orig_error = console.error;
    let error_called = false;
    console.error = () => { error_called = true; };

    const log = create_logger("err-test", "debug");
    log.error("fail");

    console.error = orig_error;
    expect(error_called).toBe(true);
  });
});
