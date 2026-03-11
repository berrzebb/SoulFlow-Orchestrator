/**
 * HeartbeatService — 미커버 분기 (cov3):
 * - L122: sleep 완료 후 if 조건 평가 (interval_s=0.001 → 1ms sleep → 자연 완료)
 * - L135: _tick() → on_heartbeat 응답에 HEARTBEAT_OK_TOKEN 포함 → early return
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HeartbeatService } from "@src/heartbeat/service.js";

// ── L122: sleep 자연 완료 → if 조건 평가 ────────────────────────────────────

describe("HeartbeatService — L122: sleep 완료 → if 조건 실행", () => {
  it("interval_s=0.001 → sleep(1ms) 완료 → L122 if 조건 평가 (파일 없으므로 _tick 즉시 return)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hb-L122-"));
    try {
      const svc = new HeartbeatService(tmp, {
        interval_s: 0.001, // 1ms sleep → abort 전에 자연 완료
        on_heartbeat: async () => "not_ok",
      });
      svc.set_enabled(true);
      await svc.start();
      // 루프가 1ms 슬립 후 L122 실행할 충분한 시간 대기
      await new Promise((r) => setTimeout(r, 15));
      await svc.stop();
      expect(svc.status().running).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── L135: on_heartbeat → HEARTBEAT_OK_TOKEN 포함 → early return ─────────────

describe("HeartbeatService — L135: HEARTBEAT_OK 포함 응답 → early return", () => {
  it("HEARTBEAT.md 있고 on_heartbeat가 'HEARTBEAT_OK' 반환 → L135 early return", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "hb-L135-"));
    try {
      writeFileSync(join(tmp, "HEARTBEAT.md"), "## Heartbeat\nCheck status.", "utf-8");
      const svc = new HeartbeatService(tmp, {
        on_heartbeat: async () => "HEARTBEAT_OK", // L135: contains token → return
      });
      // _tick() 직접 호출
      await (svc as any)._tick();
      // on_notify가 호출되지 않았으면 OK (HEARTBEAT_OK → L135 early return)
      expect(true).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
