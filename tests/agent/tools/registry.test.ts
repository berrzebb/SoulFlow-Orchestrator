/**
 * ToolRegistry — register/unregister/get/execute/filtered 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../../src/agent/tools/registry.js";
import type { ToolLike, ToolSchema, ToolCategory } from "../../../src/agent/tools/types.js";

function make_mock_tool(name: string, category: ToolCategory = "memory"): ToolLike {
  return {
    name,
    description: `Mock ${name}`,
    category,
    parameters: { type: "object", properties: {} },
    execute: vi.fn().mockResolvedValue(`${name} result`),
    validate_params: vi.fn().mockReturnValue([]),
    to_schema: () => ({ type: "function", function: { name, description: `Mock ${name}`, parameters: { type: "object", properties: {} } } }) as ToolSchema,
  } as unknown as ToolLike;
}

describe("ToolRegistry", () => {
  it("register + get: 도구 등록 및 조회", () => {
    const reg = new ToolRegistry();
    const tool = make_mock_tool("test_tool");
    reg.register(tool);
    expect(reg.get("test_tool")).toBe(tool);
    expect(reg.has("test_tool")).toBe(true);
  });

  it("get: 미등록 도구 → null", () => {
    const reg = new ToolRegistry();
    expect(reg.get("nonexistent")).toBeNull();
  });

  it("unregister: 도구 제거", () => {
    const reg = new ToolRegistry();
    reg.register(make_mock_tool("rm_tool"));
    reg.unregister("rm_tool");
    expect(reg.has("rm_tool")).toBe(false);
  });

  it("tool_names: 등록된 도구 이름 목록", () => {
    const reg = new ToolRegistry();
    reg.register(make_mock_tool("a"));
    reg.register(make_mock_tool("b"));
    expect(reg.tool_names().sort()).toEqual(["a", "b"]);
  });

  it("get_all: 모든 도구 인스턴스 반환", () => {
    const reg = new ToolRegistry();
    reg.register(make_mock_tool("x"));
    reg.register(make_mock_tool("y"));
    expect(reg.get_all().length).toBe(2);
  });

  it("get_definitions: ToolSchema 배열 반환", () => {
    const reg = new ToolRegistry();
    reg.register(make_mock_tool("def_tool"));
    const defs = reg.get_definitions();
    expect(defs.length).toBe(1);
    expect((defs[0] as Record<string, unknown>).type).toBe("function");
  });

  it("execute: 등록된 도구 실행", async () => {
    const reg = new ToolRegistry();
    const tool = make_mock_tool("exec_tool");
    reg.register(tool);
    const result = await reg.execute("exec_tool", {});
    expect(result).toBe("exec_tool result");
  });

  it("execute: 미등록 도구 → 에러 메시지", async () => {
    const reg = new ToolRegistry();
    const result = await reg.execute("missing", {});
    expect(result).toContain("not found");
  });

  it("execute: validate 실패 → 에러 메시지", async () => {
    const reg = new ToolRegistry();
    const tool = make_mock_tool("val_tool");
    (tool.validate_params as ReturnType<typeof vi.fn>).mockReturnValue(["missing field"]);
    reg.register(tool);
    const result = await reg.execute("val_tool", {});
    expect(result).toContain("Invalid parameters");
  });

  it("filtered: allowlist 기반 필터링", () => {
    const reg = new ToolRegistry();
    reg.register(make_mock_tool("allowed"));
    reg.register(make_mock_tool("blocked"));
    const filtered = reg.filtered(["allowed"]);
    expect(filtered.tool_names()).toEqual(["allowed"]);
  });

  it("filtered execute: 차단된 도구 실행 → 에러", async () => {
    const reg = new ToolRegistry();
    reg.register(make_mock_tool("only_this"));
    const filtered = reg.filtered(["only_this"]);
    const result = await filtered.execute("other", {});
    expect(result).toContain("not allowed");
  });

  it("build_category_map: name → category 매핑", () => {
    const reg = new ToolRegistry();
    reg.register(make_mock_tool("mem_tool", "memory"));
    reg.register(make_mock_tool("data_tool", "data"));
    const map = reg.build_category_map();
    expect(map.mem_tool).toBe("memory");
    expect(map.data_tool).toBe("data");
  });

  it("set_dynamic_tools: 기존 동적 도구 교체", () => {
    const reg = new ToolRegistry();
    reg.register(make_mock_tool("static"));
    reg.set_dynamic_tools([make_mock_tool("dyn1"), make_mock_tool("dyn2")]);
    expect(reg.has("dyn1")).toBe(true);
    expect(reg.has("dyn2")).toBe(true);
    expect(reg.has("static")).toBe(true);

    reg.set_dynamic_tools([make_mock_tool("dyn3")]);
    expect(reg.has("dyn1")).toBe(false);
    expect(reg.has("dyn3")).toBe(true);
    expect(reg.has("static")).toBe(true);
  });
});
