/**
 * OpsRuntimeService — 미커버 분기 (cov3):
 * - L51: startup_changelog → if (this.status_state.startup_logged) return (멱등성 가드)
 *
 * start()에서 startup_changelog를 한 번 호출하면 startup_logged=true로 설정됨.
 * 이후 startup_changelog를 다시 직접 호출하면 L51 early return이 실행됨.
 */
import { describe, it, expect, vi } from "vitest";
import { OpsRuntimeService } from "@src/ops/service.js";
import type { OpsRuntimeDeps } from "@src/ops/types.js";

function make_deps(): OpsRuntimeDeps {
  return {
    bus: {
      get_sizes: vi.fn().mockReturnValue({ inbound: 0, outbound: 0 }),
      consume_inbound: vi.fn().mockResolvedValue(null),
    } as any,
    channels: {
      get_status: vi.fn().mockReturnValue({ enabled_channels: [], mention_loop_running: false }),
    } as any,
    cron: { every: vi.fn() } as any,
    heartbeat: { status: vi.fn().mockReturnValue({ enabled: false }) } as any,
    decisions: { dedupe_decisions: vi.fn().mockResolvedValue({ removed: 0, active: 0 }) } as any,
    logger: {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    } as any,
  };
}

// ── L51: startup_changelog 멱등성 가드 ────────────────────────────────────────

describe("OpsRuntimeService — L51: startup_changelog 멱등성 가드", () => {
  it("start() 후 startup_changelog 재호출 → L51 early return → logger.info 한 번만 호출", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps);
    await svc.start();

    // start()가 내부적으로 startup_changelog()를 한 번 호출함 → startup_logged=true
    const first_info_count = (deps.logger!.info as ReturnType<typeof vi.fn>).mock.calls.length;

    // 두 번째 호출 → L51: startup_logged=true → early return
    await (svc as any).startup_changelog();

    const second_info_count = (deps.logger!.info as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(second_info_count).toBe(first_info_count); // 추가 로그 없음
    expect((svc as any).status_state.startup_logged).toBe(true);

    await svc.stop();
  });

  it("startup_logged=true 직접 설정 후 startup_changelog → L51 early return", async () => {
    const deps = make_deps();
    const svc = new OpsRuntimeService(deps);

    // 직접 상태 조작
    (svc as any).status_state.startup_logged = true;

    // L51 가드 실행
    await (svc as any).startup_changelog();

    // logger.info가 호출되지 않아야 함
    expect(deps.logger!.info).not.toHaveBeenCalled();
  });
});
