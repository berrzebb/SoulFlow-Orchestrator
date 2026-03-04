import { describe, it, expect, vi } from "vitest";
import { resolve_gateway, type GatewayDeps } from "@src/orchestration/gateway.js";
import type { ClassifierContext } from "@src/orchestration/classifier.js";
import type { TaskState } from "@src/contracts.js";

/** classify_execution_mode를 모킹하여 Gateway 결정 로직만 테스트. */
vi.mock("@src/orchestration/classifier.js", () => ({
  classify_execution_mode: vi.fn(),
}));

vi.mock("@src/orchestration/prompts.js", () => ({
  format_active_task_summary: vi.fn(
    (tasks: TaskState[]) => `${tasks.length} active tasks`,
  ),
}));

const { classify_execution_mode } = await import("@src/orchestration/classifier.js");
const mock_classify = vi.mocked(classify_execution_mode);

function make_deps(overrides?: Partial<GatewayDeps>): GatewayDeps {
  return {
    providers: {
      supports_tool_loop: vi.fn(() => true),
    } as unknown as GatewayDeps["providers"],
    provider_caps: { chatgpt_available: true, claude_available: false, openrouter_available: false },
    executor_preference: "chatgpt",
    session_lookup: vi.fn(() => null),
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as GatewayDeps["logger"],
    ...overrides,
  };
}

const empty_ctx: ClassifierContext = {};

describe("resolve_gateway", () => {
  it("builtin 분류 시 builtin 결정을 반환", async () => {
    mock_classify.mockResolvedValueOnce({ mode: "builtin", command: "task", args: "list" });
    const result = await resolve_gateway("태스크 목록", empty_ctx, [], make_deps());
    expect(result).toEqual({ action: "builtin", command: "task", args: "list" });
  });

  it("inquiry + 활성 태스크가 있으면 inquiry 결정 반환", async () => {
    mock_classify.mockResolvedValueOnce({ mode: "inquiry" });
    const tasks = [{ id: "t1", status: "running" }] as unknown as TaskState[];
    const result = await resolve_gateway("지금 뭐해?", empty_ctx, tasks, make_deps());
    expect(result).toEqual({ action: "inquiry", summary: "1 active tasks" });
  });

  it("inquiry + 활성 태스크 없으면 once 실행 결정", async () => {
    mock_classify.mockResolvedValueOnce({ mode: "inquiry" });
    const result = await resolve_gateway("뭐해?", empty_ctx, [], make_deps());
    expect(result).toEqual({ action: "execute", mode: "once", executor: "chatgpt" });
  });

  it("agent 분류 시 execute 결정 반환", async () => {
    mock_classify.mockResolvedValueOnce({ mode: "agent" });
    const result = await resolve_gateway("코드 작성해", empty_ctx, [], make_deps());
    expect(result).toEqual({ action: "execute", mode: "agent", executor: "chatgpt" });
  });

  it("task 분류 시 execute 결정 반환", async () => {
    mock_classify.mockResolvedValueOnce({ mode: "task" });
    const result = await resolve_gateway("장기 작업", empty_ctx, [], make_deps());
    expect(result).toEqual({ action: "execute", mode: "task", executor: "chatgpt" });
  });

  it("tool_loop 미지원 시 once로 다운그레이드", async () => {
    mock_classify.mockResolvedValueOnce({ mode: "agent" });
    const deps = make_deps({
      providers: {
        supports_tool_loop: vi.fn(() => false),
      } as unknown as GatewayDeps["providers"],
    });
    const result = await resolve_gateway("코드 작성해", empty_ctx, [], deps);
    expect(result).toEqual({ action: "execute", mode: "once", executor: "chatgpt" });
  });
});
