import { describe, it, expect, vi } from "vitest";
import {
  build_executor_map,
  execute_single_tool,
  map_finish_reason,
  fire,
  accum_usage,
  emit_usage,
} from "@src/agent/backends/tool-loop-helpers.js";
import type { ToolLike, ToolExecutionContext } from "@src/agent/tools/types.js";
import type { AgentHooks, AgentEvent } from "@src/agent/agent.types.js";
import type { LlmUsage } from "@src/providers/types.js";

function make_tool(name: string, fn: (params: Record<string, unknown>) => string | Promise<string>): ToolLike {
  return {
    name,
    description: `test tool ${name}`,
    parameters: {},
    execute: (params: Record<string, unknown>) => Promise.resolve(fn(params)),
  } as ToolLike;
}

const DUMMY_CTX: ToolExecutionContext = {
  session_id: "test",
  provider: "test",
  chat_id: "test",
} as ToolExecutionContext;

describe("build_executor_map", () => {
  it("builds map from tool array", () => {
    const tools = [make_tool("a", () => ""), make_tool("b", () => "")];
    const map = build_executor_map(tools);
    expect(map.size).toBe(2);
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(true);
  });

  it("returns empty map for undefined", () => {
    expect(build_executor_map(undefined).size).toBe(0);
  });

  it("returns empty map for empty array", () => {
    expect(build_executor_map([]).size).toBe(0);
  });
});

describe("execute_single_tool", () => {
  it("executes known tool and returns result", async () => {
    const map = build_executor_map([make_tool("greet", () => "hello")]);
    const result = await execute_single_tool("greet", {}, map, DUMMY_CTX);
    expect(result.text).toBe("hello");
    expect(result.is_error).toBe(false);
  });

  it("returns error for unknown tool", async () => {
    const map = build_executor_map([]);
    const result = await execute_single_tool("unknown", {}, map, DUMMY_CTX);
    expect(result.text).toContain("tool_not_found:unknown");
    expect(result.is_error).toBe(true);
  });

  it("catches execution errors", async () => {
    const map = build_executor_map([make_tool("fail", () => { throw new Error("boom"); })]);
    const result = await execute_single_tool("fail", {}, map, DUMMY_CTX);
    expect(result.text).toContain("boom");
    expect(result.is_error).toBe(true);
  });

  it("respects pre_tool_use deny", async () => {
    const map = build_executor_map([make_tool("blocked", () => "ok")]);
    const hooks: AgentHooks = {
      pre_tool_use: async () => ({ permission: "deny" as const, reason: "nope" }),
    };
    const result = await execute_single_tool("blocked", {}, map, DUMMY_CTX, hooks);
    expect(result.text).toContain("nope");
    expect(result.is_error).toBe(true);
  });

  it("applies updated_params from pre_tool_use", async () => {
    const map = build_executor_map([make_tool("echo", (p) => String(p.msg))]);
    const hooks: AgentHooks = {
      pre_tool_use: async () => ({ permission: "allow" as const, updated_params: { msg: "modified" } }),
    };
    const result = await execute_single_tool("echo", { msg: "original" }, map, DUMMY_CTX, hooks);
    expect(result.text).toBe("modified");
  });

  it("calls post_tool_use after execution", async () => {
    const post = vi.fn();
    const map = build_executor_map([make_tool("test", () => "result")]);
    const hooks: AgentHooks = { post_tool_use: post };
    await execute_single_tool("test", { a: 1 }, map, DUMMY_CTX, hooks);
    expect(post).toHaveBeenCalledWith("test", { a: 1 }, "result", DUMMY_CTX, false);
  });
});

describe("map_finish_reason", () => {
  it("maps error to error", () => {
    expect(map_finish_reason("error")).toBe("error");
  });

  it("maps length to max_tokens", () => {
    expect(map_finish_reason("length")).toBe("max_tokens");
  });

  it("maps max_tokens to max_tokens", () => {
    expect(map_finish_reason("max_tokens")).toBe("max_tokens");
  });

  it("maps anything else to stop", () => {
    expect(map_finish_reason("stop")).toBe("stop");
    expect(map_finish_reason("end_turn")).toBe("stop");
    expect(map_finish_reason("unknown")).toBe("stop");
  });
});

describe("fire", () => {
  it("calls emit with event", () => {
    const emit = vi.fn();
    const event = { type: "text", content: "hello" } as unknown as AgentEvent;
    fire(emit, event);
    expect(emit).toHaveBeenCalledWith(event);
  });

  it("does nothing when emit is undefined", () => {
    fire(undefined, { type: "text" } as unknown as AgentEvent);
  });
});

describe("accum_usage", () => {
  it("accumulates usage values", () => {
    const acc = { input: 0, output: 0, cache_read: 0, cache_creation: 0, cost: 0 };
    const usage: LlmUsage = {
      prompt_tokens: 10,
      completion_tokens: 5,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2,
      total_cost_usd: 0.001,
    };
    accum_usage(acc, usage);
    expect(acc.input).toBe(10);
    expect(acc.output).toBe(5);
    expect(acc.cache_read).toBe(3);
    expect(acc.cache_creation).toBe(2);
    expect(acc.cost).toBe(0.001);

    accum_usage(acc, usage);
    expect(acc.input).toBe(20);
    expect(acc.output).toBe(10);
  });

  it("handles missing fields gracefully", () => {
    const acc = { input: 0, output: 0, cache_read: 0, cache_creation: 0, cost: 0 };
    accum_usage(acc, {} as LlmUsage);
    expect(acc.input).toBe(0);
    expect(acc.output).toBe(0);
  });
});

describe("emit_usage", () => {
  it("emits usage event when there are tokens", () => {
    const emit = vi.fn();
    const usage = { input: 10, output: 5, cache_read: 0, cache_creation: 0, cost: 0.01 };
    emit_usage(emit, "agent", usage);
    expect(emit).toHaveBeenCalledTimes(1);
    const event = emit.mock.calls[0][0];
    expect(event.type).toBe("usage");
    expect(event.tokens.input).toBe(10);
    expect(event.tokens.output).toBe(5);
  });

  it("does not emit when no tokens", () => {
    const emit = vi.fn();
    const usage = { input: 0, output: 0, cache_read: 0, cache_creation: 0, cost: 0 };
    emit_usage(emit, "agent", usage);
    expect(emit).not.toHaveBeenCalled();
  });

  it("omits cache fields when zero", () => {
    const emit = vi.fn();
    const usage = { input: 1, output: 1, cache_read: 0, cache_creation: 0, cost: 0 };
    emit_usage(emit, "agent", usage);
    const event = emit.mock.calls[0][0];
    expect(event.tokens.cache_read).toBeUndefined();
    expect(event.tokens.cache_creation).toBeUndefined();
    expect(event.cost_usd).toBeUndefined();
  });
});
