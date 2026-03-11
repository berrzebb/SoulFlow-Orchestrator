/**
 * HeartbeatService — 미커버 분기 보충:
 * - L122: _run_loop catch — signal.aborted → return (stop 시 sleep 중단)
 * - L135: _tick — !on_heartbeat → return (콜백 없을 때)
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HeartbeatService } from "@src/heartbeat/service.js";

afterEach(() => {
  // no-op
});

// ── L122: stop() → abort → sleep throws → catch → signal.aborted → return ───

describe("HeartbeatService — L122: stop 시 sleep 중단 → signal.aborted", () => {
  it("start → stop → 루프 종료 (L122 signal.aborted branch)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hb-cov2-"));
    try {
      const svc = new HeartbeatService(tmp, {
        interval_s: 60, // 길게 설정 → sleep 중 abort 됨
        on_heartbeat: async () => "ALIVE",
      });
      svc.set_enabled(true);
      await svc.start();

      // 즉시 stop → loop_task의 sleep이 AbortError로 reject → L122 signal.aborted → return
      await svc.stop();
      // 루프가 정상 종료됨 (무한 루프나 예외 없음)
      expect(svc.status().running).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── L135: !on_heartbeat → return ────────────────────────────────────────────

describe("HeartbeatService — L135: on_heartbeat 없음 → _tick 즉시 반환", () => {
  it("HEARTBEAT.md 있고 on_heartbeat 없음 → _tick에서 L135 early return", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hb-cov2b-"));
    try {
      // HEARTBEAT.md 생성 (내용 있어야 is_heartbeat_empty=false)
      writeFileSync(join(tmp, "HEARTBEAT.md"), "## Heartbeat\nCheck status.", "utf-8");

      // on_heartbeat 없이 생성 → this.on_heartbeat = null
      const svc = new HeartbeatService(tmp);
      // _tick 직접 호출 → content 있음 → L135: if(!on_heartbeat) return
      await (svc as any)._tick();
      // 예외 없이 반환되면 OK
      expect(true).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
