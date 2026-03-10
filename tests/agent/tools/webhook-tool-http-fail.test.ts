/**
 * WebhookTool — start_server() 실패 경로 테스트 (vi.mock으로 node:http 대체).
 * L63: try { await this.start_server(); } catch (err) { return `Error: ...`; }
 */
import { describe, it, expect, vi } from "vitest";

// ── node:http mock ────────────────────────────────────

const { http_state } = vi.hoisted(() => {
  const state = { fail: false };
  return { http_state: state };
});

vi.mock("node:http", () => ({
  createServer: (_handler: unknown) => {
    const emitters: Record<string, ((...a: unknown[]) => void)[]> = {};
    const server = {
      listen: (_port: number, cb?: () => void) => {
        Promise.resolve().then(() => {
          if (http_state.fail) {
            (emitters["error"] || []).forEach(fn => fn(new Error("EADDRINUSE")));
          } else {
            if (cb) cb();
          }
        });
        return server;
      },
      on: (event: string, fn: (...a: unknown[]) => void) => {
        (emitters[event] ||= []).push(fn);
        return server;
      },
      address: () => ({ port: 9999 }),
      close: () => {},
    };
    return server;
  },
}));

// ── import after mock ──────────────────────────────────

const { WebhookTool } = await import("@src/agent/tools/webhook.js");

// ══════════════════════════════════════════
// L63: start_server catch
// ══════════════════════════════════════════

describe("WebhookTool — L63 start_server catch", () => {
  it("서버 시작 실패(EADDRINUSE) → L63 Error 반환", async () => {
    http_state.fail = true;
    const tool = new WebhookTool();
    const r = await tool.execute({ action: "register", path: "/hooks/fail" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("EADDRINUSE");
  });

  it("서버 시작 성공 → id/port 포함 JSON 반환", async () => {
    http_state.fail = false;
    const tool = new WebhookTool();
    const r = JSON.parse(await tool.execute({ action: "register", path: "/hooks/ok" }));
    expect(r.id).toMatch(/^wh_/);
    expect(r.port).toBe(9999);
  });
});
