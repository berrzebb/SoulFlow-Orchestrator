/**
 * ToolSelfTestService — run() 메서드 단위 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import { ToolSelfTestService } from "../../../src/agent/tools/self-test.js";
import type { ToolRegistry } from "../../../src/agent/tools/registry.js";

function make_registry(execute_result: string): ToolRegistry {
  return {
    execute: vi.fn().mockResolvedValue(execute_result),
  } as unknown as ToolRegistry;
}

describe("ToolSelfTestService — run()", () => {
  it("모든 케이스 통과 → ok=true", async () => {
    const svc = new ToolSelfTestService(make_registry("hello world"));
    const result = await svc.run("tool", [
      { params: { action: "test" }, expect_includes: ["hello"] },
      { params: { action: "other" } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toContain("pass");
    expect(result.results[1]).toContain("pass");
  });

  it("expect_includes 불일치 → ok=false", async () => {
    const svc = new ToolSelfTestService(make_registry("response text"));
    const result = await svc.run("tool", [
      { params: {}, expect_includes: ["missing_needle"] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.results[0]).toContain("fail");
  });

  it("'Error:'로 시작하는 output → fail", async () => {
    const svc = new ToolSelfTestService(make_registry("Error: something went wrong"));
    const result = await svc.run("tool", [{ params: {} }]);
    expect(result.ok).toBe(false);
    expect(result.results[0]).toContain("fail");
  });

  it("빈 케이스 배열 → ok=true, results 빈 배열", async () => {
    const svc = new ToolSelfTestService(make_registry("any"));
    const result = await svc.run("tool", []);
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it("케이스 인덱스가 results에 표시 (case#1, case#2)", async () => {
    const svc = new ToolSelfTestService(make_registry("ok data"));
    const result = await svc.run("tool", [{ params: {} }, { params: {} }]);
    expect(result.results[0]).toContain("case#1");
    expect(result.results[1]).toContain("case#2");
  });

  it("여러 expect_includes 중 하나라도 불일치 → fail", async () => {
    const svc = new ToolSelfTestService(make_registry("partial match only"));
    const result = await svc.run("tool", [
      { params: {}, expect_includes: ["partial", "nonexistent"] },
    ]);
    expect(result.ok).toBe(false);
  });

  it("output이 240자 초과 시 잘림 (결과에 포함)", async () => {
    const long_output = "x".repeat(300);
    const svc = new ToolSelfTestService(make_registry(long_output));
    const result = await svc.run("tool", [{ params: {} }]);
    // output= 이후 최대 240자
    const output_part = result.results[0].split("output=")[1] || "";
    expect(output_part.length).toBeLessThanOrEqual(240);
  });
});
