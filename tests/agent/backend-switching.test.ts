import { describe, it, expect, vi } from "vitest";
import { AgentBackendRegistry } from "../../src/agent/agent-registry.js";
import { ClaudeSdkAgent } from "../../src/agent/backends/claude-sdk.agent.js";
import { CodexAppServerAgent } from "../../src/agent/backends/codex-appserver.agent.js";
import type { AgentBackend, AgentRunOptions, AgentRunResult } from "../../src/agent/agent.types.js";

/** 테스트용 가짜 백엔드. */
function make_stub_backend(
  id: AgentBackend["id"],
  opts: { native_tool_loop?: boolean; available?: boolean; result_content?: string } = {},
): AgentBackend {
  const content = opts.result_content ?? `stub:${id}`;
  return {
    id,
    native_tool_loop: opts.native_tool_loop ?? false,
    supports_resume: false,
    is_available: () => opts.available ?? true,
    run: vi.fn(async (): Promise<AgentRunResult> => ({
      content,
      session: null,
      tool_calls_count: 0,
      usage: {},
      finish_reason: "stop",
      metadata: {},
    })),
  };
}

const stub_provider_registry = {
  get_health_scorer: () => ({ record: vi.fn() }),
} as unknown as import("../../src/providers/service.js").ProviderRegistry;

describe("AgentBackendRegistry — 백엔드 전환", () => {
  it("config에 따라 claude_code → claude_sdk로 해석한다", () => {
    const cli = make_stub_backend("claude_cli");
    const sdk = make_stub_backend("claude_sdk", { native_tool_loop: true });

    const registry = new AgentBackendRegistry({
      provider_registry: stub_provider_registry,
      backends: [cli, sdk],
      config: { claude_backend: "claude_sdk", codex_backend: "codex_cli" },
    });

    const resolved = registry.resolve_backend("claude_code");
    expect(resolved?.id).toBe("claude_sdk");
    expect(resolved?.native_tool_loop).toBe(true);
  });

  it("config에 따라 chatgpt → codex_appserver로 해석한다", () => {
    const cli = make_stub_backend("codex_cli");
    const app = make_stub_backend("codex_appserver", { native_tool_loop: true });

    const registry = new AgentBackendRegistry({
      provider_registry: stub_provider_registry,
      backends: [cli, app],
      config: { claude_backend: "claude_cli", codex_backend: "codex_appserver" },
    });

    const resolved = registry.resolve_backend("chatgpt");
    expect(resolved?.id).toBe("codex_appserver");
    expect(resolved?.native_tool_loop).toBe(true);
  });

  it("등록되지 않은 백엔드 ID로 run() 호출 시 에러를 던진다", async () => {
    const registry = new AgentBackendRegistry({
      provider_registry: stub_provider_registry,
      backends: [],
    });

    await expect(registry.run("claude_sdk", { task: "test" }))
      .rejects.toThrow("agent_backend_not_found:claude_sdk");
  });

  it("is_available()=false인 백엔드로 run() 호출 시 에러를 던진다", async () => {
    const unavailable = make_stub_backend("claude_sdk", { available: false });
    const registry = new AgentBackendRegistry({
      provider_registry: stub_provider_registry,
      backends: [unavailable],
    });

    await expect(registry.run("claude_sdk", { task: "test" }))
      .rejects.toThrow("agent_backend_unavailable:claude_sdk");
  });

  it("run() 성공 시 백엔드 결과를 그대로 반환한다", async () => {
    const sdk = make_stub_backend("claude_sdk", {
      native_tool_loop: true,
      result_content: "hello from sdk",
    });
    const registry = new AgentBackendRegistry({
      provider_registry: stub_provider_registry,
      backends: [sdk],
    });

    const result = await registry.run("claude_sdk", { task: "test" });
    expect(result.content).toBe("hello from sdk");
    expect(result.finish_reason).toBe("stop");
    expect(sdk.run).toHaveBeenCalledOnce();
  });

  it("기본 설정은 CLI 백엔드를 사용한다", () => {
    const cli_claude = make_stub_backend("claude_cli");
    const cli_codex = make_stub_backend("codex_cli");

    const registry = new AgentBackendRegistry({
      provider_registry: stub_provider_registry,
      backends: [cli_claude, cli_codex],
    });

    expect(registry.resolve_backend("claude_code")?.id).toBe("claude_cli");
    expect(registry.resolve_backend("chatgpt")?.id).toBe("codex_cli");
  });

  it("list_backends()가 등록된 모든 ID를 반환한다", () => {
    const registry = new AgentBackendRegistry({
      provider_registry: stub_provider_registry,
      backends: [
        make_stub_backend("claude_cli"),
        make_stub_backend("claude_sdk"),
        make_stub_backend("codex_appserver"),
      ],
    });

    const ids = registry.list_backends();
    expect(ids).toContain("claude_cli");
    expect(ids).toContain("claude_sdk");
    expect(ids).toContain("codex_appserver");
    expect(ids).toHaveLength(3);
  });
});

describe("ClaudeSdkAgent — 속성 검증", () => {
  it("SDK 설치 시 is_available()이 true를 반환한다", () => {
    const agent = new ClaudeSdkAgent({ cwd: "." });
    expect(agent.is_available()).toBe(true);
    expect(agent.id).toBe("claude_sdk");
    expect(agent.native_tool_loop).toBe(true);
    expect(agent.supports_resume).toBe(true);
  });

  it("run()이 에러 시 finish_reason=error 결과를 반환한다", async () => {
    const agent = new ClaudeSdkAgent({ cwd: "." });
    // ANTHROPIC_API_KEY 없이 실행하면 에러 결과가 나온다
    const result = await agent.run({ task: "test" });
    expect(result.finish_reason).toBe("error");
    expect(result.content).toContain("Error:");
  });
});

describe("CodexAppServerAgent — 속성 검증", () => {
  it("codex 바이너리 없으면 is_available()이 false를 반환한다", () => {
    const agent = new CodexAppServerAgent({ cwd: ".", command: "nonexistent-binary-xyz" });
    expect(agent.is_available()).toBe(false);
  });

  it("속성이 올바른 값을 가진다", () => {
    const agent = new CodexAppServerAgent({ cwd: "." });
    expect(agent.id).toBe("codex_appserver");
    expect(agent.native_tool_loop).toBe(true);
    expect(agent.supports_resume).toBe(true);
  });
});
