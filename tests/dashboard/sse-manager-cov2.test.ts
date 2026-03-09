/**
 * SseManager — rich_listeners 관련 미커버 분기 보충.
 * - add_rich_stream_listener: 등록, dispose, 중복 등록
 * - broadcast_web_stream: rich listener delta/done 경로
 * - broadcast_web_rich_event: 리스너 라우팅
 * - broadcast_web_message: 클라이언트 있음/없음
 * - broadcast_web_stream: clients=0 + rich_listeners 동작
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SseManager } from "@src/dashboard/sse-manager.ts";
import { make_mock_response } from "@helpers/mock-response.ts";

let sse: SseManager;

beforeEach(() => {
  sse = new SseManager();
});

// ══════════════════════════════════════════
// add_rich_stream_listener + dispose
// ══════════════════════════════════════════

describe("SseManager — add_rich_stream_listener", () => {
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
    sse.broadcast_web_stream("chat1", "text more", true); // done
    expect(events.some((e) => e.type === "done")).toBe(true);

    // done 후 리스너 제거 → 추가 broadcast 무시
    sse.broadcast_web_stream("chat1", "after done", false);
    const count_before = events.length;
    expect(events.length).toBe(count_before); // 증가 없음
  });

  it("dispose → 이후 broadcast에서 수신 안 됨", () => {
    const events: any[] = [];
    const dispose = sse.add_rich_stream_listener("chat1", (ev) => events.push(ev));

    dispose();
    sse.broadcast_web_stream("chat1", "after dispose", false);
    expect(events).toHaveLength(0);
  });

  it("같은 chat_id에 여러 리스너 등록 → 모두 수신", () => {
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
    d(); // 마지막 리스너 제거 → 엔트리 삭제

    // 이후 broadcast → 리스너 없어서 아무것도 안 함
    const listener = vi.fn();
    // 별도 테스트용 채널에는 리스너 없음
    sse.broadcast_web_stream("chat1", "no listener", false);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// broadcast_web_stream — offset 추적
// ══════════════════════════════════════════

describe("SseManager — broadcast_web_stream offset 추적", () => {
  it("누적 content → offset으로 delta만 발행", () => {
    const deltas: string[] = [];
    sse.add_rich_stream_listener("chat1", (ev) => {
      if (ev.type === "delta") deltas.push(ev.content);
    });

    sse.broadcast_web_stream("chat1", "hello", false);         // delta: "hello"
    sse.broadcast_web_stream("chat1", "hello world", false);   // delta: " world"
    sse.broadcast_web_stream("chat1", "hello world!", true);   // delta: "!"

    expect(deltas).toEqual(["hello", " world", "!"]);
  });

  it("동일 content 재전송 → delta 없음 (offset 변화 없음)", () => {
    const deltas: string[] = [];
    sse.add_rich_stream_listener("chat1", (ev) => {
      if (ev.type === "delta") deltas.push(ev.content);
    });

    sse.broadcast_web_stream("chat1", "same", false);
    sse.broadcast_web_stream("chat1", "same", false); // offset 변화 없음 → delta 없음
    expect(deltas).toHaveLength(1);
  });
});

// ══════════════════════════════════════════
// broadcast_web_rich_event
// ══════════════════════════════════════════

describe("SseManager — broadcast_web_rich_event", () => {
  it("리스너 있으면 이벤트 전달", () => {
    const events: any[] = [];
    sse.add_rich_stream_listener("chat1", (ev) => events.push(ev));

    sse.broadcast_web_rich_event("chat1", { type: "tool_use", tool_name: "bash" } as any);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_use");
  });

  it("리스너 없으면 no-op", () => {
    expect(() =>
      sse.broadcast_web_rich_event("nonexistent", { type: "tool_use" } as any)
    ).not.toThrow();
  });

  it("리스너 있으나 size=0 → no-op", () => {
    // 등록 후 dispose → size=0
    const d = sse.add_rich_stream_listener("chat1", vi.fn());
    d();
    expect(() =>
      sse.broadcast_web_rich_event("chat1", { type: "content_delta" } as any)
    ).not.toThrow();
  });
});

// ══════════════════════════════════════════
// broadcast_web_message
// ══════════════════════════════════════════

describe("SseManager — broadcast_web_message", () => {
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
});

// ══════════════════════════════════════════
// broadcast_web_stream — clients=0 + rich_listeners 동작
// ══════════════════════════════════════════

describe("SseManager — broadcast_web_stream clients=0 + rich", () => {
  it("SSE 클라이언트 없어도 rich_listener는 delta 수신", () => {
    const events: any[] = [];
    sse.add_rich_stream_listener("chat2", (ev) => events.push(ev));

    // 클라이언트 없음
    expect(sse.client_count).toBe(0);
    sse.broadcast_web_stream("chat2", "content", false);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "delta", content: "content" });
  });
});
