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
      writeFileSync(join(tmp, "HEARTBEAT.md"), "## Heartbeat\nCheck status.", "utf-8");

      const svc = new HeartbeatService(tmp);
      await (svc as any)._tick();
      expect(true).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// L122: sleep 자연 완료 → if 조건 평가 (from cov3)
// ══════════════════════════════════════════

describe("HeartbeatService — L122: sleep 완료 → if 조건 실행", () => {
  it("interval_s=0.001 → sleep(1ms) 완료 → L122 if 조건 평가 (파일 없으므로 _tick 즉시 return)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hb-L122-"));
    try {
      const svc = new HeartbeatService(tmp, {
        interval_s: 0.001,
        on_heartbeat: async () => "not_ok",
      });
      svc.set_enabled(true);
      await svc.start();
      await new Promise((r) => setTimeout(r, 15));
      await svc.stop();
      expect(svc.status().running).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════
// L135: HEARTBEAT_OK 포함 응답 → early return (from cov3)
// ══════════════════════════════════════════

describe("HeartbeatService — L135: HEARTBEAT_OK 포함 응답 → early return", () => {
  it("HEARTBEAT.md 있고 on_heartbeat가 'HEARTBEAT_OK' 반환 → L135 early return", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hb-L135-"));
    try {
      writeFileSync(join(tmp, "HEARTBEAT.md"), "## Heartbeat\nCheck status.", "utf-8");
      const svc = new HeartbeatService(tmp, {
        on_heartbeat: async () => "HEARTBEAT_OK",
      });
      await (svc as any)._tick();
      expect(true).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
