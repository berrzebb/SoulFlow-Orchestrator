/**
 * build_agent_hooks의 on_event → 스트림 주입 테스트.
 * 이벤트 타입별로 버퍼에 올바른 내용이 주입되고, on_stream으로 전달되는지 검증.
 */
import { describe, it, expect, vi } from "vitest";
import { build_agent_hooks } from "@src/orchestration/agent-hooks-builder.js";
import { StreamBuffer } from "@src/channels/stream-buffer.js";
import { create_cd_observer } from "@src/agent/cd-scoring.js";
import type { AgentEvent } from "@src/agent/agent.types.js";

const SRC = { backend: "claude_sdk" as const };
const NOW = new Date().toISOString();

function make_event<T extends AgentEvent["type"]>(type: T, extra: Omit<Extract<AgentEvent, { type: T }>, "type" | "source" | "at">): AgentEvent {
  return { type, source: SRC, at: NOW, ...extra } as AgentEvent;
}

function create_test_deps(on_stream?: (chunk: string) => void) {
  const buffer = new StreamBuffer();
  const chunks: string[] = [];
  const stream_cb = on_stream || ((chunk: string) => { chunks.push(chunk); });

  const deps = {
    session_cd: create_cd_observer(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as never,
    process_tracker: null,
    runtime: { register_approval_with_callback: vi.fn() },
    log_event: vi.fn(),
    streaming_config: { enabled: true, interval_ms: 0, min_chars: 1 },
  };

  return { buffer, chunks, stream_cb, deps };
}

describe("build_agent_hooks — inline 모드 (on_tool_block 미등록)", () => {
  it("tool_use 이벤트를 스트림에 주입한다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("tool_use", { tool_name: "read_file", tool_id: "t1", params: {} }));

    expect(buffer.get_full_content()).toContain("▸ `read_file`");
  });

  it("tool_result 성공을 스트림에 주입한다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("tool_result", {
      tool_name: "read_file", tool_id: "t1", result: "file contents here",
    }));

    expect(buffer.get_full_content()).toContain("→");
    expect(buffer.get_full_content()).toContain("file contents here");
  });

  it("tool_result 에러를 ✗ 마커와 함께 주입한다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("tool_result", {
      tool_name: "exec", tool_id: "t2", result: "permission denied", is_error: true,
    }));

    expect(buffer.get_full_content()).toContain("✗");
    expect(buffer.get_full_content()).toContain("permission denied");
  });

  it("error 이벤트를 ❌ 마커와 함께 주입한다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("error", { error: "context window exceeded" }));

    expect(buffer.get_full_content()).toContain("❌");
    expect(buffer.get_full_content()).toContain("context window exceeded");
  });

  it("task_lifecycle started/completed를 적절한 마커와 함께 주입한다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("task_lifecycle", {
      sdk_task_id: "task_1", status: "started", description: "분석 시작",
    }));

    expect(buffer.get_full_content()).toContain("▶");
    expect(buffer.get_full_content()).toContain("분석 시작");

    hooks.on_event!(make_event("task_lifecycle", {
      sdk_task_id: "task_1", status: "completed", description: "분석 완료",
    }));

    expect(buffer.get_full_content()).toContain("✓");
    expect(buffer.get_full_content()).toContain("분석 완료");
  });

  it("rate_limit rejected를 경고와 함께 주입한다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("rate_limit", {
      status: "rejected", resets_at: Math.floor(Date.now() / 1000) + 60,
    }));

    expect(buffer.get_full_content()).toContain("Rate limit exceeded");
  });

  it("auth_request를 🔐 마커와 함께 주입한다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("auth_request", {
      messages: ["Please authenticate at https://..."], is_error: false,
    }));

    expect(buffer.get_full_content()).toContain("🔐");
    expect(buffer.get_full_content()).toContain("authenticate");
  });

  it("compact_boundary를 📦 마커와 함께 주입한다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("compact_boundary", { trigger: "auto", pre_tokens: 50000 }));

    expect(buffer.get_full_content()).toContain("📦");
    expect(buffer.get_full_content()).toContain("컨텍스트 압축");
  });

  it("usage 이벤트는 스트림에 주입하지 않는다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("usage", {
      tokens: { input: 1000, output: 500 }, cost_usd: 0.01,
    }));

    expect(buffer.get_full_content()).toBe("");
  });

  it("tool_summary를 스트림에 주입한다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("tool_summary", {
      summary: "3개 파일 수정 완료", tool_use_ids: ["t1", "t2", "t3"],
    }));

    expect(buffer.get_full_content()).toContain("3개 파일 수정 완료");
  });
});

describe("build_agent_hooks — count 모드 (on_tool_block 등록)", () => {
  it("tool_use는 on_tool_block으로 전달되고 스트림에 주입되지 않는다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const tool_blocks: string[] = [];
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      on_tool_block: (block) => { tool_blocks.push(block); },
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("tool_use", { tool_name: "exec", tool_id: "t1", params: {} }));

    expect(tool_blocks).toEqual(["exec"]);
    expect(buffer.get_full_content()).toBe("");
  });

  it("error는 count 모드에서도 스트림에 주입된다 (크리티컬 이벤트)", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      on_tool_block: () => {},
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("error", { error: "fatal error" }));

    expect(buffer.get_full_content()).toContain("❌");
    expect(buffer.get_full_content()).toContain("fatal error");
  });

  it("rate_limit rejected는 count 모드에서도 스트림에 주입된다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      on_tool_block: () => {},
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("rate_limit", { status: "rejected" }));

    expect(buffer.get_full_content()).toContain("Rate limit exceeded");
  });

  it("auth_request는 count 모드에서도 스트림에 주입된다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      on_tool_block: () => {},
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    hooks.on_event!(make_event("auth_request", { messages: ["Auth needed"], is_error: false }));

    expect(buffer.get_full_content()).toContain("🔐");
  });

  it("tool_result는 count 모드에서 스트림에 주입되지 않는다", () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();
    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      on_tool_block: () => {},
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
      backend_id: "claude_sdk",
      channel_context: { channel: "telegram", chat_id: "c1" },
      run_id: "run_1",
    });

    hooks.on_event!(make_event("tool_result", {
      tool_name: "exec", tool_id: "t1", result: "output",
    }));

    // count 모드: tool_result는 로깅만 수행, 스트림 주입 안함
    expect(buffer.get_full_content()).toBe("");
    expect(deps.log_event).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.stringContaining("tool: exec"),
    }));
  });
});

describe("build_agent_hooks — on_stream 콜백 에러 격리", () => {
  it("on_stream 에러가 이벤트 처리를 중단하지 않는다", () => {
    const { buffer, deps } = create_test_deps();
    let call_count = 0;
    const failing_stream = () => {
      call_count++;
      throw new Error("stream callback failed");
    };

    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: failing_stream,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    // 에러가 발생해도 예외가 전파되지 않아야 함
    expect(() => {
      hooks.on_event!(make_event("error", { error: "test error" }));
    }).not.toThrow();
  });
});

describe("build_agent_hooks — on_stream 핸들러 생성", () => {
  it("streaming 비활성화 시 on_stream 훅이 없다", () => {
    const { buffer, stream_cb, deps } = create_test_deps();
    deps.streaming_config.enabled = false;

    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    expect(hooks.on_stream).toBeUndefined();
  });

  it("streaming 활성화 시 on_stream 훅이 있다", () => {
    const { buffer, stream_cb, deps } = create_test_deps();

    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    expect(hooks.on_stream).toBeDefined();
    expect(typeof hooks.on_stream).toBe("function");
  });

  it("on_stream 핸들러가 sanitize 후 버퍼에 누적한다", async () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();

    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    await hooks.on_stream!("정상 텍스트");
    expect(buffer.get_full_content()).toContain("정상 텍스트");
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("on_stream 핸들러가 노이즈 청크를 필터링한다", async () => {
    const { buffer, chunks, stream_cb, deps } = create_test_deps();

    const { hooks } = build_agent_hooks(deps, {
      buffer, on_stream: stream_cb,
      runtime_policy: { sandbox: { approval: "auto-approve" } } as never,
    });

    await hooks.on_stream!("OpenAI Codex v1.0");
    expect(buffer.get_full_content()).toBe("");
    expect(chunks.length).toBe(0);
  });
});
