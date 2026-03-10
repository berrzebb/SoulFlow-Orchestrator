/**
 * OpsRuntimeService — 미커버 분기 (cov2):
 * - L75: watchdog_tick running=false → early return
 * - L91: bridge_pump_tick running=false → early return
 * - L106: decision_dedupe_tick running=false → early return
 * - L122: promises.dedupe_promises throw → error log
 * - L141: session_store.prune_expired throw → error log
 * - L149: dlq.prune_older_than throw → error log
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
      get_status: vi.fn().mockReturnValue({ enabled_channels: [], mention_loop_running: false }),
      handle_inbound_message: vi.fn().mockResolvedValue(undefined),
    } as any,
    cron: { every: vi.fn() } as any,
    heartbeat: { status: vi.fn().mockReturnValue({ enabled: false }) } as any,
    decisions: { dedupe_decisions: vi.fn().mockResolvedValue({ removed: 0, active: 0 }) } as any,
    logger: {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    } as any,
    ...overrides,
  };
}

function get_cron_callbacks(deps: OpsRuntimeDeps): Array<() => Promise<void>> {
  return (deps.cron.every as ReturnType<typeof vi.fn>).mock.calls.map(
    (call: unknown[]) => call[1] as () => Promise<void>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });

// ── running=false early return 분기 ─────────────────────────────────────

describe("OpsRuntimeService — running=false early returns", () => {
  it("stop 후 watchdog_tick → running=false → early return (L75)", async () => {
    const deps = make_deps({
      services: { health_check: vi.fn().mockResolvedValue([]) } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();
    await svc.stop();

    const [, watchdog_tick] = get_cron_callbacks(deps);
    await watchdog_tick();

    // running=false → services.health_check 호출 안 됨
    expect(deps.services!.health_check).not.toHaveBeenCalled();
  });

  it("stop 후 bridge_pump_tick → running=false → early return (L91)", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps, { bridgePumpEnabled: true });
    await svc.start();
    await svc.stop();

    const [, , bridge_pump_tick] = get_cron_callbacks(deps);
    await bridge_pump_tick();

    // running=false → bus.consume_inbound 호출 안 됨
    expect(deps.bus.consume_inbound).not.toHaveBeenCalled();
  });

  it("stop 후 decision_dedupe_tick → running=false → early return (L106)", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps);
    await svc.start();
    await svc.stop();

    const [, , , decision_tick] = get_cron_callbacks(deps);
    await decision_tick();

    // running=false → decisions.dedupe_decisions 호출 안 됨
    expect(deps.decisions.dedupe_decisions).not.toHaveBeenCalled();
  });
});

// ── 에러 핸들러 분기 ─────────────────────────────────────────────────────

describe("OpsRuntimeService — promises.dedupe throw (L122)", () => {
  it("promises.dedupe_promises throw → error 로그", async () => {
    const deps = make_deps({
      promises: {
        dedupe_promises: vi.fn().mockRejectedValue(new Error("promise db error")),
      } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const [, , , decision_tick] = get_cron_callbacks(deps);
    await decision_tick();

    expect(deps.logger!.error).toHaveBeenCalledWith(
      expect.stringContaining("promise dedupe failed"),
    );
  });
});

describe("OpsRuntimeService — session_store.prune_expired throw (L141)", () => {
  it("session_store.prune_expired throw → error 로그", async () => {
    const deps = make_deps({
      secret_vault: { prune_expired: vi.fn().mockResolvedValue(0) } as any,
      session_store: {
        prune_expired: vi.fn().mockRejectedValue(new Error("session prune error")),
      } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    // secret_prune_tick은 5번째 콜백 (0-indexed: 4)
    const callbacks = get_cron_callbacks(deps);
    const secret_prune_tick = callbacks[4];
    await secret_prune_tick();

    expect(deps.logger!.error).toHaveBeenCalledWith(
      expect.stringContaining("session prune failed"),
    );
  });
});

describe("OpsRuntimeService — dlq.prune_older_than throw (L149)", () => {
  it("dlq.prune_older_than throw → error 로그", async () => {
    const deps = make_deps({
      secret_vault: { prune_expired: vi.fn().mockResolvedValue(0) } as any,
      dlq: {
        prune_older_than: vi.fn().mockRejectedValue(new Error("dlq prune error")),
      } as any,
    });
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    const callbacks = get_cron_callbacks(deps);
    const secret_prune_tick = callbacks[4];
    await secret_prune_tick();

    expect(deps.logger!.error).toHaveBeenCalledWith(
      expect.stringContaining("dlq prune failed"),
    );
  });
});
