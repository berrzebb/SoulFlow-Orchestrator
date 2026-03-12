/**
 * broadcaster — agent_event_to_web_stream, MutableBroadcaster, NULL_BROADCASTER.
 */
import { describe, it, expect, vi } from "vitest";
import {
  agent_event_to_web_stream,
  MutableBroadcaster,
  NULL_BROADCASTER,
} from "@src/dashboard/broadcaster.js";
import type { AgentEvent } from "@src/agent/agent.types.js";

function base_event(type: string, extra: Record<string, unknown> = {}): AgentEvent {
  return { type, at: new Date().toISOString(), source: "test", ...extra } as AgentEvent;
}

// ══════════════════════════════════════════
// agent_event_to_web_stream
// ══════════════════════════════════════════

describe("agent_event_to_web_stream", () => {
  it("tool_use → tool_start", () => {
    const ev = base_event("tool_use", { tool_name: "read_file", tool_id: "t1", params: { path: "/f" } });
    const r = agent_event_to_web_stream(ev);
    expect(r?.type).toBe("tool_start");
    expect((r as any).name).toBe("read_file");
  });

  it("tool_result → tool_result", () => {
    const ev = base_event("tool_result", { tool_name: "read_file", tool_id: "t1", result: "ok", is_error: false });
    const r = agent_event_to_web_stream(ev);
    expect(r?.type).toBe("tool_result");
  });

  it("usage → usage", () => {
    const ev = base_event("usage", { tokens: { input: 10, output: 5, cache_read: 0, cache_creation: 0 } });
    const r = agent_event_to_web_stream(ev);
    expect(r?.type).toBe("usage");
    expect((r as any).input).toBe(10);
  });

  it("content_delta → delta", () => {
    const ev = base_event("content_delta", { text: "hello" });
    const r = agent_event_to_web_stream(ev);
    expect(r?.type).toBe("delta");
  });

  it("기타 이벤트(init 등) → null", () => {
    const ev = base_event("init");
    expect(agent_event_to_web_stream(ev)).toBeNull();
  });
});

// ══════════════════════════════════════════
// NULL_BROADCASTER — no-op 호출
// ══════════════════════════════════════════

describe("NULL_BROADCASTER", () => {
  it("모든 메서드가 오류 없이 호출됨", () => {
    expect(() => {
      NULL_BROADCASTER.broadcast_process_event("start", {} as any);
      NULL_BROADCASTER.broadcast_message_event("inbound", "u1");
      NULL_BROADCASTER.broadcast_cron_event("tick");
      NULL_BROADCASTER.broadcast_progress_event({} as any);
      NULL_BROADCASTER.broadcast_task_event("status_change", {} as any);
      NULL_BROADCASTER.broadcast_web_stream("c1", "text", false);
      NULL_BROADCASTER.broadcast_web_message("c1");
      NULL_BROADCASTER.broadcast_mirror_message({} as any);
      NULL_BROADCASTER.broadcast_workflow_event({} as any);
      NULL_BROADCASTER.broadcast_agent_event({} as any);
      NULL_BROADCASTER.broadcast_web_rich_event("c1", { type: "done" });
    }).not.toThrow();
  });
});

// ══════════════════════════════════════════
// MutableBroadcaster — attach/detach + delegation
// ══════════════════════════════════════════

describe("MutableBroadcaster", () => {
  function make_mock_target() {
    return {
      broadcast_process_event: vi.fn(),
      broadcast_message_event: vi.fn(),
      broadcast_cron_event: vi.fn(),
      broadcast_progress_event: vi.fn(),
      broadcast_task_event: vi.fn(),
      broadcast_web_stream: vi.fn(),
      broadcast_web_message: vi.fn(),
      broadcast_mirror_message: vi.fn(),
      broadcast_workflow_event: vi.fn(),
      broadcast_agent_event: vi.fn(),
      broadcast_web_rich_event: vi.fn(),
      add_rich_stream_listener: vi.fn().mockReturnValue(() => undefined),
    };
  }

  it("attach 전 → NULL_BROADCASTER로 위임 (오류 없음)", () => {
    const b = new MutableBroadcaster();
    expect(() => b.broadcast_message_event("inbound", "u1")).not.toThrow();
  });

  it("attach 후 → target으로 위임", () => {
    const b = new MutableBroadcaster();
    const target = make_mock_target();
    b.attach(target);
    b.broadcast_process_event("start", {} as any);
    b.broadcast_message_event("inbound", "u1", "hello", "c1");
    b.broadcast_cron_event("tick", "job1");
    b.broadcast_progress_event({} as any);
    b.broadcast_task_event("status_change", {} as any);
    b.broadcast_web_stream("c1", "text", false);
    b.broadcast_web_message("c1");
    b.broadcast_mirror_message({ session_key: "s1", direction: "in", sender_id: "u1", content: "hi", at: "" });
    b.broadcast_workflow_event({} as any);
    b.broadcast_agent_event({} as any);
    b.broadcast_web_rich_event("c1", { type: "done" });
    expect(target.broadcast_process_event).toHaveBeenCalled();
    expect(target.broadcast_message_event).toHaveBeenCalled();
    expect(target.broadcast_agent_event).toHaveBeenCalled();
  });

  it("add_rich_stream_listener — target에 위임, 해제 함수 반환", () => {
    const b = new MutableBroadcaster();
    const target = make_mock_target();
    b.attach(target);
    const off = b.add_rich_stream_listener("c1", () => undefined);
    expect(typeof off).toBe("function");
    expect(target.add_rich_stream_listener).toHaveBeenCalledWith("c1", expect.any(Function));
  });

  it("add_rich_stream_listener — target에 메서드 없으면 no-op 해제 함수 반환", () => {
    const b = new MutableBroadcaster();
    const off = b.add_rich_stream_listener("c1", () => undefined);
    expect(typeof off).toBe("function");
    expect(() => off()).not.toThrow();
  });

  it("detach 후 → NULL_BROADCASTER로 복귀", () => {
    const b = new MutableBroadcaster();
    const target = make_mock_target();
    b.attach(target);
    b.detach();
    b.broadcast_cron_event("tick");
    expect(target.broadcast_cron_event).not.toHaveBeenCalled();
  });
});
