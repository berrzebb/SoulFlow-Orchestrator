/**
 * MessageTool — send_callback / event_recorder 기반 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageTool } from "@src/agent/tools/message.js";

const WS = "/tmp/workspace";

function make_tool(
  send_cb?: ReturnType<typeof vi.fn> | null,
  event_cb?: ReturnType<typeof vi.fn> | null,
) {
  const tool = new MessageTool({
    workspace: WS,
    send_callback: send_cb ?? null,
    event_recorder: event_cb ?? null,
  });
  return tool;
}

function default_context() {
  return {
    channel: "slack",
    chat_id: "C123",
    reply_to: "msg-1",
    sender_id: "agent-x",
    task_id: "task-1",
  } as any;
}

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("MessageTool — 메타데이터", () => {
  it("name = message", () => expect(make_tool().name).toBe("message"));
  it("category = messaging", () => expect(make_tool().category).toBe("messaging"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// send_callback 없음
// ══════════════════════════════════════════

describe("MessageTool — send_callback 없음", () => {
  it("callback 없음 → Error", async () => {
    const r = await make_tool(null).execute({ content: "hello" }, default_context());
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("send callback");
  });
});

// ══════════════════════════════════════════
// channel / chat_id 검증
// ══════════════════════════════════════════

describe("MessageTool — channel/chat_id 검증", () => {
  it("channel/chat_id 없음 → Error", async () => {
    const send = vi.fn();
    const r = await make_tool(send).execute({ content: "hello" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("channel");
  });

  it("context에서 channel/chat_id 읽기", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r = await make_tool(send).execute({ content: "hello" }, default_context());
    expect(String(r)).toContain("phase=");
    expect(send).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════
// content 검증
// ══════════════════════════════════════════

describe("MessageTool — content 검증", () => {
  it("content 없음 → Error", async () => {
    const send = vi.fn();
    const r = await make_tool(send).execute(
      { content: "", channel: "slack", chat_id: "C1" },
    );
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("content");
  });

  it("detail로 content 대체", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r = await make_tool(send).execute(
      { content: "", detail: "first line\nsecond line", channel: "slack", chat_id: "C1" },
    );
    expect(String(r)).toContain("phase=");
    expect(send).toHaveBeenCalledOnce();
    const msg = send.mock.calls[0][0];
    expect(msg.content).toBe("first line");
  });
});

// ══════════════════════════════════════════
// 기본 메시지 전송
// ══════════════════════════════════════════

describe("MessageTool — 기본 전송", () => {
  it("성공 → Event sent phase= 포함", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r = await make_tool(send).execute(
      { content: "작업 완료", phase: "done", channel: "slack", chat_id: "C1", task_id: "task-42" },
    );
    expect(r).toContain("phase=done");
    expect(r).toContain("task_id=task-42");
  });

  it("reply_to 포함", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await make_tool(send).execute(
      { content: "reply", channel: "slack", chat_id: "C1", reply_to: "original-msg" },
    );
    const msg = send.mock.calls[0][0];
    expect(msg.reply_to).toBe("original-msg");
  });

  it("payload 포함", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await make_tool(send).execute(
      { content: "data", channel: "slack", chat_id: "C1", payload: { score: 42 } },
    );
    const msg = send.mock.calls[0][0];
    expect(msg.metadata.orchestrator_event.payload.score).toBe(42);
  });

  it("payload=배열 → 빈 payload", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await make_tool(send).execute(
      { content: "data", channel: "slack", chat_id: "C1", payload: [1, 2] },
    );
    const msg = send.mock.calls[0][0];
    expect(msg.metadata.orchestrator_event.payload).toEqual({});
  });
});

// ══════════════════════════════════════════
// event_recorder
// ══════════════════════════════════════════

describe("MessageTool — event_recorder", () => {
  it("event_recorder 성공 → event 활용", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const event_cb = vi.fn().mockResolvedValue({
      event: {
        event_id: "ev-1",
        run_id: "run-1",
        task_id: "task-1",
        agent_id: "agent",
        phase: "progress",
        summary: "진행중",
        payload: {},
        provider: "slack",
        channel: "slack",
        chat_id: "C1",
        source: "outbound",
        at: new Date().toISOString(),
        detail_file: "details/task-1.md",
      },
    });
    const r = await make_tool(send, event_cb).execute(
      { content: "진행중", phase: "progress", channel: "slack", chat_id: "C1", task_id: "task-1" },
    );
    expect(event_cb).toHaveBeenCalledOnce();
    expect(r).toContain("detail_file=details/task-1.md");
  });

  it("event_recorder 실패 → Error: event_record_failed", async () => {
    const send = vi.fn();
    const event_cb = vi.fn().mockRejectedValue(new Error("DB error"));
    const r = await make_tool(send, event_cb).execute(
      { content: "진행중", channel: "slack", chat_id: "C1" },
    );
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("event_record_failed");
  });
});

// ══════════════════════════════════════════
// set_send_callback / set_event_recorder
// ══════════════════════════════════════════

describe("MessageTool — setter 메서드", () => {
  it("set_send_callback으로 나중에 설정", async () => {
    const tool = make_tool(null);
    const send = vi.fn().mockResolvedValue(undefined);
    tool.set_send_callback(send);
    const r = await tool.execute({ content: "hello", channel: "slack", chat_id: "C1" });
    expect(r).toContain("phase=");
    expect(send).toHaveBeenCalledOnce();
  });

  it("set_event_recorder로 나중에 설정", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const tool = make_tool(send, null);
    const event_cb = vi.fn().mockResolvedValue({ event: null });
    tool.set_event_recorder(event_cb);
    await tool.execute({ content: "test", channel: "slack", chat_id: "C1" });
    expect(event_cb).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════
// start_turn / has_sent_in_turn
// ══════════════════════════════════════════

describe("MessageTool — turn tracking", () => {
  it("초기에는 false", () => {
    expect(make_tool().has_sent_in_turn()).toBe(false);
  });

  it("전송 후 → true", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const tool = make_tool(send);
    await tool.execute({ content: "hi", channel: "slack", chat_id: "C1" });
    expect(tool.has_sent_in_turn()).toBe(true);
  });

  it("start_turn 후 → false 리셋", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const tool = make_tool(send);
    await tool.execute({ content: "hi", channel: "slack", chat_id: "C1" });
    tool.start_turn();
    expect(tool.has_sent_in_turn()).toBe(false);
  });
});

// ══════════════════════════════════════════
// media 중복 제거 (L125)
// ══════════════════════════════════════════

describe("MessageTool — media 중복 제거 (L125)", () => {
  it("동일 미디어 경로 두 번 전달 → L125 dedup skip → 한 번만 추가", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "msg-media-test-"));
    const file_name = "report.txt";
    await writeFile(join(tmp, file_name), "content");

    try {
      const send = vi.fn().mockResolvedValue(undefined);
      const tool = new MessageTool({
        workspace: tmp,
        send_callback: send,
        event_recorder: null,
      });
      // 같은 파일 이름을 두 번 전달 → 두 번째는 L125에서 skip
      await tool.execute({
        content: "with media",
        channel: "slack",
        chat_id: "C1",
        media: [file_name, file_name],
      });
      expect(send).toHaveBeenCalledOnce();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
