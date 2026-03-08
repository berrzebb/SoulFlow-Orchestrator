/**
 * ServiceManager — register/start/stop/health_check 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import { ServiceManager } from "../../src/runtime/service-manager.js";
import type { ServiceLike } from "../../src/runtime/service.types.js";
import type { Logger } from "../../src/logger.js";

function make_mock_logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function make_service(name: string, fail_start = false, fail_stop = false): ServiceLike {
  return {
    name,
    start: fail_start ? vi.fn().mockRejectedValue(new Error(`${name} start failed`)) : vi.fn().mockResolvedValue(undefined),
    stop: fail_stop ? vi.fn().mockRejectedValue(new Error(`${name} stop failed`)) : vi.fn().mockResolvedValue(undefined),
    health_check: vi.fn().mockReturnValue({ ok: true }),
  };
}

describe("ServiceManager", () => {
  it("register + start: 등록된 서비스 순서대로 시작", async () => {
    const log = make_mock_logger();
    const mgr = new ServiceManager(log);
    const svc1 = make_service("svc1");
    const svc2 = make_service("svc2");
    mgr.register(svc1);
    mgr.register(svc2);
    await mgr.start();
    expect(svc1.start).toHaveBeenCalledOnce();
    expect(svc2.start).toHaveBeenCalledOnce();
  });

  it("start: 중복 호출 무시 (idempotent)", async () => {
    const log = make_mock_logger();
    const mgr = new ServiceManager(log);
    const svc = make_service("svc");
    mgr.register(svc);
    await mgr.start();
    await mgr.start();
    expect(svc.start).toHaveBeenCalledOnce();
  });

  it("stop: 역순으로 서비스 중지", async () => {
    const log = make_mock_logger();
    const mgr = new ServiceManager(log);
    const order: string[] = [];
    const svc1 = { name: "s1", start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockImplementation(async () => { order.push("s1"); }), health_check: vi.fn().mockReturnValue({ ok: true }) };
    const svc2 = { name: "s2", start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockImplementation(async () => { order.push("s2"); }), health_check: vi.fn().mockReturnValue({ ok: true }) };
    mgr.register(svc1);
    mgr.register(svc2);
    await mgr.start();
    await mgr.stop();
    expect(order).toEqual(["s2", "s1"]);
  });

  it("stop: 미시작 상태에서 호출 무시", async () => {
    const log = make_mock_logger();
    const mgr = new ServiceManager(log);
    const svc = make_service("svc");
    mgr.register(svc);
    await mgr.stop(); // should not throw
    expect(svc.stop).not.toHaveBeenCalled();
  });

  it("start: required 서비스 실패 → 에러 전파", async () => {
    const log = make_mock_logger();
    const mgr = new ServiceManager(log);
    mgr.register(make_service("fail-svc", true), { required: true });
    await expect(mgr.start()).rejects.toThrow("fail-svc start failed");
  });

  it("start: optional 서비스 실패 → 에러 무시", async () => {
    const log = make_mock_logger();
    const mgr = new ServiceManager(log);
    mgr.register(make_service("opt-fail", true), { required: false });
    mgr.register(make_service("ok-svc"));
    await expect(mgr.start()).resolves.not.toThrow();
  });

  it("stop: 서비스 stop 실패 → 경고 후 계속", async () => {
    const log = make_mock_logger();
    const mgr = new ServiceManager(log);
    const svc1 = make_service("fail-stop", false, true);
    const svc2 = make_service("ok-stop");
    mgr.register(svc1);
    mgr.register(svc2);
    await mgr.start();
    await mgr.stop(); // should not throw
    expect(log.warn).toHaveBeenCalled();
  });

  it("health_check: 모든 서비스 상태 반환", async () => {
    const log = make_mock_logger();
    const mgr = new ServiceManager(log);
    mgr.register(make_service("healthy"));
    await mgr.start();
    const results = await mgr.health_check();
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("healthy");
    expect(results[0].ok).toBe(true);
    await mgr.stop();
  });

  it("health_check: health_check 실패 → ok=false", async () => {
    const log = make_mock_logger();
    const mgr = new ServiceManager(log);
    const svc = make_service("bad-health");
    (svc.health_check as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error("crash"); });
    mgr.register(svc);
    const results = await mgr.health_check();
    expect(results[0].ok).toBe(false);
  });
});
