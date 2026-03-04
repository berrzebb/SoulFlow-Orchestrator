import { describe, it, expect, beforeEach } from "vitest";
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
