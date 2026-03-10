/**
 * OpsRuntimeService — 전체 기능 커버리지:
 * - start/stop/health_check/status
 * - startup_changelog: startup_logged guard
 * - health_tick: health_log_enabled/on_change 분기
 * - watchdog_tick: services 없음/있음, unhealthy
 * - bridge_pump_tick: bridge_pump_enabled 분기
 * - decision_dedupe_tick: decisions + promises
 * - secret_prune_tick: secret_vault + session_store + dlq
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpsRuntimeService } from "@src/ops/service.js";
import type { OpsRuntimeDeps } from "@src/ops/types.js";

function make_deps(overrides: Partial<OpsRuntimeDeps> = {}): OpsRuntimeDeps {
  return {
    bus: {
      get_sizes: vi.fn().mockReturnValue({ inbound: 0, outbound: 0 }),
      consume_inbound: vi.fn().mockResolvedValue(null),
    } as any,
    channels: {
      get_status: vi.fn().mockReturnValue({ enabled_channels: ["slack"], mention_loop_running: false }),
      handle_inbound_message: vi.fn().mockResolvedValue(undefined),
    } as any,
    cron: {
      every: vi.fn(),
    } as any,
    heartbeat: {
      status: vi.fn().mockReturnValue({ enabled: true }),
    } as any,
    decisions: {
      dedupe_decisions: vi.fn().mockResolvedValue({ removed: 0, active: 5 }),
    } as any,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as any,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════
// start/stop/health_check/status
// ══════════════════════════════════════════════════════════

describe("OpsRuntimeService — start/stop/health_check/status", () => {
  it("start → cron.every 5번 등록, status.running=true", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps);

    await svc.start();

    expect(deps.cron.every).toHaveBeenCalledTimes(5);
    expect(svc.status().running).toBe(true);
    expect(svc.health_check().ok).toBe(true);
  });

  it("start 두 번 호출 → cron.every 두 번 등록 안 됨 (guard)", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps);

    await svc.start();
    await svc.start();

    // 첫 번째 start에서 5번 등록, 두 번째는 무시
    expect(deps.cron.every).toHaveBeenCalledTimes(5);
  });

  it("stop → status.running=false, health_check.ok=false", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps);

    await svc.start();
    await svc.stop();

    expect(svc.status().running).toBe(false);
    expect(svc.health_check().ok).toBe(false);
  });

  it("status() → 현재 상태 복사본 반환", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps);
    const s = svc.status();
    expect(s.running).toBe(false);
    expect(s.startup_logged).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// 직접 tick 함수 호출 (cron.every 콜백 추출)
// ══════════════════════════════════════════════════════════

function get_cron_callbacks(deps: OpsRuntimeDeps): Array<() => Promise<void>> {
  return (deps.cron.every as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => call[1] as () => Promise<void>);
}

describe("OpsRuntimeService — health_tick (cron callback)", () => {
  it("health_log_enabled=true + not on_change → 항상 로그", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps, { healthLogEnabled: true, healthLogOnChange: false });
    await svc.start();

    const [health_tick] = get_cron_callbacks(deps);
    await health_tick();

    expect(deps.logger!.info).toHaveBeenCalledWith(expect.stringContaining("health"));
  });

  it("health_log_enabled=true + on_change=true + 동일 signature → 로그 안 함", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps, { healthLogEnabled: true, healthLogOnChange: true });
    await svc.start();

    const [health_tick] = get_cron_callbacks(deps);
    await health_tick();  // 첫 번째: 변화 있음 → 로그
    (deps.logger!.info as ReturnType<typeof vi.fn>).mockClear();
    await health_tick();  // 두 번째: 동일 signature → 로그 안 함

    expect(deps.logger!.info).not.toHaveBeenCalledWith(expect.stringContaining("health"));
  });

  it("running=false → health_tick early return", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps, { healthLogEnabled: true });
    await svc.start();
    await svc.stop();

    const [health_tick] = get_cron_callbacks(deps);
    await health_tick();

    expect(deps.bus.get_sizes).not.toHaveBeenCalled();
  });
});

describe("OpsRuntimeService — watchdog_tick (cron callback)", () => {
  it("services 없음 → watchdog 스킵 (last_watchdog_at 업데이트)", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const [, watchdog_tick] = get_cron_callbacks(deps);
    await watchdog_tick();

    expect(svc.status().last_watchdog_at).toBeDefined();
  });

  it("services 있음 + unhealthy → warn 로그", async () => {
    const deps = make_deps({
      services: {
        health_check: vi.fn().mockResolvedValue([
          { name: "db", ok: false },
          { name: "redis", ok: true },
        ]),
      } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const [, watchdog_tick] = get_cron_callbacks(deps);
    await watchdog_tick();

    expect(deps.logger!.warn).toHaveBeenCalledWith(
      "watchdog: unhealthy services",
      expect.objectContaining({ services: ["db"] }),
    );
  });

  it("services.health_check 에러 → error 로그", async () => {
    const deps = make_deps({
      services: {
        health_check: vi.fn().mockRejectedValue(new Error("connection failed")),
      } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const [, watchdog_tick] = get_cron_callbacks(deps);
    await watchdog_tick();

    expect(deps.logger!.error).toHaveBeenCalledWith(expect.stringContaining("watchdog health_check failed"));
  });
});

describe("OpsRuntimeService — bridge_pump_tick (cron callback)", () => {
  it("bridge_pump_enabled=false → consume_inbound 미호출", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps, { bridgePumpEnabled: false });
    await svc.start();

    const [, , bridge_tick] = get_cron_callbacks(deps);
    await bridge_tick();

    expect(deps.bus.consume_inbound).not.toHaveBeenCalled();
    expect(svc.status().last_bridge_pump_at).toBeDefined();
  });

  it("bridge_pump_enabled=true + inbound=null → handle 미호출", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps, { bridgePumpEnabled: true });
    await svc.start();

    const [, , bridge_tick] = get_cron_callbacks(deps);
    await bridge_tick();

    expect(deps.bus.consume_inbound).toHaveBeenCalled();
    expect(deps.channels.handle_inbound_message).not.toHaveBeenCalled();
  });

  it("bridge_pump_enabled=true + inbound 있음 → handle_inbound_message 호출", async () => {
    const msg = { id: "m1", content: "hello" };
    const deps = make_deps({
      bus: {
        get_sizes: vi.fn().mockReturnValue({ inbound: 1, outbound: 0 }),
        consume_inbound: vi.fn().mockResolvedValue(msg),
      } as any,
    });
    const svc = new OpsRuntimeService(deps, { bridgePumpEnabled: true });
    await svc.start();

    const [, , bridge_tick] = get_cron_callbacks(deps);
    await bridge_tick();

    expect(deps.channels.handle_inbound_message).toHaveBeenCalledWith(msg);
  });

  it("bridge_pump 에러 → error 로그", async () => {
    const deps = make_deps({
      bus: {
        get_sizes: vi.fn().mockReturnValue({ inbound: 0, outbound: 0 }),
        consume_inbound: vi.fn().mockRejectedValue(new Error("bus error")),
      } as any,
    });
    const svc = new OpsRuntimeService(deps, { bridgePumpEnabled: true });
    await svc.start();

    const [, , bridge_tick] = get_cron_callbacks(deps);
    await bridge_tick();

    expect(deps.logger!.error).toHaveBeenCalledWith(expect.stringContaining("bridge pump failed"));
  });
});

describe("OpsRuntimeService — decision_dedupe_tick (cron callback)", () => {
  it("removed > 0 → info 로그", async () => {
    const deps = make_deps({
      decisions: {
        dedupe_decisions: vi.fn().mockResolvedValue({ removed: 3, active: 10 }),
      } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const [, , , dedupe_tick] = get_cron_callbacks(deps);
    await dedupe_tick();

    expect(deps.logger!.info).toHaveBeenCalledWith(expect.stringContaining("decision dedupe removed=3"));
  });

  it("promises 있음 + removed > 0 → promise dedupe 로그", async () => {
    const deps = make_deps({
      promises: {
        dedupe_promises: vi.fn().mockResolvedValue({ removed: 2, active: 5 }),
      } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const [, , , dedupe_tick] = get_cron_callbacks(deps);
    await dedupe_tick();

    expect(deps.logger!.info).toHaveBeenCalledWith(expect.stringContaining("promise dedupe removed=2"));
  });

  it("decisions.dedupe 에러 → error 로그", async () => {
    const deps = make_deps({
      decisions: {
        dedupe_decisions: vi.fn().mockRejectedValue(new Error("dedupe error")),
      } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const [, , , dedupe_tick] = get_cron_callbacks(deps);
    await dedupe_tick();

    expect(deps.logger!.error).toHaveBeenCalledWith(expect.stringContaining("decision dedupe failed"));
  });
});

describe("OpsRuntimeService — secret_prune_tick (cron callback)", () => {
  it("running=false → prune 스킵", async () => {
    const secret_vault = { prune_expired: vi.fn().mockResolvedValue(0) };
    const deps = make_deps({ secret_vault: secret_vault as any });
    const svc = new OpsRuntimeService(deps);
    await svc.start();
    await svc.stop();

    const [, , , , prune_tick] = get_cron_callbacks(deps);
    await prune_tick();

    expect(secret_vault.prune_expired).not.toHaveBeenCalled();
  });

  it("secret_vault + removed > 0 → info 로그", async () => {
    const secret_vault = { prune_expired: vi.fn().mockResolvedValue(4) };
    const deps = make_deps({ secret_vault: secret_vault as any });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const [, , , , prune_tick] = get_cron_callbacks(deps);
    await prune_tick();

    expect(deps.logger!.info).toHaveBeenCalledWith(expect.stringContaining("secret prune removed=4"));
  });

  it("session_store.prune_expired + dlq.prune_older_than → 모두 호출", async () => {
    const deps = make_deps({
      secret_vault: { prune_expired: vi.fn().mockResolvedValue(0) } as any,
      session_store: { prune_expired: vi.fn().mockResolvedValue(2) } as any,
      dlq: { prune_older_than: vi.fn().mockResolvedValue(1) } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const [, , , , prune_tick] = get_cron_callbacks(deps);
    await prune_tick();

    expect((deps.session_store as any).prune_expired).toHaveBeenCalled();
    expect((deps.dlq as any).prune_older_than).toHaveBeenCalled();
    expect(deps.logger!.info).toHaveBeenCalledWith(expect.stringContaining("session prune removed=2"));
    expect(deps.logger!.info).toHaveBeenCalledWith(expect.stringContaining("dlq prune removed=1"));
  });

  it("secret_vault.prune_expired 에러 → error 로그", async () => {
    const deps = make_deps({
      secret_vault: { prune_expired: vi.fn().mockRejectedValue(new Error("vault error")) } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const [, , , , prune_tick] = get_cron_callbacks(deps);
    await prune_tick();

    expect(deps.logger!.error).toHaveBeenCalledWith(expect.stringContaining("secret prune failed"));
  });
});
