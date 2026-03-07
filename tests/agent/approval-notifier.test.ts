import { describe, it, expect, vi } from "vitest";
import { build_approval_notifier, type ApprovalNotifierDeps } from "@src/agent/tools/approval-notifier.js";
import type { OutboundMessage } from "@src/bus/types.js";

function make_deps(overrides?: Partial<ApprovalNotifierDeps>): ApprovalNotifierDeps & { captured: OutboundMessage[] } {
  const captured: OutboundMessage[] = [];
  return {
    captured,
    bus: {
      publish_outbound: vi.fn(async (msg: OutboundMessage) => { captured.push(msg); }),
    } as unknown as ApprovalNotifierDeps["bus"],
    event_recorder: null,
    ...overrides,
  };
}

function make_request(overrides?: Record<string, unknown>) {
  return {
    request_id: "req-1",
    tool_name: "write_file",
    params: { file_path: "/tmp/test.txt", content: "hello" },
    context: { channel: "telegram", chat_id: "chat-1", task_id: "task-1", sender_id: "agent-1" },
    detail: "파일 쓰기 권한 필요",
    created_at: "2026-03-07T00:00:00Z",
    ...overrides,
  };
}

describe("build_approval_notifier", () => {
  it("채널/chat_id가 있으면 메시지 발행", async () => {
    const deps = make_deps();
    const notifier = build_approval_notifier(deps);
    await notifier(make_request());

    expect(deps.captured).toHaveLength(1);
    const msg = deps.captured[0]!;
    expect(msg.provider).toBe("telegram");
    expect(msg.chat_id).toBe("chat-1");
    expect(String(msg.content)).toContain("승인 요청");
    expect(String(msg.content)).toContain("write_file");
    expect(String(msg.content)).toContain("파일 쓰기 권한 필요");
  });

  it("channel 비어있으면 발행 안 함", async () => {
    const deps = make_deps();
    const notifier = build_approval_notifier(deps);
    await notifier(make_request({ context: { channel: "", chat_id: "chat-1" } }));

    expect(deps.captured).toHaveLength(0);
  });

  it("chat_id 비어있으면 발행 안 함", async () => {
    const deps = make_deps();
    const notifier = build_approval_notifier(deps);
    await notifier(make_request({ context: { channel: "telegram", chat_id: "" } }));

    expect(deps.captured).toHaveLength(0);
  });

  it("context 없으면 발행 안 함", async () => {
    const deps = make_deps();
    const notifier = build_approval_notifier(deps);
    await notifier(make_request({ context: undefined }));

    expect(deps.captured).toHaveLength(0);
  });

  it("metadata에 approval 정보 포함", async () => {
    const deps = make_deps();
    const notifier = build_approval_notifier(deps);
    await notifier(make_request());

    const meta = deps.captured[0]!.metadata as Record<string, unknown>;
    expect(meta.kind).toBe("approval_request");
    expect(meta.request_id).toBe("req-1");
    expect(meta.tool_name).toBe("write_file");
  });

  it("파라미터 블록이 메시지에 포함", async () => {
    const deps = make_deps();
    const notifier = build_approval_notifier(deps);
    await notifier(make_request());

    const content = String(deps.captured[0]!.content);
    expect(content).toContain("파라미터");
    expect(content).toContain("file_path");
  });

  it("event_recorder가 있으면 이벤트 기록", async () => {
    const recorder = vi.fn(async () => ({ event_id: "e1" }));
    const deps = make_deps({ event_recorder: recorder });
    const notifier = build_approval_notifier(deps);
    await notifier(make_request());

    expect(recorder).toHaveBeenCalledTimes(1);
    const arg = recorder.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.phase).toBe("approval");
    expect(arg.detail).toBe("파일 쓰기 권한 필요");
  });

  it("event_recorder 실패해도 메시지 발행은 계속", async () => {
    const recorder = vi.fn(async () => { throw new Error("DB fail"); });
    const deps = make_deps({ event_recorder: recorder });
    const notifier = build_approval_notifier(deps);
    await notifier(make_request());

    expect(deps.captured).toHaveLength(1);
  });

  it("빈 파라미터면 파라미터 블록 없음", async () => {
    const deps = make_deps();
    const notifier = build_approval_notifier(deps);
    await notifier(make_request({ params: {} }));

    const content = String(deps.captured[0]!.content);
    expect(content).not.toContain("파라미터");
  });
});
