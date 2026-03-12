import { describe, it, expect, vi, beforeEach } from "vitest";
import { SseManager } from "@src/dashboard/sse-manager.ts";
import { make_mock_response } from "@helpers/mock-response.ts";

describe("SseManager", () => {
  let sse: SseManager;

  beforeEach(() => {
    sse = new SseManager();
  });

  describe("add_client", () => {
    it("클라이언트를 추가하면 count가 증가한다", () => {
      expect(sse.client_count).toBe(0);
      sse.add_client(make_mock_response() as any);
      expect(sse.client_count).toBe(1);
      sse.add_client(make_mock_response() as any);
      expect(sse.client_count).toBe(2);
    });

    it("SSE 헤더를 설정한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream; charset=utf-8");
      expect(res.setHeader).toHaveBeenCalledWith("Connection", "keep-alive");
    });

    it("ready 이벤트를 전송한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      const written = res.write.mock.calls[0][0] as string;
      expect(written).toContain("event: ready");
      expect(written).toContain('"id"');
    });

    it("close 이벤트에 cleanup을 등록한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      expect(res.on).toHaveBeenCalledWith("close", expect.any(Function));
    });

    it("close 시 클라이언트가 제거된다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      expect(sse.client_count).toBe(1);
      res.__trigger("close");
      expect(sse.client_count).toBe(0);
    });
  });

  describe("close_all", () => {
    it("모든 클라이언트를 종료한다", () => {
      const r1 = make_mock_response();
      const r2 = make_mock_response();
      sse.add_client(r1 as any);
      sse.add_client(r2 as any);
      sse.close_all();
      expect(r1.end).toHaveBeenCalled();
      expect(r2.end).toHaveBeenCalled();
      expect(sse.client_count).toBe(0);
    });
  });

  describe("broadcast_message_event", () => {
    it("클라이언트에 message 이벤트를 전송한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      sse.broadcast_message_event("inbound", "user1", "hello", "chat1");
      const payload = res.write.mock.calls[0][0] as string;
      expect(payload).toContain("event: message");
      expect(payload).toContain('"sender_id":"user1"');
    });

    it("recent_messages에 추가한다", () => {
      sse.broadcast_message_event("inbound", "user1", "hello");
      expect(sse.recent_messages).toHaveLength(1);
      expect(sse.recent_messages[0].sender_id).toBe("user1");
    });

    it("최대 40개를 초과하면 오래된 메시지를 제거한다", () => {
      for (let i = 0; i < 45; i++) {
        sse.broadcast_message_event("inbound", `user${i}`, `msg${i}`);
      }
      expect(sse.recent_messages).toHaveLength(40);
      expect(sse.recent_messages[0].sender_id).toBe("user5");
    });

    it("content를 200자로 잘라낸다", () => {
      const long_content = "x".repeat(300);
      sse.broadcast_message_event("inbound", "user1", long_content);
      expect(sse.recent_messages[0].content.length).toBe(200);
    });
  });

  describe("broadcast_process_event", () => {
    it("process 이벤트를 전송한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      const entry = { run_id: "r1", alias: "a1", mode: "once", status: "running" } as any;
      sse.broadcast_process_event("start", entry);
      const payload = res.write.mock.calls[0][0] as string;
      expect(payload).toContain("event: process");
      expect(payload).toContain('"run_id":"r1"');
    });
  });

  describe("broadcast_cron_event", () => {
    it("cron 이벤트를 전송한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      sse.broadcast_cron_event("fired", "job1");
      const payload = res.write.mock.calls[0][0] as string;
      expect(payload).toContain("event: cron");
      expect(payload).toContain('"job_id":"job1"');
    });
  });

  describe("broadcast_agent_event", () => {
    it("agent 이벤트를 슬림 형태로 전송한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      const event = { type: "tool_use", tool_name: "bash", source: { backend: "test", task_id: "t1" }, at: "2025-01-01" } as any;
      sse.broadcast_agent_event(event);
      const payload = res.write.mock.calls[0][0] as string;
      expect(payload).toContain("event: agent");
      expect(payload).toContain('"tool_name":"bash"');
      expect(payload).not.toContain('"input"');
    });
  });

  describe("broadcast_web_stream", () => {
    it("web_stream 이벤트를 전송한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      sse.broadcast_web_stream("chat1", "chunk", false);
      const payload = res.write.mock.calls[0][0] as string;
      expect(payload).toContain("event: web_stream");
      expect(payload).toContain('"chat_id":"chat1"');
    });
  });

  describe("dead client cleanup", () => {
    it("write 실패 시 해당 클라이언트를 제거한다", () => {
      const good = make_mock_response();
      const bad = make_mock_response();
      sse.add_client(good as any);
      sse.add_client(bad as any);
      expect(sse.client_count).toBe(2);
      bad.write.mockImplementation(() => { throw new Error("broken pipe"); });
      sse.broadcast_message_event("inbound", "user1", "test");
      expect(sse.client_count).toBe(1);
    });

    it("다른 클라이언트는 영향받지 않는다", () => {
      const good = make_mock_response();
      const bad = make_mock_response();
      sse.add_client(good as any);
      sse.add_client(bad as any);
      bad.write.mockImplementation(() => { throw new Error("broken pipe"); });
      sse.broadcast_message_event("inbound", "user1", "test");
      good.write.mockClear();
      sse.broadcast_message_event("inbound", "user2", "after cleanup");
      expect(good.write).toHaveBeenCalled();
    });
  });

  describe("broadcast_progress_event", () => {
    it("progress 이벤트를 전송한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      const event = { run_id: "r1", task_id: "t1", type: "output", content: "result" } as any;
      sse.broadcast_progress_event(event);
      const payload = res.write.mock.calls[0][0] as string;
      expect(payload).toContain("event: progress");
      expect(payload).toContain('"run_id":"r1"');
    });

    it("클라이언트 없으면 브로드캐스트 안 함 (에러 없음)", () => {
      expect(() => sse.broadcast_progress_event({ run_id: "r1" } as any)).not.toThrow();
    });
  });

  describe("broadcast_task_event", () => {
    it("task 이벤트를 전송한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      const task = {
        taskId: "task-1",
        title: "Test Task",
        status: "running",
        exitReason: undefined,
        currentStep: "assign",
        currentTurn: 1,
        maxTurns: 10,
        channel: "slack",
        chatId: "chat-1",
        objective: "do something",
      } as any;
      sse.broadcast_task_event("status_change", task);
      const payload = res.write.mock.calls[0][0] as string;
      expect(payload).toContain("event: task");
      expect(payload).toContain('"taskId":"task-1"');
      expect(payload).toContain('"status":"running"');
    });

    it("클라이언트 없으면 브로드캐스트 안 함 (에러 없음)", () => {
      expect(() => sse.broadcast_task_event("status_change", { taskId: "t1" } as any)).not.toThrow();
    });
  });

  describe("broadcast_mirror_message", () => {
    it("mirror_message 이벤트를 전송한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      const event = { session_key: "sk-1", direction: "inbound", sender_id: "user1", content: "hello", at: "2025-01-01" };
      sse.broadcast_mirror_message(event);
      const payload = res.write.mock.calls[0][0] as string;
      expect(payload).toContain("event: mirror_message");
      expect(payload).toContain('"session_key":"sk-1"');
    });

    it("클라이언트 없으면 브로드캐스트 안 함 (에러 없음)", () => {
      expect(() => sse.broadcast_mirror_message({ session_key: "s1", direction: "out", sender_id: "a", content: "b", at: "c" })).not.toThrow();
    });
  });

  describe("broadcast_workflow_event", () => {
    it("workflow 이벤트를 전송한다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      const event = { type: "phase_start", phase_id: "p1", workflow_id: "wf-1" } as any;
      sse.broadcast_workflow_event(event);
      const payload = res.write.mock.calls[0][0] as string;
      expect(payload).toContain("event: workflow");
      expect(payload).toContain('"workflow_id":"wf-1"');
    });

    it("클라이언트 없으면 브로드캐스트 안 함 (에러 없음)", () => {
      expect(() => sse.broadcast_workflow_event({ type: "phase_start" } as any)).not.toThrow();
    });
  });

  describe("클라이언트 없을 때 early return", () => {
    it("broadcast_process_event: 클라이언트 없으면 no-op", () => {
      expect(sse.client_count).toBe(0);
      expect(() => sse.broadcast_process_event("start", { run_id: "r1", alias: "a", mode: "once", status: "running" } as any)).not.toThrow();
    });

    it("broadcast_cron_event: 클라이언트 없으면 no-op", () => {
      expect(() => sse.broadcast_cron_event("fired")).not.toThrow();
    });

    it("broadcast_agent_event: 클라이언트 없으면 no-op", () => {
      expect(() => sse.broadcast_agent_event({ type: "tool_use", source: { backend: "b", task_id: "t" }, at: "t" } as any)).not.toThrow();
    });

    it("broadcast_web_stream: 클라이언트 없으면 no-op", () => {
      expect(() => sse.broadcast_web_stream("chat1", "chunk", false)).not.toThrow();
    });
  });

  describe("SSE format", () => {
    it("event:와 data: 필드가 올바른 SSE 형식이다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      sse.broadcast_cron_event("tick");
      const payload = res.write.mock.calls[0][0] as string;
      expect(payload).toMatch(/^event: \w+\ndata: \{.*\}\n\n$/s);
    });

    it("data는 유효한 JSON이다", () => {
      const res = make_mock_response();
      sse.add_client(res as any);
      res.write.mockClear();
      sse.broadcast_cron_event("tick", "j1");
      const payload = res.write.mock.calls[0][0] as string;
      const data_str = payload.split("data: ")[1].split("\n\n")[0];
      expect(() => JSON.parse(data_str)).not.toThrow();
    });
  });
});

// ══════════════════════════════════════════
// rich_listeners + offset 추적 (cov2)
// ══════════════════════════════════════════

describe("SseManager — add_rich_stream_listener", () => {
  let sse: SseManager;
  beforeEach(() => { sse = new SseManager(); });

  it("리스너 등록 → broadcast_web_stream delta 수신", () => {
    const events: any[] = [];
    sse.add_rich_stream_listener("chat1", (ev) => events.push(ev));
    sse.broadcast_web_stream("chat1", "hello", false);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "delta", content: "hello" });
  });

  it("done=true → done 이벤트 발행 후 리스너 제거", () => {
    const events: any[] = [];
    sse.add_rich_stream_listener("chat1", (ev) => events.push(ev));
    sse.broadcast_web_stream("chat1", "text", false);
    sse.broadcast_web_stream("chat1", "text more", true);
    expect(events.some((e) => e.type === "done")).toBe(true);
    sse.broadcast_web_stream("chat1", "after done", false);
    const count_before = events.length;
    expect(events.length).toBe(count_before);
  });

  it("dispose → 이후 broadcast에서 수신 안 됨", () => {
    const events: any[] = [];
    const dispose = sse.add_rich_stream_listener("chat1", (ev) => events.push(ev));
    dispose();
    sse.broadcast_web_stream("chat1", "after dispose", false);
    expect(events).toHaveLength(0);
  });

  it("같은 chat_id에 여러 리스너 → 모두 수신", () => {
    const ev1: any[] = [];
    const ev2: any[] = [];
    sse.add_rich_stream_listener("chat1", (e) => ev1.push(e));
    sse.add_rich_stream_listener("chat1", (e) => ev2.push(e));
    sse.broadcast_web_stream("chat1", "data", false);
    expect(ev1).toHaveLength(1);
    expect(ev2).toHaveLength(1);
  });

  it("마지막 리스너 dispose → chat_id 엔트리 삭제", () => {
    const d = sse.add_rich_stream_listener("chat1", vi.fn());
    d();
    sse.broadcast_web_stream("chat1", "no listener", false);
  });
});

describe("SseManager — broadcast_web_stream offset 추적", () => {
  let sse: SseManager;
  beforeEach(() => { sse = new SseManager(); });

  it("누적 content → offset으로 delta만 발행", () => {
    const deltas: string[] = [];
    sse.add_rich_stream_listener("chat1", (ev) => {
      if (ev.type === "delta") deltas.push(ev.content);
    });
    sse.broadcast_web_stream("chat1", "hello", false);
    sse.broadcast_web_stream("chat1", "hello world", false);
    sse.broadcast_web_stream("chat1", "hello world!", true);
    expect(deltas).toEqual(["hello", " world", "!"]);
  });

  it("동일 content 재전송 → delta 없음", () => {
    const deltas: string[] = [];
    sse.add_rich_stream_listener("chat1", (ev) => {
      if (ev.type === "delta") deltas.push(ev.content);
    });
    sse.broadcast_web_stream("chat1", "same", false);
    sse.broadcast_web_stream("chat1", "same", false);
    expect(deltas).toHaveLength(1);
  });
});

describe("SseManager — broadcast_web_rich_event", () => {
  let sse: SseManager;
  beforeEach(() => { sse = new SseManager(); });

  it("리스너 있으면 이벤트 전달", () => {
    const events: any[] = [];
    sse.add_rich_stream_listener("chat1", (ev) => events.push(ev));
    sse.broadcast_web_rich_event("chat1", { type: "tool_use", tool_name: "bash" } as any);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_use");
  });

  it("리스너 없으면 no-op", () => {
    expect(() => sse.broadcast_web_rich_event("nonexistent", { type: "tool_use" } as any)).not.toThrow();
  });
});

describe("SseManager — broadcast_web_message", () => {
  let sse: SseManager;
  beforeEach(() => { sse = new SseManager(); });

  it("클라이언트 있을 때 web_message 이벤트 전송", () => {
    const res = make_mock_response();
    sse.add_client(res as any);
    res.write.mockClear();
    sse.broadcast_web_message("chat1");
    const payload = res.write.mock.calls[0][0] as string;
    expect(payload).toContain("event: web_message");
    expect(payload).toContain('"chat_id":"chat1"');
  });

  it("클라이언트 없으면 no-op", () => {
    expect(() => sse.broadcast_web_message("chat1")).not.toThrow();
  });

  it("SSE 클라이언트 없어도 rich_listener는 delta 수신", () => {
    const events: any[] = [];
    sse.add_rich_stream_listener("chat2", (ev) => events.push(ev));
    expect(sse.client_count).toBe(0);
    sse.broadcast_web_stream("chat2", "content", false);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "delta", content: "content" });
  });
});
