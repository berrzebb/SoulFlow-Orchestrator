/**
 * GW-4: DirectExecutor — 결정론적 도구 실행 테스트.
 *
 * 대상:
 * - create_direct_executor(): is_allowed / execute
 * - 기본 허용 목록 (read-only/bounded write)
 * - 에러 처리 + 폴백 시나리오
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { create_direct_executor } from "@src/orchestration/execution/direct-executor.js";
import type { DirectExecutorLike, ExecuteToolFn } from "@src/orchestration/execution/direct-executor.js";
import type { DirectToolPlan } from "@src/orchestration/gateway-contracts.js";
import type { ToolExecutionContext } from "@src/agent/tools/types.js";

const mock_ctx: ToolExecutionContext = {
  task_id: "task-1",
  signal: undefined as unknown as AbortSignal,
  channel: "slack",
  chat_id: "chat1",
  sender_id: "user1",
};

describe("DirectExecutor — is_allowed", () => {
  let de: DirectExecutorLike;

  beforeEach(() => {
    de = create_direct_executor();
  });

  it("datetime → 허용", () => {
    expect(de.is_allowed("datetime")).toBe(true);
  });

  it("read_file → 허용", () => {
    expect(de.is_allowed("read_file")).toBe(true);
  });

  it("list_dir → 허용", () => {
    expect(de.is_allowed("list_dir")).toBe(true);
  });

  it("search_files → 허용", () => {
    expect(de.is_allowed("search_files")).toBe(true);
  });

  it("memory → 허용 (bounded write)", () => {
    expect(de.is_allowed("memory")).toBe(true);
  });

  it("task_query → 허용", () => {
    expect(de.is_allowed("task_query")).toBe(true);
  });

  it("exec → 불허 (unbounded write)", () => {
    expect(de.is_allowed("exec")).toBe(false);
  });

  it("write_file → 불허", () => {
    expect(de.is_allowed("write_file")).toBe(false);
  });

  it("web_search → 불허", () => {
    expect(de.is_allowed("web_search")).toBe(false);
  });

  it("spawn → 불허", () => {
    expect(de.is_allowed("spawn")).toBe(false);
  });
});

describe("DirectExecutor — execute 성공", () => {
  it("허용된 도구 → output 반환", async () => {
    const de = create_direct_executor();
    const mock_tool: ExecuteToolFn = vi.fn(async () => "2026-03-14T16:00:00Z");

    const plan: DirectToolPlan = { tool_name: "datetime" };
    const result = await de.execute(plan, mock_tool, mock_ctx);

    expect(result.output).toBe("2026-03-14T16:00:00Z");
    expect(result.tool_name).toBe("datetime");
    expect(result.error).toBeUndefined();
    expect(mock_tool).toHaveBeenCalledWith("datetime", {}, mock_ctx);
  });

  it("args 전달", async () => {
    const de = create_direct_executor();
    const mock_tool: ExecuteToolFn = vi.fn(async () => "file content here");

    const plan: DirectToolPlan = { tool_name: "read_file", args: { path: "/tmp/test.txt" } };
    const result = await de.execute(plan, mock_tool, mock_ctx);

    expect(result.output).toBe("file content here");
    expect(mock_tool).toHaveBeenCalledWith("read_file", { path: "/tmp/test.txt" }, mock_ctx);
  });
});

describe("DirectExecutor — execute 에러", () => {
  it("비허용 도구 → error 반환", async () => {
    const de = create_direct_executor();
    const mock_tool: ExecuteToolFn = vi.fn(async () => "should not be called");

    const plan: DirectToolPlan = { tool_name: "exec" };
    const result = await de.execute(plan, mock_tool, mock_ctx);

    expect(result.output).toBe("");
    expect(result.error).toContain("not allowed in direct mode");
    expect(result.tool_name).toBe("exec");
    expect(mock_tool).not.toHaveBeenCalled();
  });

  it("도구 실행 예외 → error 반환", async () => {
    const de = create_direct_executor();
    const mock_tool: ExecuteToolFn = vi.fn(async () => {
      throw new Error("file not found");
    });

    const plan: DirectToolPlan = { tool_name: "read_file", args: { path: "/nonexistent" } };
    const result = await de.execute(plan, mock_tool, mock_ctx);

    expect(result.output).toBe("");
    expect(result.error).toContain("file not found");
    expect(result.tool_name).toBe("read_file");
  });
});

describe("DirectExecutor — custom allowed set", () => {
  it("커스텀 허용 목록으로 동작", async () => {
    const custom = new Set(["my_tool", "other_tool"]);
    const de = create_direct_executor(custom);

    expect(de.is_allowed("my_tool")).toBe(true);
    expect(de.is_allowed("datetime")).toBe(false);

    const mock_tool: ExecuteToolFn = vi.fn(async () => "custom result");
    const result = await de.execute({ tool_name: "my_tool" }, mock_tool, mock_ctx);

    expect(result.output).toBe("custom result");
    expect(result.error).toBeUndefined();
  });

  it("빈 허용 목록 → 모든 도구 불허", async () => {
    const de = create_direct_executor(new Set());

    expect(de.is_allowed("datetime")).toBe(false);

    const mock_tool: ExecuteToolFn = vi.fn(async () => "");
    const result = await de.execute({ tool_name: "datetime" }, mock_tool, mock_ctx);

    expect(result.error).toContain("not allowed in direct mode");
    expect(mock_tool).not.toHaveBeenCalled();
  });
});
