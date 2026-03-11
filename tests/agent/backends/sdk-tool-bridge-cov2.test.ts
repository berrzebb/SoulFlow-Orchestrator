/**
 * sdk-tool-bridge.ts — 미커버 분기 보충:
 * - L55: create_server() 예외 → catch → null 반환
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  // createSdkMcpServer가 throw → catch → L55 null 반환
  createSdkMcpServer: vi.fn(() => { throw new Error("sdk server error"); }),
  tool: vi.fn((_name: string, _desc: string, _schema: unknown, fn: unknown) => ({ fn })),
}));
vi.mock("zod", () => ({
  z: { object: vi.fn(() => ({})), string: vi.fn(() => ({})), unknown: vi.fn(() => ({})) },
}));

import { create_sdk_tool_server } from "@src/agent/backends/sdk-tool-bridge.js";
import type { ToolLike } from "@src/agent/tools/types.js";

function make_tool(): ToolLike {
  return {
    name: "test_tool",
    description: "test",
    parameters: { type: "object", properties: { input: { type: "string" } }, required: [] },
    async execute() { return "ok"; },
    to_schema() { return { name: "test_tool", description: "test", input_schema: { type: "object" as const, properties: {} } }; },
    validate_params() { return []; },
    categories: [],
  } as unknown as ToolLike;
}

describe("create_sdk_tool_server — L55: createSdkMcpServer 예외 → null 반환", () => {
  it("createSdkMcpServer가 throw → catch → null (L55)", async () => {
    const result = await create_sdk_tool_server("test", [make_tool()]);
    expect(result).toBeNull();
  });
});
