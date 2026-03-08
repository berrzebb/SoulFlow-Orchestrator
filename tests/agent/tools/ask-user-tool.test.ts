/**
 * AskUserTool 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import { AskUserTool } from "@src/agent/tools/ask-user.js";
import type { ToolExecutionContext } from "@src/agent/tools/types.js";

function make_ctx(overrides?: Partial<ToolExecutionContext>): ToolExecutionContext {
  return {
    channel: "slack",
    chat_id: "C001",
    sender_id: "U123",
    task_id: "task-1",
    reply_to: "msg-prev",
    ...overrides,
  } as ToolExecutionContext;
}

describe("AskUserTool — 메타데이터", () => {
  it("name = ask_user", () => {
    expect(new AskUserTool().name).toBe("ask_user");
  });

  it("category = messaging", () => {
    expect(new AskUserTool().category).toBe("messaging");
  });

  it("to_schema: function 형식 반환", () => {
    const schema = new AskUserTool().to_schema();
    expect(schema.type).toBe("function");
    expect(schema.function.name).toBe("ask_user");
  });
});

describe("AskUserTool — execute: 에러 케이스", () => {
  it("send_callback 없음 → 에러 반환", async () => {
    const tool = new AskUserTool();
    const result = await tool.execute({ question: "답해주세요" }, make_ctx());
    expect(result).toContain("Error");
    expect(result).toContain("send callback");
  });

  it("channel 없음 → 에러 반환", async () => {
    const tool = new AskUserTool({ send_callback: vi.fn().mockResolvedValue(undefined) });
    const result = await tool.execute({ question: "답해주세요" }, make_ctx({ channel: "" }));
    expect(result).toContain("Error");
    expect(result).toContain("channel");
  });

  it("chat_id 없음 → 에러 반환", async () => {
    const tool = new AskUserTool({ send_callback: vi.fn().mockResolvedValue(undefined) });
    const result = await tool.execute({ question: "답해주세요" }, make_ctx({ chat_id: "" }));
    expect(result).toContain("Error");
  });

  it("question 없음 → 에러 반환", async () => {
    const tool = new AskUserTool({ send_callback: vi.fn().mockResolvedValue(undefined) });
    const result = await tool.execute({ question: "" }, make_ctx());
    expect(result).toContain("Error");
    expect(result).toContain("question");
  });
});

describe("AskUserTool — execute: 성공 케이스", () => {
  it("기본 질문 전송 → HITL 마커 반환", async () => {
    const send_fn = vi.fn().mockResolvedValue(undefined);
    const tool = new AskUserTool({ send_callback: send_fn });
    const result = await tool.execute({ question: "계속할까요?" }, make_ctx());
    expect(result).toContain("__request_user_choice__");
    expect(result).toContain("ask_user_sent:");
    expect(result).toContain("계속할까요?");
    expect(send_fn).toHaveBeenCalledOnce();
  });

  it("선택지 포함 → choices 메시지 포함", async () => {
    const send_fn = vi.fn().mockResolvedValue(undefined);
    const tool = new AskUserTool({ send_callback: send_fn });
    await tool.execute({
      question: "어떤 걸 선택할까요?",
      choices: ["A 옵션", "B 옵션"],
    }, make_ctx());
    const sent_msg = send_fn.mock.calls[0][0];
    expect(sent_msg.content).toContain("1. A 옵션");
    expect(sent_msg.content).toContain("2. B 옵션");
    expect(sent_msg.metadata.choices).toEqual(["A 옵션", "B 옵션"]);
  });

  it("context 포함 → 이탤릭체 컨텍스트", async () => {
    const send_fn = vi.fn().mockResolvedValue(undefined);
    const tool = new AskUserTool({ send_callback: send_fn });
    await tool.execute({
      question: "계속할까요?",
      context: "이 작업은 되돌릴 수 없습니다",
    }, make_ctx());
    const sent_msg = send_fn.mock.calls[0][0];
    expect(sent_msg.content).toContain("_이 작업은 되돌릴 수 없습니다_");
  });

  it("전송된 메시지의 metadata.kind = ask_user", async () => {
    const send_fn = vi.fn().mockResolvedValue(undefined);
    const tool = new AskUserTool({ send_callback: send_fn });
    await tool.execute({ question: "질문" }, make_ctx());
    const msg = send_fn.mock.calls[0][0];
    expect(msg.metadata.kind).toBe("ask_user");
    expect(msg.metadata.task_id).toBe("task-1");
  });

  it("reply_to가 없으면 undefined", async () => {
    const send_fn = vi.fn().mockResolvedValue(undefined);
    const tool = new AskUserTool({ send_callback: send_fn });
    await tool.execute({ question: "질문" }, make_ctx({ reply_to: undefined }));
    const msg = send_fn.mock.calls[0][0];
    expect(msg.reply_to).toBeUndefined();
  });
});

describe("AskUserTool — set_send_callback", () => {
  it("set_send_callback으로 후에 주입", async () => {
    const send_fn = vi.fn().mockResolvedValue(undefined);
    const tool = new AskUserTool();
    tool.set_send_callback(send_fn);
    const result = await tool.execute({ question: "질문" }, make_ctx());
    expect(result).toContain("__request_user_choice__");
    expect(send_fn).toHaveBeenCalled();
  });
});

describe("AskUserTool — validate_params", () => {
  it("question 없으면 validation 에러", () => {
    const tool = new AskUserTool();
    const errors = tool.validate_params({});
    expect(errors.some((e) => e.includes("question"))).toBe(true);
  });

  it("question 있으면 validation 통과", () => {
    const tool = new AskUserTool();
    const errors = tool.validate_params({ question: "괜찮아요?" });
    expect(errors).toHaveLength(0);
  });
});
