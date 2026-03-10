/**
 * network_handler — ip/dns catch 분기 커버 (L49, L62).
 * IpTool / DnsTool을 mock해서 throw → catch 경로 검증.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/agent/tools/ip.js", () => ({
  IpTool: class {
    async execute() { throw new Error("ip tool error"); }
  },
}));

vi.mock("../../../src/agent/tools/dns.js", () => ({
  DnsTool: class {
    async execute() { throw new Error("dns tool error"); }
  },
}));

import { network_handler } from "../../../src/agent/nodes/network.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

const ctx: OrcheNodeExecutorContext = { memory: {}, workspace: "/tmp", abort_signal: undefined };

describe("network_handler — ip/dns catch 분기", () => {
  it("ip 작업에서 IpTool throw → L49 catch → success: false", async () => {
    const node = { node_id: "n1", node_type: "network", operation: "ip", host: "1.2.3.4" } as any;
    const result = await network_handler.execute(node, ctx);
    expect((result.output as any).success).toBe(false);
    expect((result.output as any).output).toContain("ip tool error");
  });

  it("dns 작업에서 DnsTool throw → L62 catch → success: false", async () => {
    const node = { node_id: "n1", node_type: "network", operation: "dns", host: "example.com" } as any;
    const result = await network_handler.execute(node, ctx);
    expect((result.output as any).success).toBe(false);
    expect((result.output as any).output).toContain("dns tool error");
  });
});
