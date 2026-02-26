import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DashboardService } from "../src/dashboard/service.ts";

function listen_ephemeral(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const addr = server.address();
      if (!addr || typeof addr !== "object") {
        reject(new Error("address_unavailable"));
        return;
      }
      resolve(Number(addr.port || 0));
    });
  });
}

test("dashboard falls back to ephemeral port when configured port is unavailable", async () => {
  const occupied = createServer();
  const workspace = await mkdtemp(join(tmpdir(), "dashboard-fallback-test-"));
  const occupied_port = await listen_ephemeral(occupied);

  const dashboard = new DashboardService({
    host: "127.0.0.1",
    port: occupied_port,
    workspace,
    assets_dir: join(workspace, "dashboard-assets"),
    agent: {
      list_runtime_tasks: () => [],
      list_stored_tasks: async () => [],
      list_subagents: () => [],
    } as never,
    bus: {
      get_sizes: () => ({ inbound: 0, outbound: 0 }),
      peek: () => [],
    } as never,
    channels: {
      get_status: () => ({ enabled_channels: [], mention_loop_running: false, running: false, dispatch_running: false }),
    } as never,
    heartbeat: {
      status: () => ({}),
    } as never,
    ops: {
      status: () => ({}),
    } as never,
    decisions: {
      get_effective_decisions: async () => [],
    } as never,
    events: {
      list: async () => [],
    } as never,
  });

  try {
    await dashboard.start();
    const url = dashboard.get_url();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(url.endsWith(`:${occupied_port}`), false);
  } finally {
    await dashboard.stop();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
});

