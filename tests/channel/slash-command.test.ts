import { describe, it, expect } from "vitest";
import {
  normalize_slash_token,
  normalize_slash_name,
  parse_slash_command,
  parse_slash_command_from_message,
  slash_token_in,
  slash_name_in,
} from "@src/channels/slash-command.js";
import type { InboundMessage } from "@src/bus/types.js";

describe("normalize_slash_token", () => {
  it("소문자 변환 + trim", () => {
    expect(normalize_slash_token("  Hello  ")).toBe("hello");
  });

  it("빈 값 → 빈 문자열", () => {
    expect(normalize_slash_token("")).toBe("");
    expect(normalize_slash_token(null)).toBe("");
  });
});

describe("normalize_slash_name", () => {
  it("슬래시 접두사 제거 + 소문자", () => {
    expect(normalize_slash_name("/Help")).toBe("help");
  });

  it("다중 슬래시 제거", () => {
    expect(normalize_slash_name("///command")).toBe("command");
  });

  it("@봇 접미사 제거", () => {
    expect(normalize_slash_name("/help@MyBot")).toBe("help");
  });

  it("빈 값 → 빈 문자열", () => {
    expect(normalize_slash_name("")).toBe("");
  });
});

describe("parse_slash_command", () => {
  it("기본 커맨드 파싱", () => {
    const result = parse_slash_command("/help");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("help");
    expect(result!.args).toEqual([]);
  });

  it("인자 포함 커맨드", () => {
    const result = parse_slash_command("/set mode auto");
    expect(result!.name).toBe("set");
    expect(result!.args).toEqual(["mode", "auto"]);
  });

  it("슬래시 없으면 null", () => {
    expect(parse_slash_command("hello")).toBeNull();
  });

  it("빈 입력 → null", () => {
    expect(parse_slash_command("")).toBeNull();
  });

  it("슬래시만 → null", () => {
    expect(parse_slash_command("/")).toBeNull();
  });

  it("@봇 접미사 제거", () => {
    const result = parse_slash_command("/help@bot arg1");
    expect(result!.name).toBe("help");
    expect(result!.args).toEqual(["arg1"]);
  });

  it("연속 공백 처리", () => {
    const result = parse_slash_command("/cmd   arg1   arg2");
    expect(result!.args).toEqual(["arg1", "arg2"]);
  });
});

describe("parse_slash_command_from_message", () => {
  const base_msg: InboundMessage = {
    provider: "telegram",
    chat_id: "ch1",
    user_id: "u1",
    content: "",
    ts: Date.now(),
  };

  it("content에서 커맨드 파싱", () => {
    const msg = { ...base_msg, content: "/status" };
    const result = parse_slash_command_from_message(msg);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("status");
    expect(result!.args_lower).toEqual([]);
  });

  it("metadata.command에서 커맨드 파싱", () => {
    const msg = {
      ...base_msg,
      content: "/help on",
      metadata: { command: { name: "/help", args: ["ON"], raw: "/help ON" } },
    };
    const result = parse_slash_command_from_message(msg);
    expect(result!.name).toBe("help");
    expect(result!.args).toEqual(["ON"]);
    expect(result!.args_lower).toEqual(["on"]);
  });

  it("일반 텍스트 → null", () => {
    const msg = { ...base_msg, content: "hello world" };
    expect(parse_slash_command_from_message(msg)).toBeNull();
  });
});

describe("slash_token_in", () => {
  it("별칭 목록에서 매칭", () => {
    expect(slash_token_in("ON", ["on", "yes", "1"])).toBe(true);
  });

  it("매칭 실패", () => {
    expect(slash_token_in("maybe", ["on", "yes"])).toBe(false);
  });

  it("빈 값 → false", () => {
    expect(slash_token_in("", ["on"])).toBe(false);
  });
});

describe("slash_name_in", () => {
  it("슬래시 무시하고 매칭", () => {
    expect(slash_name_in("/Help", ["help", "h"])).toBe(true);
  });

  it("@봇 접미사 무시", () => {
    expect(slash_name_in("/help@bot", ["help"])).toBe(true);
  });

  it("매칭 실패", () => {
    expect(slash_name_in("/unknown", ["help", "status"])).toBe(false);
  });
});
