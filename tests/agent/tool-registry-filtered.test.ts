/**
 * D0-3: ToolRegistry.filtered() — allowed_tools 기반 필터링 검증.
 */
import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../src/agent/tools/registry.js";
import type { ToolLike } from "../../src/agent/tools/base.js";

function stub_tool(name: string): ToolLike {
  return {
    name,
    description: `${name} tool`,
    category: "test",
    policy_flags: { write: false, network: false },
    parameters: { type: "object", properties: {} },
    to_schema() { return { name: this.name, description: this.description, parameters: this.parameters }; },
    validate_params() { return []; },
    async execute() { return `${name}_result`; },
  };
}

describe("ToolRegistry.filtered()", () => {
  it("get_definitions는 허용된 도구만 반환한다", () => {
    const reg = new ToolRegistry();
    reg.register(stub_tool("alpha"));
    reg.register(stub_tool("beta"));
    reg.register(stub_tool("gamma"));

    const filtered = reg.filtered(["alpha", "gamma"]);
    const defs = filtered.get_definitions();
    const names = defs.map((d) => (d as Record<string, unknown>).name);

    expect(names).toEqual(["alpha", "gamma"]);
  });

  it("tool_names는 허용된 도구만 반환한다", () => {
    const reg = new ToolRegistry();
    reg.register(stub_tool("a"));
    reg.register(stub_tool("b"));
    reg.register(stub_tool("c"));

    const filtered = reg.filtered(["b"]);
    expect(filtered.tool_names()).toEqual(["b"]);
  });

  it("허용된 도구는 정상 실행된다", async () => {
    const reg = new ToolRegistry();
    reg.register(stub_tool("allowed_tool"));
    reg.register(stub_tool("blocked_tool"));

    const filtered = reg.filtered(["allowed_tool"]);
    const result = await filtered.execute("allowed_tool", {});
    expect(result).toBe("allowed_tool_result");
  });

  it("비허용 도구 실행은 에러 메시지를 반환한다", async () => {
    const reg = new ToolRegistry();
    reg.register(stub_tool("allowed_tool"));
    reg.register(stub_tool("blocked_tool"));

    const filtered = reg.filtered(["allowed_tool"]);
    const result = await filtered.execute("blocked_tool", {});
    expect(result).toContain("Error");
    expect(result).toContain("not allowed");
    expect(result).toContain("allowed_tool");
  });

  it("빈 allowlist면 모든 도구가 차단된다", async () => {
    const reg = new ToolRegistry();
    reg.register(stub_tool("any_tool"));

    const filtered = reg.filtered([]);
    expect(filtered.get_definitions()).toEqual([]);
    expect(filtered.tool_names()).toEqual([]);
    const result = await filtered.execute("any_tool", {});
    expect(result).toContain("not allowed");
  });
});
