/**
 * agent-hooks-builder.ts — 미커버 분기 보충 (cov3).
 * L67: cd_event 로깅 (cd.observe가 truthy 반환 시)
 * L204-205: auto-approve + channel_context → approval 훅
 */
import { describe, it, expect, vi } from "vitest";
import { build_agent_hooks } from "@src/orchestration/agent-hooks-builder.js";
import { StreamBuffer } from "@src/channels/stream-buffer.js";

function make_deps(overrides: Partial<Parameters<typeof build_agent_hooks>[0]> = {}) {
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const session_cd = { observe: vi.fn().mockReturnValue(null) };
  const process_tracker = { link_subagent: vi.fn() };
  const runtime = { register_approval_with_callback: vi.fn() };
  const log_event = vi.fn();
  return {
    session_cd, logger, process_tracker, runtime, log_event,
    streaming_config: { enabled: false, interval_ms: 0, min_chars: 0 },
    ...overrides,
  } as any;
}

function make_opts(overrides: Partial<Parameters<typeof build_agent_hooks>[1]> = {}) {
  return {
    buffer: new StreamBuffer(),
    runtime_policy: { sandbox: { approval: "auto-approve" } } as any,
    ...overrides,
  };
}

// ══════════════════════════════════════════
// L67: cd_event 로깅
// ══════════════════════════════════════════

describe("build_agent_hooks — cd_event 로깅 (L67)", () => {
  it("ask_user tool_use → cd_event 발생 → logger.info('cd_event') 호출됨", () => {
    const deps = make_deps();
    const { hooks } = build_agent_hooks(deps, make_opts());

    // ask_user tool_use → create_cd_observer가 "clarify" cd_event 반환 → L67 히트
    hooks.on_event!({
      type: "tool_use",
      source: { backend: "claude_sdk" },
      at: new Date().toISOString(),
      tool_name: "ask_user",
      tool_id: "t1",
      input: { question: "사용자에게 질문?" },
    });

    expect(deps.logger.info).toHaveBeenCalledWith(
      "cd_event",
      expect.objectContaining({ indicator: "clarify" }),
    );
  });
});

// ══════════════════════════════════════════
// L204-205: auto-approve + channel_context → approval 훅
// ══════════════════════════════════════════

describe("build_agent_hooks — auto-approve + channel_context (L204-205)", () => {
  it("approval=auto-approve + channel_context → on_approval 훅 등록 + 'accept' 반환", async () => {
    const deps = make_deps();
    const channel_context = { channel: "slack", chat_id: "C123" };
    const { hooks } = build_agent_hooks(
      deps,
      make_opts({ channel_context }),
    );

    // auto-approve 경로: L204-205
    expect(hooks.on_approval).toBeDefined();
    const result = await hooks.on_approval!({ type: "tool", tool_name: "exec", detail: "run ls" });
    expect(result).toBe("accept");
    // logger.info("approval_auto_accepted") 호출됨
    expect(deps.logger.info).toHaveBeenCalledWith(
      "approval_auto_accepted",
      expect.objectContaining({ tool: "exec" }),
    );
  });
});
