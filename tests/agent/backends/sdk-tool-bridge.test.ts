/**
 * sdk-tool-bridge — create_sdk_tool_server 커버리지:
 * - tools=[] → null 반환 (early return)
 * - SDK 미설치 (import 실패) → null 반환 (catch)
 * - createSdkMcpServer / tool 미존재 → null 반환
 * - 정상 경로: 도구 실행, 에러 처리, json_schema_to_zod_shape 분기
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// sdk-tool-bridge는 동적 import를 사용하므로 모듈 레벨 mock 필요
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: vi.fn((opts: { name: string; tools: unknown[] }) => ({
    type: "in-process",
    name: opts.name,
    tools: opts.tools,
  })),
  tool: vi.fn((name: string, desc: string, _schema: unknown, handler: unknown) => ({
    name,
    desc,
    handler,
  })),
}));

import { create_sdk_tool_server } from "@src/agent/backends/sdk-tool-bridge.js";
import type { ToolLike } from "@src/agent/tools/types.js";

function make_tool(overrides: Partial<ToolLike> = {}): ToolLike {
  return {
    name: "test_tool",
    description: "A test tool",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "Input value" },
      },
      required: ["input"],
    },
    execute: vi.fn().mockResolvedValue("tool result"),
    ...overrides,
  } as unknown as ToolLike;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════
// 빈 도구 배열 → null 반환 (L23)
// ══════════════════════════════════════════════════════════

describe("create_sdk_tool_server — tools=[] (L23)", () => {
  it("tools 배열이 비어있으면 null 반환", async () => {
    const result = await create_sdk_tool_server("my-server", []);
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════
// 정상 경로 — createSdkMcpServer 반환값 전달
// ══════════════════════════════════════════════════════════

describe("create_sdk_tool_server — 정상 경로", () => {
  it("tool 1개 → createSdkMcpServer 호출 후 설정 반환", async () => {
    const tool = make_tool();
    const result = await create_sdk_tool_server("test-server", [tool]);

    expect(result).not.toBeNull();
    // createSdkMcpServer 반환값이 전달됨
    expect((result as Record<string, unknown>).name).toBe("test-server");
  });

  it("tool execute 성공 → content[0].text에 결과 포함", async () => {
    const execute_fn = vi.fn().mockResolvedValue("hello from tool");
    const tool = make_tool({ execute: execute_fn });

    await create_sdk_tool_server("test-server", [tool]);

    // SDK tool() 호출 시 handler 함수가 등록됨
    const { tool: sdk_tool_fn } = await import("@anthropic-ai/claude-agent-sdk");
    expect(sdk_tool_fn).toHaveBeenCalledWith(
      "test_tool",
      "A test tool",
      expect.any(Object),
      expect.any(Function),
    );

    // handler 직접 호출하여 동작 검증
    const handler = (vi.mocked(sdk_tool_fn).mock.calls[0][3]) as (args: Record<string, unknown>) => Promise<unknown>;
    const res = await handler({ input: "test" });
    expect((res as any).content[0].text).toBe("hello from tool");
    expect(execute_fn).toHaveBeenCalledWith({ input: "test" }, undefined);
  });

  it("tool execute 결과가 객체이면 JSON.stringify됨", async () => {
    const tool = make_tool({ execute: vi.fn().mockResolvedValue({ key: "value" }) });

    await create_sdk_tool_server("test-server", [tool]);

    const { tool: sdk_tool_fn } = await import("@anthropic-ai/claude-agent-sdk");
    const handler = (vi.mocked(sdk_tool_fn).mock.calls[0][3]) as (args: Record<string, unknown>) => Promise<unknown>;
    const res = await handler({});
    expect((res as any).content[0].text).toBe('{"key":"value"}');
  });

  it("tool execute 에러 → isError:true + Error 메시지 반환", async () => {
    const tool = make_tool({ execute: vi.fn().mockRejectedValue(new Error("tool failed")) });

    await create_sdk_tool_server("test-server", [tool]);

    const { tool: sdk_tool_fn } = await import("@anthropic-ai/claude-agent-sdk");
    const handler = (vi.mocked(sdk_tool_fn).mock.calls[0][3]) as (args: Record<string, unknown>) => Promise<unknown>;
    const res = await handler({});
    expect((res as any).isError).toBe(true);
    expect((res as any).content[0].text).toContain("tool failed");
  });

  it("context 전달 → execute에 context 포함됨", async () => {
    const execute_fn = vi.fn().mockResolvedValue("ok");
    const tool = make_tool({ execute: execute_fn });
    const ctx = { workspace: "/tmp", channel: "slack", chat_id: "C1" } as any;

    await create_sdk_tool_server("test-server", [tool], ctx);

    const { tool: sdk_tool_fn } = await import("@anthropic-ai/claude-agent-sdk");
    const handler = (vi.mocked(sdk_tool_fn).mock.calls[0][3]) as (args: Record<string, unknown>) => Promise<unknown>;
    await handler({ input: "x" });
    expect(execute_fn).toHaveBeenCalledWith({ input: "x" }, ctx);
  });
});

// ══════════════════════════════════════════════════════════
// json_schema_to_zod_shape 분기 (간접 커버)
// ══════════════════════════════════════════════════════════

describe("create_sdk_tool_server — json_schema_to_zod_shape 분기", () => {
  it("parameters에 다양한 타입 → number/boolean/array/object/unknown 분기 커버", async () => {
    const tool = make_tool({
      parameters: {
        type: "object",
        properties: {
          num: { type: "number", description: "A number" },
          int: { type: "integer" },
          flag: { type: "boolean" },
          list: { type: "array", items: { type: "string" } },
          nested: { type: "object", properties: { x: { type: "string" } } },
          plain_obj: { type: "object" },           // properties 없음 → z.record
          list_no_items: { type: "array" },         // items 없음 → z.unknown()
          unknown_type: { type: "null" as any },    // default branch → z.unknown()
          enumed: { type: "string", enum: ["a", "b"] },  // enum branch
        },
        required: ["num", "flag"],
      },
    });

    // 에러 없이 완료되면 성공 (zod shape 생성)
    const result = await create_sdk_tool_server("schema-test", [tool]);
    expect(result).not.toBeNull();
  });

  it("description 없는 prop → base.describe() 미호출 분기", async () => {
    const tool = make_tool({
      parameters: {
        type: "object",
        properties: {
          no_desc: { type: "string" },  // description 없음 → prop.description falsy → 그냥 base 반환
        },
        required: [],
      },
    });

    const result = await create_sdk_tool_server("no-desc-test", [tool]);
    expect(result).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════
// SDK import 실패 → catch → null 반환 (L54-56)
// ══════════════════════════════════════════════════════════

describe("create_sdk_tool_server — SDK import 실패 (L54-56)", () => {
  it("createSdkMcpServer 없음 → null 반환", async () => {
    // SDK mock에서 createSdkMcpServer를 undefined로 반환
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const original = (sdk as any).createSdkMcpServer;
    (sdk as any).createSdkMcpServer = undefined;

    try {
      const tool = make_tool();
      const result = await create_sdk_tool_server("test-server", [tool]);
      expect(result).toBeNull();
    } finally {
      (sdk as any).createSdkMcpServer = original;
    }
  });
});
