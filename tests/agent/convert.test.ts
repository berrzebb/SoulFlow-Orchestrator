import { describe, it, expect } from "vitest";
import {
  agent_options_to_chat,
  llm_response_to_agent_result,
  sandbox_to_sdk_permission,
  sandbox_to_codex_policy,
  sdk_result_subtype_to_finish_reason,
  effort_to_codex,
} from "@src/agent/backends/convert.js";
import type { AgentRunOptions } from "@src/agent/agent.types.js";
import type { LlmResponse, SandboxPolicy } from "@src/providers/types.js";

describe("agent_options_to_chat", () => {
  it("creates user message from task", () => {
    const opts = { task: "hello" } as AgentRunOptions;
    const { messages } = agent_options_to_chat(opts);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ role: "user", content: "hello" });
  });

  it("prepends system message when system_prompt provided", () => {
    const opts = { task: "hello", system_prompt: "you are helpful" } as AgentRunOptions;
    const { messages } = agent_options_to_chat(opts);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: "you are helpful" });
    expect(messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("passes through chat_options fields", () => {
    const opts = {
      task: "test",
      model: "gpt-4",
      max_tokens: 100,
      temperature: 0.5,
      effort: "high",
    } as AgentRunOptions;
    const { chat_options } = agent_options_to_chat(opts);
    expect(chat_options.model).toBe("gpt-4");
    expect(chat_options.max_tokens).toBe(100);
    expect(chat_options.temperature).toBe(0.5);
    expect(chat_options.effort).toBe("high");
  });
});

describe("llm_response_to_agent_result", () => {
  const base_response: LlmResponse = {
    content: "done",
    tool_calls: [],
    has_tool_calls: false,
    finish_reason: "stop",
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    metadata: {},
  };

  it("maps stop finish_reason", () => {
    const result = llm_response_to_agent_result(base_response, "chatgpt");
    expect(result.finish_reason).toBe("stop");
    expect(result.content).toBe("done");
    expect(result.tool_calls_count).toBe(0);
  });

  it("maps error finish_reason", () => {
    const result = llm_response_to_agent_result(
      { ...base_response, finish_reason: "error" },
      "chatgpt",
    );
    expect(result.finish_reason).toBe("error");
  });

  it("maps length/max_tokens finish_reason", () => {
    expect(llm_response_to_agent_result(
      { ...base_response, finish_reason: "length" }, "chatgpt",
    ).finish_reason).toBe("max_tokens");

    expect(llm_response_to_agent_result(
      { ...base_response, finish_reason: "max_tokens" }, "chatgpt",
    ).finish_reason).toBe("max_tokens");
  });

  it("extracts session from metadata", () => {
    const result = llm_response_to_agent_result(
      { ...base_response, metadata: { session_id: "abc" } },
      "claude_code",
    );
    expect(result.session).not.toBeNull();
    expect(result.session!.session_id).toBe("abc");
    expect(result.session!.backend).toBe("claude_code");
  });

  it("returns null session when no session_id", () => {
    const result = llm_response_to_agent_result(base_response, "chatgpt");
    expect(result.session).toBeNull();
  });

  it("includes raw_tool_calls when has_tool_calls", () => {
    const tc = [{ id: "1", type: "function" as const, function: { name: "test", arguments: "{}" } }];
    const result = llm_response_to_agent_result(
      { ...base_response, has_tool_calls: true, tool_calls: tc },
      "chatgpt",
    );
    expect(result.metadata?.raw_tool_calls).toEqual(tc);
  });
});

describe("sandbox_to_sdk_permission", () => {
  it("maps plan_only to plan mode", () => {
    const result = sandbox_to_sdk_permission({
      fs_access: "full-access", approval: "auto-approve", plan_only: true,
    } as SandboxPolicy);
    expect(result.permission_mode).toBe("plan");
    expect(result.dangerous_skip).toBe(false);
  });

  it("maps read-only to default mode", () => {
    const result = sandbox_to_sdk_permission({
      fs_access: "read-only", approval: "always-ask",
    } as SandboxPolicy);
    expect(result.permission_mode).toBe("default");
    expect(result.dangerous_skip).toBe(false);
  });

  it("maps workspace-write to acceptEdits", () => {
    const result = sandbox_to_sdk_permission({
      fs_access: "workspace-write", approval: "auto-approve",
    } as SandboxPolicy);
    expect(result.permission_mode).toBe("acceptEdits");
    expect(result.dangerous_skip).toBe(false);
  });

  it("maps full-access to bypassPermissions with dangerous_skip", () => {
    const result = sandbox_to_sdk_permission({
      fs_access: "full-access", approval: "auto-approve",
    } as SandboxPolicy);
    expect(result.permission_mode).toBe("bypassPermissions");
    expect(result.dangerous_skip).toBe(true);
  });
});

describe("sandbox_to_codex_policy", () => {
  it("maps read-only", () => {
    const result = sandbox_to_codex_policy(
      { fs_access: "read-only", approval: "always-ask" } as SandboxPolicy,
      "/app",
    );
    expect(result.sandbox).toBe("read-only");
    expect(result.approval_policy).toBe("unlessTrusted");
    expect(result.turn_sandbox_policy).toBeUndefined();
  });

  it("maps workspace-write with writable roots", () => {
    const result = sandbox_to_codex_policy(
      { fs_access: "workspace-write", approval: "auto-approve", writable_roots: ["/tmp"], network_access: true } as SandboxPolicy,
      "/app",
    );
    expect(result.sandbox).toBe("workspace-write");
    expect(result.approval_policy).toBe("never");
    expect(result.turn_sandbox_policy).toEqual({
      type: "workspaceWrite",
      writableRoots: ["/app", "/tmp"],
      networkAccess: true,
    });
  });

  it("maps full-access", () => {
    const result = sandbox_to_codex_policy(
      { fs_access: "full-access", approval: "trusted-only" } as SandboxPolicy,
      "/app",
    );
    expect(result.sandbox).toBe("danger-full-access");
    expect(result.approval_policy).toBe("onRequest");
  });

  it("maps all approval modes correctly", () => {
    const test = (approval: string, expected: string) => {
      const result = sandbox_to_codex_policy(
        { fs_access: "read-only", approval } as SandboxPolicy, "/app",
      );
      expect(result.approval_policy).toBe(expected);
    };
    test("always-ask", "unlessTrusted");
    test("auto-approve", "never");
    test("trusted-only", "onRequest");
  });
});

describe("sdk_result_subtype_to_finish_reason", () => {
  it("maps success to stop", () => {
    expect(sdk_result_subtype_to_finish_reason("success")).toBe("stop");
  });

  it("maps error subtypes", () => {
    expect(sdk_result_subtype_to_finish_reason("error_max_turns")).toBe("max_turns");
    expect(sdk_result_subtype_to_finish_reason("error_max_budget_usd")).toBe("max_budget");
    expect(sdk_result_subtype_to_finish_reason("error_max_structured_output_retries")).toBe("output_retries");
    expect(sdk_result_subtype_to_finish_reason("error_during_execution")).toBe("error");
  });

  it("defaults to error for unknown subtypes", () => {
    expect(sdk_result_subtype_to_finish_reason("something_else")).toBe("error");
  });
});

describe("effort_to_codex", () => {
  it("returns undefined for empty/undefined", () => {
    expect(effort_to_codex(undefined)).toBeUndefined();
    expect(effort_to_codex("")).toBeUndefined();
  });

  it("maps known effort levels", () => {
    expect(effort_to_codex("low")).toBe("low");
    expect(effort_to_codex("medium")).toBe("medium");
    expect(effort_to_codex("high")).toBe("high");
  });

  it("maps max to high", () => {
    expect(effort_to_codex("max")).toBe("high");
  });

  it("passes through unknown values", () => {
    expect(effort_to_codex("custom")).toBe("custom");
  });
});
