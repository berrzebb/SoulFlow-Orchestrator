/**
 * NotificationTool + FileRequestTool 커버리지.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NotificationTool } from "@src/agent/tools/notification.js";
import { FileRequestTool } from "@src/agent/tools/file-request.js";

afterEach(() => { vi.restoreAllMocks(); });

// ══════════════════════════════════════════
// NotificationTool
// ══════════════════════════════════════════

describe("NotificationTool — 메타데이터", () => {
  it("name = notification", () => expect(new NotificationTool().name).toBe("notification"));
  it("category = messaging", () => expect(new NotificationTool().category).toBe("messaging"));
  it("policy_flags: network=true", () => expect(new NotificationTool().policy_flags.network).toBe(true));
  it("to_schema: function 형식", () => expect(new NotificationTool().to_schema().type).toBe("function"));
});

describe("NotificationTool — 유효성 검사", () => {
  it("title 없음 → Error 반환", async () => {
    const r = await new NotificationTool().execute({ title: "", level: "info" });
    expect(r).toContain("Error");
    expect(r).toContain("title");
  });
});

describe("NotificationTool — 내부 콜백 없음 (로그 모드)", () => {
  it("on_notify 없음 → 로그 메시지 반환", async () => {
    const r = await new NotificationTool().execute({ title: "Test Alert", level: "warn", body: "Something happened" });
    expect(r).toContain("internal: logged");
    expect(r).toContain("WARN");
    expect(r).toContain("Test Alert");
  });

  it("기본 level = info", async () => {
    const r = await new NotificationTool().execute({ title: "Hello" });
    expect(r).toContain("INFO");
  });
});

describe("NotificationTool — 내부 콜백 있음", () => {
  it("on_notify 호출 → delivered 반환", async () => {
    const on_notify = vi.fn().mockResolvedValue(undefined);
    const tool = new NotificationTool({ on_notify });
    const r = await tool.execute({ title: "Alert", level: "error", body: "Critical error" });
    expect(r).toContain("internal: delivered");
    expect(on_notify).toHaveBeenCalledWith(expect.objectContaining({ level: "error", title: "Alert", body: "Critical error" }));
  });

  it("on_notify 실패 → failed 반환", async () => {
    const on_notify = vi.fn().mockRejectedValue(new Error("callback_failed"));
    const tool = new NotificationTool({ on_notify });
    const r = await tool.execute({ title: "Alert" });
    expect(r).toContain("internal: failed");
    expect(r).toContain("callback_failed");
  });
});

describe("NotificationTool — webhook", () => {
  it("webhook_url 포함 → fetch 호출", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, statusText: "OK" }));
    const r = await new NotificationTool().execute({ title: "Alert", webhook_url: "https://hooks.example.com/notify" });
    expect(r).toContain("webhook: 200");
    expect(fetch).toHaveBeenCalledWith(
      "https://hooks.example.com/notify",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("non-http URL → Error 반환", async () => {
    const r = await new NotificationTool().execute({ title: "Alert", webhook_url: "ftp://bad.example.com" });
    expect(r).toContain("Error");
    expect(r).toContain("http");
  });

  it("webhook fetch 실패 → failed 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network_error")));
    const r = await new NotificationTool().execute({ title: "Alert", webhook_url: "https://hooks.example.com" });
    expect(r).toContain("webhook: failed");
    expect(r).toContain("network_error");
  });

  it("on_notify + webhook → 두 줄 결과", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 201, statusText: "Created" }));
    const on_notify = vi.fn().mockResolvedValue(undefined);
    const tool = new NotificationTool({ on_notify });
    const r = await tool.execute({ title: "Both", webhook_url: "https://example.com" });
    const lines = r.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("internal: delivered");
    expect(lines[1]).toContain("webhook: 201");
  });
});

// ══════════════════════════════════════════
// FileRequestTool
// ══════════════════════════════════════════

describe("FileRequestTool — 메타데이터", () => {
  it("name = request_file", () => expect(new FileRequestTool().name).toBe("request_file"));
  it("category = file_transfer", () => expect(new FileRequestTool().category).toBe("file_transfer"));
  it("to_schema: function 형식", () => expect(new FileRequestTool().to_schema().type).toBe("function"));
});

describe("FileRequestTool — 유효성 검사", () => {
  it("send_callback 없음 → Error 반환", async () => {
    const r = await new FileRequestTool().execute({ prompt: "업로드해주세요" }, { channel: "slack", chat_id: "C1" });
    expect(r).toContain("Error");
    expect(r).toContain("callback");
  });

  it("channel 없음 → Error 반환", async () => {
    const tool = new FileRequestTool({ send_callback: vi.fn() });
    const r = await tool.execute({ prompt: "파일 업로드" }, { channel: "", chat_id: "C1" });
    expect(r).toContain("Error");
    expect(r).toContain("channel");
  });

  it("prompt 없음 → Error 반환", async () => {
    const tool = new FileRequestTool({ send_callback: vi.fn() });
    const r = await tool.execute({ prompt: "" }, { channel: "slack", chat_id: "C1" });
    expect(r).toContain("Error");
    expect(r).toContain("prompt");
  });

  it("chat_id 없음 → Error 반환", async () => {
    const tool = new FileRequestTool({ send_callback: vi.fn() });
    const r = await tool.execute({ prompt: "업로드" }, { channel: "slack", chat_id: "" });
    expect(r).toContain("Error");
    expect(r).toContain("channel");
  });
});

describe("FileRequestTool — 파일 요청 전송", () => {
  it("파일 요청 전송 성공 → file_request_sent 반환", async () => {
    const cb = vi.fn().mockResolvedValue(undefined);
    const tool = new FileRequestTool({ send_callback: cb });
    const r = await tool.execute({ prompt: "CSV 파일을 업로드해주세요" }, { channel: "slack", chat_id: "C1" });
    expect(r).toContain("file_request_sent:");
    expect(cb).toHaveBeenCalledOnce();
    const msg = cb.mock.calls[0][0];
    expect(msg.channel).toBe("slack");
    expect(msg.chat_id).toBe("C1");
    expect(msg.metadata?.kind).toBe("file_request");
    expect(msg.content).toContain("FILE_REQUEST");
    expect(msg.content).toContain("CSV 파일을 업로드해주세요");
  });

  it("accept 파일 타입 포함 → content에 포함", async () => {
    const cb = vi.fn().mockResolvedValue(undefined);
    const tool = new FileRequestTool({ send_callback: cb });
    await tool.execute({ prompt: "이미지 업로드", accept: ["png", "jpg"] }, { channel: "slack", chat_id: "C1" });
    const msg = cb.mock.calls[0][0];
    expect(msg.content).toContain("png");
    expect(msg.content).toContain("jpg");
    expect((msg.metadata?.accept as string[]).length).toBe(2);
  });

  it("파라미터에서 channel/chat_id 직접 제공", async () => {
    const cb = vi.fn().mockResolvedValue(undefined);
    const tool = new FileRequestTool({ send_callback: cb });
    const r = await tool.execute({ prompt: "업로드", channel: "telegram", chat_id: "T001" });
    expect(r).toContain("file_request_sent:");
    const msg = cb.mock.calls[0][0];
    expect(msg.channel).toBe("telegram");
    expect(msg.chat_id).toBe("T001");
  });

  it("set_send_callback → 콜백 교체 후 사용", async () => {
    const tool = new FileRequestTool();
    const cb = vi.fn().mockResolvedValue(undefined);
    tool.set_send_callback(cb);
    const r = await tool.execute({ prompt: "파일 요청" }, { channel: "slack", chat_id: "C1" });
    expect(r).toContain("file_request_sent:");
    expect(cb).toHaveBeenCalledOnce();
  });
});
