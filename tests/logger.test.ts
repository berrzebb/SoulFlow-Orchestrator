/**
 * logger.ts — create_logger, init_log_level, ConsoleLogger 테스트.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create_logger, init_log_level } from "@src/logger.js";

describe("create_logger — 기본 동작", () => {
  let console_log_spy: ReturnType<typeof vi.spyOn>;
  let console_error_spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    console_log_spy = vi.spyOn(console, "log").mockImplementation(() => {});
    console_error_spy = vi.spyOn(console, "error").mockImplementation(() => {});
    init_log_level("debug"); // 전체 레벨 활성화
  });

  afterEach(() => {
    vi.restoreAllMocks();
    init_log_level("info"); // 리셋
  });

  it("info 메시지 → console.log 호출", () => {
    const logger = create_logger("test");
    logger.info("hello");
    expect(console_log_spy).toHaveBeenCalledOnce();
    const arg = console_log_spy.mock.calls[0][0];
    expect(JSON.parse(arg)).toMatchObject({ level: "info", msg: "hello", name: "test" });
  });

  it("warn 메시지 → console.log 호출", () => {
    const logger = create_logger("test");
    logger.warn("warning");
    expect(console_log_spy).toHaveBeenCalledOnce();
    const arg = console_log_spy.mock.calls[0][0];
    expect(JSON.parse(arg)).toMatchObject({ level: "warn" });
  });

  it("error 메시지 → console.error 호출", () => {
    const logger = create_logger("test");
    logger.error("something failed");
    expect(console_error_spy).toHaveBeenCalledOnce();
    const arg = console_error_spy.mock.calls[0][0];
    expect(JSON.parse(arg)).toMatchObject({ level: "error", msg: "something failed" });
  });

  it("debug 메시지 → console.log 호출", () => {
    const logger = create_logger("test", "debug");
    logger.debug("debug info");
    expect(console_log_spy).toHaveBeenCalledOnce();
    const arg = console_log_spy.mock.calls[0][0];
    expect(JSON.parse(arg)).toMatchObject({ level: "debug" });
  });

  it("레벨 필터링: info 레벨에서 debug는 무시", () => {
    const logger = create_logger("test", "info");
    logger.debug("hidden");
    expect(console_log_spy).not.toHaveBeenCalled();
  });

  it("레벨 필터링: warn 레벨에서 info는 무시", () => {
    const logger = create_logger("test", "warn");
    logger.info("also hidden");
    expect(console_log_spy).not.toHaveBeenCalled();
  });

  it("ctx 컨텍스트 → JSON 출력에 포함", () => {
    const logger = create_logger("test");
    logger.info("with context", { key: "value", count: 42 });
    const arg = console_log_spy.mock.calls[0][0];
    const parsed = JSON.parse(arg);
    expect(parsed.key).toBe("value");
    expect(parsed.count).toBe(42);
  });

  it("child() → 새 logger 생성", () => {
    const parent = create_logger("parent");
    const child = parent.child("parent:child");
    child.info("child message");
    expect(console_log_spy).toHaveBeenCalledOnce();
    const arg = console_log_spy.mock.calls[0][0];
    expect(JSON.parse(arg)).toMatchObject({ name: "parent:child" });
  });

  it("JSON.stringify 실패 시 _ctx_error 포함", () => {
    const logger = create_logger("test");
    const circular: Record<string, unknown> = {};
    circular.self = circular; // 순환 참조
    logger.info("circular ctx", circular);
    const arg = console_log_spy.mock.calls[0][0];
    const parsed = JSON.parse(arg);
    expect(parsed._ctx_error).toBe(true);
  });
});

describe("init_log_level", () => {
  afterEach(() => {
    init_log_level("info"); // 원상복구
  });

  it("'error' 설정 시 error만 통과", () => {
    init_log_level("error");
    const log_spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const err_spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = create_logger("t");
    logger.warn("warn not shown");
    logger.error("error shown");

    expect(log_spy).not.toHaveBeenCalled();
    expect(err_spy).toHaveBeenCalledOnce();

    vi.restoreAllMocks();
  });

  it("잘못된 레벨 → 기본 'info'로 폴백", () => {
    init_log_level("invalid_level");
    const log_spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = create_logger("t");
    logger.info("should show");
    logger.debug("should not show");

    expect(log_spy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it("level_override가 글로벌 설정보다 우선", () => {
    init_log_level("error"); // 글로벌은 error만
    const log_spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = create_logger("t", "debug"); // 이 logger는 debug
    logger.debug("debug shown");
    expect(log_spy).toHaveBeenCalledOnce();

    vi.restoreAllMocks();
  });
});
